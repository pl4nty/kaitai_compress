# RubyGems: ruby-xz >= 1
require 'xz'

module Kaitai
  module Compress
    class LzmaXz
      def decode(data)
        ::XZ::decompress(data)
      end

      def encode(data)
        ::XZ::compress(data)
      end
    end
  end
end
