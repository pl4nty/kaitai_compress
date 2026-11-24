require 'kaitai/compress/error'

module Kaitai
  module Compress
    # Raw LZ4 block (no frame header, no size prefix), pure Ruby.
    #
    # Decodes at most `uncompressed_size` bytes. Decoding stops as soon as that
    # many bytes have been produced, and only then are the remaining input bytes
    # (e.g. alignment padding in CSO/ZSO disc images) ignored. A block may also
    # end with the input after a complete sequence and decode to fewer bytes, but
    # a short block followed by padding is an error: the padding is read as more
    # sequences. Output beyond `uncompressed_size` is an error.
    #
    # encode emits a valid block made of a single literal-only sequence (no
    # compression), so written files stay readable by any LZ4 decoder.
    class Lz4Block
      def initialize(uncompressed_size)
        unless uncompressed_size.is_a?(Integer) && uncompressed_size >= 0
          raise ArgumentError, "lz4_block: uncompressed_size must be a non-negative integer, got #{uncompressed_size.inspect}"
        end
        @uncompressed_size = uncompressed_size
      end

      def decode(data)
        src = data.b
        size = @uncompressed_size
        out = ''.b
        pos = 0
        len = src.bytesize
        # A block whose last sequence ends with the input may decode to fewer
        # than `size` bytes (e.g. a short final block).
        while out.bytesize < size && pos < len
          token = src.getbyte(pos)
          pos += 1
          lit_len, pos = read_length(src, pos, token >> 4, 'literal length')
          raise Error, 'lz4_block: truncated literals' if pos + lit_len > len
          out << src.byteslice(pos, lit_len)
          pos += lit_len
          break if out.bytesize >= size || pos == len # last sequence: literals only

          raise Error, 'lz4_block: truncated match offset' if pos + 2 > len
          offset = src.getbyte(pos) | (src.getbyte(pos + 1) << 8)
          pos += 2
          if offset == 0 || offset > out.bytesize
            raise Error, "lz4_block: invalid match offset #{offset} at output position #{out.bytesize}"
          end
          match_len, pos = read_length(src, pos, token & 0x0f, 'match length')
          match_len += 4
          start = out.bytesize - offset
          if match_len <= offset
            out << out.byteslice(start, match_len)
          else # overlapping copy: repeat the last `offset` bytes
            chunk = out.byteslice(start, offset)
            reps, rest = match_len.divmod(offset)
            out << chunk * reps << chunk.byteslice(0, rest)
          end
        end
        raise Error, "lz4_block: block decodes to more than #{size} bytes" if out.bytesize > size
        out
      end

      def encode(data)
        src = data.b
        n = src.bytesize
        out = ''.b
        if n < 15
          out << (n << 4).chr
        else
          out << 0xf0.chr
          rest = n - 15
          while rest >= 255
            out << 0xff.chr
            rest -= 255
          end
          out << rest.chr
        end
        out << src
      end

      private

      def read_length(src, pos, base, what)
        return [base, pos] if base != 15
        loop do
          raise Error, "lz4_block: truncated #{what}" if pos >= src.bytesize
          b = src.getbyte(pos)
          pos += 1
          base += b
          return [base, pos] if b != 255
        end
      end
    end
  end
end
