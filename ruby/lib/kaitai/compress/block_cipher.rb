# Ruby stdlib: openssl (DES needs OpenSSL's legacy provider on OpenSSL 3)
require 'openssl'
require 'kaitai/compress/error'

module Kaitai
  module Compress
    # DES, 3DES or AES in ECB or CBC mode, with PKCS#7 or no padding.
    #
    # decode decrypts and strictly removes the padding; encode pads and
    # encrypts.
    class BlockCipher
      # algorithm => [block size, {key length => OpenSSL cipher name prefix}]
      TRIPLE_DES = [8, {16 => 'des-ede', 24 => 'des-ede3'}].freeze
      ALGORITHMS = {
        'des' => [8, {8 => 'des'}],
        '3des' => TRIPLE_DES,
        'des3' => TRIPLE_DES,
        'aes' => [16, {16 => 'aes-128', 24 => 'aes-192', 32 => 'aes-256'}],
      }.freeze
      MODES = %w[ecb cbc].freeze
      PADDINGS = %w[pkcs7 none].freeze

      def initialize(algorithm, mode, key, iv = nil, padding = 'pkcs7')
        @block_size, key_sizes = ALGORITHMS[choose('algorithm', algorithm, ALGORITHMS.keys)]
        @mode = choose('mode', mode, MODES)
        @padding = choose('padding', padding, PADDINGS)
        @key = key.b
        prefix = key_sizes[@key.bytesize] or
          raise ArgumentError, "block_cipher: #{algorithm} key must be #{key_sizes.keys.join(' or ')} bytes, got #{@key.bytesize}"
        @name = cipher_name(prefix)
        if @mode == 'cbc'
          raise ArgumentError, "block_cipher: cbc mode requires an iv" if iv.nil?
          @iv = iv.b
          if @iv.bytesize != @block_size
            raise ArgumentError, "block_cipher: iv must be #{@block_size} bytes, got #{@iv.bytesize}"
          end
        end
        ensure_supported
      end

      def decode(data)
        check_block_multiple(data)
        out = run(:decrypt, data)
        @padding == 'pkcs7' ? unpad(out) : out
      end

      def encode(data)
        data = data.b
        if @padding == 'pkcs7'
          n = @block_size - data.bytesize % @block_size
          data += n.chr * n
        else
          check_block_multiple(data)
        end
        run(:encrypt, data)
      end

      private

      def choose(what, value, allowed)
        return value.downcase if allowed.include?(value.downcase)
        raise ArgumentError, "block_cipher: unknown #{what} #{value.inspect}, expected one of #{allowed.join(', ')}"
      end

      def cipher_name(prefix)
        # OpenSSL names: des-ecb, des-cbc, des-ede/des-ede3 (ECB),
        # des-ede-cbc/des-ede3-cbc, aes-128-ecb, ...
        if prefix.start_with?('des-ede')
          @mode == 'cbc' ? "#{prefix}-cbc" : prefix
        else
          "#{prefix}-#{@mode}"
        end
      end

      def check_block_multiple(data)
        if data.bytesize % @block_size != 0
          raise Error, "block_cipher: data length #{data.bytesize} is not a multiple of block size #{@block_size}"
        end
      end

      def unpad(data)
        raise Error, "block_cipher: empty input cannot be unpadded" if data.empty?
        n = data.getbyte(-1)
        if n < 1 || n > @block_size || data.byteslice(-n, n) != n.chr * n
          raise Error, "block_cipher: bad PKCS#7 padding"
        end
        data.byteslice(0, data.bytesize - n)
      end

      def run(direction, data)
        c = new_cipher(direction)
        data.empty? ? c.final : c.update(data) + c.final
      end

      def new_cipher(direction)
        c = OpenSSL::Cipher.new(@name)
        c.public_send(direction)
        c.padding = 0
        c.key = @key
        c.iv = @iv if @iv
        c
      end

      # Fails early if OpenSSL lacks the cipher. OpenSSL 3 moved DES to its
      # "legacy" provider, which is loaded here on demand (together with
      # "default", which is no longer implied once a provider is loaded
      # explicitly).
      def ensure_supported
        new_cipher(:encrypt)
      rescue OpenSSL::Cipher::CipherError, RuntimeError => e
        begin
          OpenSSL::Provider.load('legacy')
          OpenSSL::Provider.load('default')
          new_cipher(:encrypt)
        rescue NameError, OpenSSL::OpenSSLError, RuntimeError
          raise ArgumentError, "block_cipher: OpenSSL does not support #{@name} (#{e.message})"
        end
      end
    end
  end
end
