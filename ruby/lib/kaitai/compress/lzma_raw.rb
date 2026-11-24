# RubyGems: ruby-xz >= 1
require 'kaitai/compress/liblzma'

module Kaitai
  module Compress
    # Raw LZMA2 stream with no container (xz --format=raw, preset 6).
    class LzmaRaw
      def decode(data)
        LibLzma.raw_decode(data)
      end

      def encode(data)
        LibLzma.raw_encode(data)
      end
    end
  end
end
