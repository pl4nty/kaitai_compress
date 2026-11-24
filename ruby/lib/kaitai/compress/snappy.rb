# RubyGems: snappy
require 'snappy'

module Kaitai
  module Compress
    # Raw snappy block, no framing.
    class Snappy
      def decode(data)
        ::Snappy::inflate(data)
      end

      def encode(data)
        ::Snappy::deflate(data)
      end
    end
  end
end
