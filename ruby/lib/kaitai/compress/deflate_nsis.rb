require 'zlib'
require 'kaitai/compress/error'

module Kaitai
  module Compress
    # Raw deflate as NSIS writes it.
    #
    # NSIS 2.x compresses with its own copy of zlib whose stored blocks have
    # no NLEN (the one's complement of LEN); NSIS 3 uses stock zlib. A stored
    # block is read as NSIS 3 if the two bytes after LEN are its complement,
    # else as NSIS 2. Data after the final block is ignored. encode writes
    # stock raw deflate, as NSIS 3 does.
    class DeflateNsis
      LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
                  35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258].freeze
      LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2,
                   3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0].freeze
      DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
                   257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145,
                   8193, 12289, 16385, 24577].freeze
      DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
                    7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13].freeze
      CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15].freeze

      # Lookup table indexed by the next `bits` input bits (LSB first): each
      # entry is symbol << 4 | code length, or -1 for an unused code.
      def self.table(lengths)
        bits = lengths.max
        return [[-1], 0] if bits.zero?
        counts = Array.new(16, 0)
        lengths.each { |n| counts[n] += 1 }
        counts[0] = 0
        code = 0
        left = 1
        next_code = Array.new(16, 0)
        (1..15).each { |n|
          left = left * 2 - counts[n]
          raise Error, "deflate_nsis: over-subscribed Huffman code" if left.negative?
          code = (code + counts[n - 1]) << 1
          next_code[n] = code
        }
        tab = Array.new(1 << bits, -1)
        lengths.each_with_index { |n, sym|
          next if n.zero?
          c = next_code[n]
          next_code[n] += 1
          rev = c.to_s(2).rjust(n, '0').reverse.to_i(2)
          rev.step((1 << bits) - 1, 1 << n) { |i| tab[i] = (sym << 4) | n }
        }
        [tab, bits]
      end

      FIXED = [table([8] * 144 + [9] * 112 + [7] * 24 + [8] * 8), table([5] * 30)].freeze

      def decode(data)
        @data = data.b
        @pos = 0
        @buf = 0
        @cnt = 0
        out = "".b
        loop do
          final = bits(1)
          case bits(2)
          when 0 then stored(out)
          when 1 then codes(out, *FIXED)
          when 2 then codes(out, *dynamic_tables)
          else raise Error, "deflate_nsis: invalid block type 3"
          end
          return out if final == 1
        end
      end

      def encode(data)
        z = ::Zlib::Deflate.new(::Zlib::BEST_COMPRESSION, -::Zlib::MAX_WBITS)
        z.deflate(data, ::Zlib::FINISH)
      ensure
        z&.close
      end

      private

      def bits(n)
        while @cnt < n
          b = @data.getbyte(@pos) or raise Error, "deflate_nsis: truncated input"
          @buf |= b << @cnt
          @pos += 1
          @cnt += 8
        end
        v = @buf & ((1 << n) - 1)
        @buf >>= n
        @cnt -= n
        v
      end

      def sym(table)
        tab, n = table
        while @cnt < n && @pos < @data.bytesize
          @buf |= @data.getbyte(@pos) << @cnt
          @pos += 1
          @cnt += 8
        end
        e = tab[@buf & ((1 << n) - 1)]
        raise Error, "deflate_nsis: invalid Huffman code or truncated input" if e.negative? || (e & 15) > @cnt
        @buf >>= e & 15
        @cnt -= e & 15
        e >> 4
      end

      def stored(out)
        # byte-align and hand the whole bytes still buffered back to the input
        @pos -= @cnt / 8
        @buf = @cnt = 0
        raise Error, "deflate_nsis: truncated input" if @pos + 2 > @data.bytesize
        len = @data.byteslice(@pos, 2).unpack1('v')
        @pos += 2
        # NSIS 2 writes no NLEN; standard deflate (NSIS 3) does
        @pos += 2 if @pos + 2 <= @data.bytesize && @data.byteslice(@pos, 2).unpack1('v') == len ^ 0xffff
        raise Error, "deflate_nsis: truncated stored block" if @pos + len > @data.bytesize
        out << @data.byteslice(@pos, len)
        @pos += len
      end

      def dynamic_tables
        hlit = bits(5) + 257
        hdist = bits(5) + 1
        hclen = bits(4) + 4
        cl = Array.new(19, 0)
        hclen.times { |i| cl[CL_ORDER[i]] = bits(3) }
        cl_table = self.class.table(cl)
        lengths = []
        while lengths.size < hlit + hdist
          s = sym(cl_table)
          if s < 16
            lengths << s
          elsif s == 16
            raise Error, "deflate_nsis: repeat with no previous length" if lengths.empty?
            lengths.concat([lengths[-1]] * (3 + bits(2)))
          elsif s == 17
            lengths.concat([0] * (3 + bits(3)))
          else
            lengths.concat([0] * (11 + bits(7)))
          end
        end
        raise Error, "deflate_nsis: code lengths overflow" if lengths.size > hlit + hdist
        raise Error, "deflate_nsis: no end-of-block code" if lengths[256].zero?
        [self.class.table(lengths[0, hlit]), self.class.table(lengths[hlit..])]
      end

      def codes(out, lit, dist)
        loop do
          s = sym(lit)
          if s < 256
            out << s.chr
            next
          end
          return if s == 256
          s -= 257
          raise Error, "deflate_nsis: invalid length code" if s >= 29
          n = LEN_BASE[s] + bits(LEN_EXTRA[s])
          d = sym(dist)
          raise Error, "deflate_nsis: invalid distance code" if d >= 30
          d = DIST_BASE[d] + bits(DIST_EXTRA[d])
          raise Error, "deflate_nsis: distance too far back" if d > out.bytesize
          if d >= n
            out << out.byteslice(out.bytesize - d, n)
          else
            n.times { out << out.getbyte(out.bytesize - d).chr }
          end
        end
      end
    end
  end
end
