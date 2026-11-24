# RubyGems: extlz4
require 'extlz4'

module Kaitai
  module Compress
    # LZ4 frame format.
    class Lz4
      def decode(data)
        ::LZ4::decode(data)
      end

      def encode(data)
        ::LZ4::encode(data)
      end
    end
  end
end
