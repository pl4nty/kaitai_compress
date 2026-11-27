require 'zlib'
require 'kaitai/compress/error'

module Kaitai
  module Compress
    # Data in chunks of `chunk_size` bytes (the last one may be shorter),
    # each preceded by the little-endian CRC-32 of the chunk, as Inno Setup
    # stores its compressed headers (4096-byte chunks).
    #
    # decode verifies every CRC and returns the chunks joined; encode splits
    # and adds the CRCs.
    class Crc32Chunks
      def initialize(chunk_size)
        unless chunk_size.is_a?(Integer) && chunk_size >= 1
          raise ArgumentError, "crc32_chunks: chunk_size must be a positive integer, got #{chunk_size.inspect}"
        end
        @chunk_size = chunk_size
      end

      def decode(data)
        out = "".b
        pos = 0
        while pos < data.bytesize
          raise Error, "crc32_chunks: truncated chunk at offset #{pos}" if data.bytesize - pos <= 4
          stored = data.byteslice(pos, 4).unpack1('V')
          chunk = data.byteslice(pos + 4, @chunk_size)
          raise Error, "crc32_chunks: CRC mismatch in chunk at offset #{pos}" if ::Zlib.crc32(chunk) != stored
          out << chunk
          pos += 4 + chunk.bytesize
        end
        out
      end

      def encode(data)
        out = "".b
        (0...data.bytesize).step(@chunk_size) { |i|
          chunk = data.byteslice(i, @chunk_size)
          out << [::Zlib.crc32(chunk)].pack('V') << chunk
        }
        out
      end
    end
  end
end
