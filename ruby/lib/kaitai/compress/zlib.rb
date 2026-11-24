require 'zlib'

module Kaitai
  module Compress
    # RFC 1950 zlib container.
    class Zlib
      def decode(data)
        ::Zlib::inflate(data)
      end

      def encode(data)
        ::Zlib::deflate(data)
      end
    end
  end
end
