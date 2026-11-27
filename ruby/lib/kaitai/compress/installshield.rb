require 'kaitai/compress/error'

module Kaitai
  module Compress
    # The obfuscation of files in an InstallShield setup launcher.
    #
    # Each byte b becomes ~(key[i % len(key)] ^ rotl(b, 4)), where the key is
    # the file name (UTF-8) XORed with 13 35 86 07 repeated, and i restarts
    # at 0 every 1024 bytes if `chunked` (flag 4 of the file entry). The
    # result is often zlib data, which is left to the caller.
    class Installshield
      MAGIC = [0x13, 0x35, 0x86, 0x07].freeze
      ROTATE = (0..255).map { |b| ((b << 4) | (b >> 4)) & 0xff }.freeze

      def initialize(name, chunked = false)
        name = name.encode('UTF-8') if name.encoding != Encoding::BINARY
        bytes = name.b.bytes
        raise ArgumentError, "installshield: empty file name" if bytes.empty?
        # the key with the final NOT folded in
        key = bytes.each_with_index.map { |b, i| b ^ MAGIC[i % 4] ^ 0xff }
        key = (key * (1024 / key.size + 1)).first(1024) if chunked
        @key = key
      end

      def decode(data)
        key = @key
        data.bytes.each_with_index.map { |b, i| ROTATE[b] ^ key[i % key.size] }.pack('C*')
      end

      def encode(data)
        key = @key
        data.bytes.each_with_index.map { |b, i| ROTATE[b ^ key[i % key.size]] }.pack('C*')
      end
    end
  end
end
