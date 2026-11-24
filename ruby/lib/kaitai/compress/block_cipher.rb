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
      ALGORITHMS = {
        'des' => [8, {8 => 'des'}],
        '3des' => [8, {16 => 'des-ede', 24 => 'des-ede3'}],
        'des3' => [8, {16 => 'des-ede', 24 => 'des-ede3'}],
        'aes' => [16, {16 => 'aes-128', 24 => 'aes-192', 32 => 'aes-256'}],
      }.freeze
      MODES = %w[ecb cbc].freeze
      PADDINGS = %w[pkcs7 none].freeze

      def initialize(algorithm, mode, key, iv = nil, padding = 'pkcs7')
        unless ALGORITHMS.key?(algorithm.downcase)
          raise ArgumentError, "block_cipher: unknown algorithm #{algorithm.inspect}, expected one of #{ALGORITHMS.keys.join(', ')}"
        end
        @block_size, names = ALGORITHMS[algorithm.downcase]
        @mode = mode.downcase
        MODES.include?(@mode) or
          raise ArgumentError, "block_cipher: unknown mode #{mode.inspect}, expected one of #{MODES.join(', ')}"
        @padding = padding.downcase
        PADDINGS.include?(@padding) or
          raise ArgumentError, "block_cipher: unknown padding #{padding.inspect}, expected one of #{PADDINGS.join(', ')}"
        @key = key.b
        prefix = names[@key.bytesize] or
          raise ArgumentError, "block_cipher: #{algorithm} key must be #{names.keys.join(' or ')} bytes, got #{@key.bytesize}"
        @name = cipher_name(prefix)
        @iv = nil
        if @mode == 'cbc'
          raise ArgumentError, "block_cipher: cbc mode requires an iv" if iv.nil?
          @iv = iv.b
          if @iv.bytesize != @block_size
            raise ArgumentError, "block_cipher: iv must be #{@block_size} bytes, got #{@iv.bytesize}"
          end
        end
        new_cipher(:encrypt) # fail early if OpenSSL lacks the algorithm
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
        c = self.class.openssl_cipher(@name)
        c.public_send(direction)
        c.padding = 0
        c.key = @key
        c.iv = @iv if @iv
        c
      end

      # OpenSSL 3 moved DES to the "legacy" provider; load it once on demand.
      def self.openssl_cipher(name)
        OpenSSL::Cipher.new(name)
      rescue OpenSSL::Cipher::CipherError, RuntimeError
        raise if @legacy_loaded || !defined?(OpenSSL::Provider)
        @legacy_loaded = true
        begin
          OpenSSL::Provider.load('legacy')
          OpenSSL::Provider.load('default')
        rescue OpenSSL::Provider::ProviderError
          raise ArgumentError, "block_cipher: OpenSSL does not support #{name} (legacy provider unavailable)"
        end
        OpenSSL::Cipher.new(name)
      end
    end
  end
end
