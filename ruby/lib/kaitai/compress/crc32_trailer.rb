require 'zlib'
require 'kaitai/compress/error'

module Kaitai
  module Compress
    # Data followed by a little-endian CRC-32 of (data + salt).
    #
    # decode verifies the CRC and returns the data unchanged, trailer
    # included; encode replaces the last 4 bytes with a freshly computed CRC.
    class Crc32Trailer
      def initialize(salt = "".b)
        @salt = salt.b
      end

      def decode(data)
        expected = crc(data)
        actual = data.byteslice(-4, 4).unpack1('V')
        if actual != expected
          raise Error, format("crc32_trailer: CRC mismatch: stored 0x%08x, computed 0x%08x", actual, expected)
        end
        data
      end

      def encode(data)
        trailer = [crc(data)].pack('V')
        data.byteslice(0, data.bytesize - 4).b + trailer
      end

      private

      def crc(data)
        raise Error, "crc32_trailer: need at least 4 bytes, got #{data.bytesize}" if data.bytesize < 4
        ::Zlib.crc32(data.byteslice(0, data.bytesize - 4).b + @salt)
      end
    end
  end
end
