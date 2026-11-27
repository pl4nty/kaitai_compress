# RubyGems: ruby-xz >= 1
require 'kaitai/compress/liblzma'

module Kaitai
  module Compress
    # LZMA1 data after its 5 property bytes (lc/lp/pb, then the u4le
    # dictionary size), with no uncompressed size: the "properties + stream"
    # form that NSIS and Inno Setup store.
    #
    # The stream must end with an end marker. With
    # `filter_flag` (NSIS), a byte before the properties says whether the
    # BCJ x86 filter was applied: 0 for no, 1 for yes.
    class LzmaProps
      PROPS = [93, 1 << 23].pack('CV') # lc=3 lp=0 pb=2, 8 MiB: liblzma preset 6

      def initialize(filter_flag = false)
        @filter_flag = filter_flag
      end

      def decode(data)
        x86 = false
        if @filter_flag
          flag = data.getbyte(0)
          raise Error, "lzma_props: invalid filter flag" if flag.nil? || flag > 1
          x86 = flag == 1
          data = data.byteslice(1..)
        end
        raise Error, "lzma_props: truncated properties" if data.bytesize < 5
        props, dict_size = data.unpack('CV')
        raise Error, format("lzma_props: invalid properties byte 0x%02x", props) if props >= 9 * 5 * 5
        lc, lp = props % 9, props / 9 % 5
        raise Error, format("lzma_props: lc + lp > 4 is not supported (properties byte 0x%02x)", props) if lc + lp > 4
        LibLzma.lzma1_decode(data.byteslice(5..), props, [dict_size, 4096].max, x86)
      end

      def encode(data)
        out = PROPS + LibLzma.lzma1_encode(data)
        @filter_flag ? "\0".b + out : out
      end
    end
  end
end
