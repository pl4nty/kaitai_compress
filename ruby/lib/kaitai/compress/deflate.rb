require 'zlib'
require 'kaitai/compress/error'

module Kaitai
  module Compress
    # RFC 1951 raw deflate stream, no header or trailer.
    class Deflate
      def decode(data)
        z = ::Zlib::Inflate.new(-::Zlib::MAX_WBITS)
        out = z.inflate(data)
        raise Error, "deflate: truncated stream" unless z.finished?
        out
      ensure
        z&.close
      end

      def encode(data)
        z = ::Zlib::Deflate.new(::Zlib::DEFAULT_COMPRESSION, -::Zlib::MAX_WBITS)
        z.deflate(data, ::Zlib::FINISH)
      ensure
        z&.close
      end
    end
  end
end
