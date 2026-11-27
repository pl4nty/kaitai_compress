require 'kaitai/compress/error'

module Kaitai
  module Compress
    # bzip2 as NSIS writes it (decode only).
    #
    # NSIS's bzip2 is the bzip2 block format without the stream framing: no
    # "BZh" header, and each block starts with the byte 0x31 instead of the
    # 48-bit block magic and CRC-32, with 0x17 instead of the end-of-stream
    # magic and combined CRC. Blocks are bit-aligned and hold up to 900 kB.
    # NSIS 2 and 3 blocks have no "randomised" bit; NSIS 1 blocks do, and are
    # tried if the first reading fails. Randomised blocks are not supported.
    # Data after the end marker is ignored.
    class Bz2Nsis
      MAX_BLOCK = 900_000

      def decode(data)
        data = data.b
        begin
          run(data, false)
        rescue Error => e
          begin
            run(data, true)
          rescue Error
            raise e
          end
        end
      end

      private

      def run(data, randomised_bit)
        @data = data
        @pos = 0
        @buf = 0
        @cnt = 0
        out = "".b
        loop do
          sig = bits(8)
          return out if sig == 0x17
          raise Error, format("bz2_nsis: invalid block signature 0x%02x", sig) if sig != 0x31
          out << block(randomised_bit)
        end
      end

      # MSB-first
      def bits(n)
        while @cnt < n
          b = @data.getbyte(@pos) or raise Error, "bz2_nsis: truncated input"
          @buf = (@buf << 8) | b
          @pos += 1
          @cnt += 8
        end
        @cnt -= n
        v = @buf >> @cnt
        @buf &= (1 << @cnt) - 1
        v
      end

      # Canonical code as [min length, max length, limit, base, perm], bzip2 style.
      def huffman(lengths)
        lo, hi = lengths.minmax
        perm = (lo..hi).flat_map { |n| lengths.each_index.select { |s| lengths[s] == n } }
        limit = {}
        base = {}
        code = 0
        i = 0
        (lo..hi).each { |n|
          count = lengths.count(n)
          base[n] = i - code
          code += count
          i += count
          limit[n] = code - 1
          code <<= 1
        }
        [lo, hi, limit, base, perm]
      end

      def symbol(table)
        lo, hi, limit, base, perm = table
        n = lo
        code = bits(lo)
        while code > limit[n]
          n += 1
          raise Error, "bz2_nsis: invalid Huffman code" if n > hi
          code = (code << 1) | bits(1)
        end
        perm[code + base[n]]
      end

      def block(randomised_bit)
        raise Error, "bz2_nsis: randomised blocks are not supported" if randomised_bit && bits(1) == 1
        orig_ptr = bits(24)
        used16 = bits(16)
        seq = []
        16.times { |i|
          next if ((used16 >> (15 - i)) & 1).zero?
          16.times { |j| seq << i * 16 + j if bits(1) == 1 }
        }
        raise Error, "bz2_nsis: block uses no symbols" if seq.empty?
        alpha = seq.size + 2
        n_groups = bits(3)
        n_selectors = bits(15)
        raise Error, "bz2_nsis: invalid block header" if n_groups < 2 || n_groups > 6 || n_selectors.zero?
        mtf = (0...n_groups).to_a
        selectors = Array.new(n_selectors) {
          j = 0
          while bits(1) == 1
            j += 1
            raise Error, "bz2_nsis: invalid selector" if j >= n_groups
          end
          mtf.unshift(mtf.delete_at(j))
          mtf[0]
        }
        tables = Array.new(n_groups) {
          n = bits(5)
          lengths = Array.new(alpha) {
            loop do
              raise Error, "bz2_nsis: invalid code length" unless (1..20).cover?(n)
              break if bits(1).zero?
              n += bits(1) == 1 ? -1 : 1
            end
            n
          }
          huffman(lengths)
        }

        # Huffman, then run lengths of RUNA/RUNB and move-to-front
        eob = alpha - 1
        order = seq.dup
        ll = []
        run = 0
        weight = 1
        sel = 0
        left = 0
        table = nil
        loop do
          if left.zero?
            raise Error, "bz2_nsis: ran out of selectors" if sel >= n_selectors
            table = tables[selectors[sel]]
            sel += 1
            left = 50
          end
          left -= 1
          s = symbol(table)
          if s <= 1
            run += weight << s
            weight <<= 1
            raise Error, "bz2_nsis: block too big" if run > MAX_BLOCK
            next
          end
          if run.positive?
            raise Error, "bz2_nsis: block too big" if ll.size + run > MAX_BLOCK
            ll.concat([order[0]] * run)
            run = 0
            weight = 1
          end
          break if s == eob
          order.unshift(order.delete_at(s - 1))
          ll << order[0]
          raise Error, "bz2_nsis: block too big" if ll.size > MAX_BLOCK
        end
        raise Error, "bz2_nsis: invalid block size or origin pointer" if ll.size > MAX_BLOCK || orig_ptr >= [ll.size, 1].max

        # inverse Burrows-Wheeler transform
        start = Array.new(256, 0)
        ll.each { |b| start[b] += 1 }
        total = 0
        256.times { |b|
          c = start[b]
          start[b] = total
          total += c
        }
        ptr = Array.new(ll.size)
        ll.each_with_index { |b, i|
          ptr[start[b]] = i
          start[b] += 1
        }
        p = ptr[orig_ptr]
        bwt = Array.new(ll.size) {
          b = ll[p]
          p = ptr[p]
          b
        }

        # undo the initial run-length encoding: 4 equal bytes, then a count
        res = []
        prev = -1
        same = 0
        bwt.each { |b|
          if same == 4
            res.concat([prev] * b)
            same = 0
            prev = -1
            next
          end
          res << b
          same = b == prev ? same + 1 : 1
          prev = b
        }
        res.pack('C*')
      end
    end
  end
end
