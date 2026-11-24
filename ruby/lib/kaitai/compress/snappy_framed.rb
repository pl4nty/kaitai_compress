# RubyGems: snappy (raw block codec only; framing is implemented here)
require 'snappy'
require 'kaitai/compress/error'

module Kaitai
  module Compress
    # Snappy framing format: a stream identifier chunk followed by
    # compressed (0x00) and uncompressed (0x01) chunks, each carrying a
    # masked CRC-32C of its uncompressed data, which is verified on decode.
    class SnappyFramed
      STREAM_ID = "\xff\x06\x00\x00sNaPpY".b.freeze
      MAX_CHUNK = 65536

      CRC32C_TABLE = (0..255).map { |i|
        8.times { i = (i >> 1) ^ (i & 1 == 1 ? 0x82F63B78 : 0) }
        i
      }.freeze

      def self.masked_crc32c(data)
        crc = 0xFFFFFFFF
        data.each_byte { |b| crc = CRC32C_TABLE[(crc ^ b) & 0xFF] ^ (crc >> 8) }
        crc ^= 0xFFFFFFFF
        (((crc >> 15) | (crc << 17)) + 0xA282EAD8) & 0xFFFFFFFF
      end

      def decode(data)
        data = data.b
        raise Error, "snappy_framed: missing stream identifier" unless data.start_with?(STREAM_ID)
        out = "".b
        pos = 0
        while pos < data.bytesize
          raise Error, "snappy_framed: truncated chunk header" if pos + 4 > data.bytesize
          kind = data.getbyte(pos)
          length = (data.byteslice(pos + 1, 3) + "\0").unpack1('V')
          body = data.byteslice(pos + 4, length)
          raise Error, "snappy_framed: truncated chunk" if body.bytesize != length
          pos += 4 + length
          case kind
          when 0xFF
            raise Error, "snappy_framed: bad stream identifier" if body != STREAM_ID.byteslice(4, 6)
          when 0x00, 0x01
            raise Error, "snappy_framed: chunk too short" if length < 4
            crc = body.unpack1('V')
            chunk = body.byteslice(4, length - 4)
            chunk = ::Snappy::inflate(chunk) if kind == 0x00
            raise Error, "snappy_framed: CRC mismatch" if self.class.masked_crc32c(chunk) != crc
            out << chunk
          else
            raise Error, format("snappy_framed: reserved unskippable chunk 0x%02x", kind) if kind < 0x80
            # 0x80..0xfe: skippable or padding
          end
        end
        out
      end

      def encode(data)
        data = data.b
        out = STREAM_ID.dup
        (0...data.bytesize).step(MAX_CHUNK) { |i|
          chunk = data.byteslice(i, MAX_CHUNK)
          crc = [self.class.masked_crc32c(chunk)].pack('V')
          compressed = ::Snappy::deflate(chunk)
          kind, body = compressed.bytesize < chunk.bytesize ? [0x00, compressed] : [0x01, chunk]
          out << [kind | ((body.bytesize + 4) << 8)].pack('V') << crc << body
        }
        out
      end
    end
  end
end
