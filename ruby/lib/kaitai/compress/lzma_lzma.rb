# RubyGems: ruby-xz >= 1
require 'kaitai/compress/liblzma'

module Kaitai
  module Compress
    # Legacy .lzma ("LZMA alone") container.
    class LzmaLzma
      def decode(data)
        LibLzma.alone_decode(data)
      end

      def encode(data)
        LibLzma.alone_encode(data)
      end
    end
  end
end
