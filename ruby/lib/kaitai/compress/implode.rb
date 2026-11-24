# PKWare Data Compression Library (DCL) "implode" decompressor (decode only).
# Note: this is NOT the "implode" method (6) of PKZIP, which is a different format.
#
# Port of blast.c by Mark Adler (zlib contrib/blast, version 1.3). This is an
# altered version: translated from C to Ruby for kaitai_compress, decoding a
# whole in-memory buffer. It is not the original software.
#
# Original copyright and licence notice of blast.c / blast.h:
#
#   Copyright (C) 2003, 2012, 2013 Mark Adler
#
#   This software is provided 'as-is', without any express or implied
#   warranty.  In no event will the author be held liable for any damages
#   arising from the use of this software.
#
#   Permission is granted to anyone to use this software for any purpose,
#   including commercial applications, and to alter it and redistribute it
#   freely, subject to the following restrictions:
#
#   1. The origin of this software must not be misrepresented; you must not
#      claim that you wrote the original software. If you use this software
#      in a product, an acknowledgment in the product documentation would be
#      appreciated but is not required.
#   2. Altered source versions must be plainly marked as such, and must not be
#      misrepresented as being the original software.
#   3. This notice may not be removed or altered from any source distribution.
#
#   Mark Adler    madler@alumni.caltech.edu

require 'kaitai/compress/error'

module Kaitai
  module Compress
    class Implode
      MAXBITS = 13 # maximum code length

      # Build a canonical Huffman table [count, symbol] from run-length coded
      # code lengths: each byte is (repeat count - 1) << 4 | code length.
      def self.construct(rep)
        length = rep.flat_map { |b| [b & 15] * ((b >> 4) + 1) }
        count = Array.new(MAXBITS + 1, 0)
        length.each { |len| count[len] += 1 }
        offs = Array.new(MAXBITS + 1, 0)
        (1...MAXBITS).each { |len| offs[len + 1] = offs[len] + count[len] }
        symbol = Array.new(length.size, 0)
        length.each_with_index do |len, sym|
          next if len == 0
          symbol[offs[len]] = sym
          offs[len] += 1
        end
        [count, symbol].freeze
      end

      # fixed code tables of the format
      LITCODE = construct([
        11, 124, 8, 7, 28, 7, 188, 13, 76, 4, 10, 8, 12, 10, 12, 10, 8, 23, 8,
        9, 7, 6, 7, 8, 7, 6, 55, 8, 23, 24, 12, 11, 7, 9, 11, 12, 6, 7, 22, 5,
        7, 24, 6, 11, 9, 6, 7, 22, 7, 11, 38, 7, 9, 8, 25, 11, 8, 11, 9, 12,
        8, 12, 5, 38, 5, 38, 5, 11, 7, 5, 6, 21, 6, 10, 53, 8, 7, 24, 10, 27,
        44, 253, 253, 253, 252, 252, 252, 13, 12, 45, 12, 45, 12, 61, 12, 45,
        44, 173
      ])
      LENCODE = construct([2, 35, 36, 53, 38, 23])
      DISTCODE = construct([2, 20, 53, 230, 247, 151, 248])
      BASE = [3, 2, 4, 5, 6, 7, 8, 9, 10, 12, 16, 24, 40, 72, 136, 264].freeze
      EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8].freeze

      def decode(data)
        @data = data.b
        @pos = 0
        @bitbuf = 0
        @bitcnt = 0

        lit = bits(8)
        raise Error, "implode: literal flag must be 0 or 1, got #{lit}" if lit > 1
        dict = bits(8)
        raise Error, "implode: dictionary size code must be 4..6, got #{dict}" unless (4..6).include?(dict)

        out = [] # output bytes
        loop do
          if bits(1) == 1
            # length/distance pair
            symbol = huff(LENCODE)
            len = BASE[symbol] + bits(EXTRA[symbol])
            return out.pack('C*') if len == 519 # end code

            symbol = len == 2 ? 2 : dict
            dist = (huff(DISTCODE) << symbol) + bits(symbol) + 1
            raise Error, 'implode: distance too far back' if dist > out.size

            # byte-wise forward copy, which also handles overlapping copies
            from = out.size - dist
            len.times { |k| out << out[from + k] }
          else
            out << (lit == 1 ? huff(LITCODE) : bits(8))
          end
        end
      end

      private

      # Return need bits from the input, least significant bit first.
      def bits(need)
        val = @bitbuf
        while @bitcnt < need
          byte = @data.getbyte(@pos)
          raise Error, 'implode: unexpected end of input' if byte.nil?
          val |= byte << @bitcnt
          @pos += 1
          @bitcnt += 8
        end
        @bitbuf = val >> need
        @bitcnt -= need
        val & ((1 << need) - 1)
      end

      # Decode one symbol using Huffman table h. Stored codes are bit-reversed
      # and inverted relative to canonical order.
      def huff(h)
        count, symbol = h
        code = first = index = 0
        (1..MAXBITS).each do |len|
          code |= bits(1) ^ 1
          cnt = count[len]
          return symbol[index + (code - first)] if code < first + cnt
          index += cnt
          first = (first + cnt) << 1
          code <<= 1
        end
        raise Error, 'implode: invalid Huffman code'
      end
    end
  end
end
