# RubyGems: brotli
require 'brotli'

module Kaitai
  module Compress
    class Brotli
      def decode(data)
        ::Brotli::inflate(data)
      end

      def encode(data)
        ::Brotli::deflate(data)
      end
    end
  end
end
