require 'zlib'
require 'kaitai/compress/error'

module Kaitai
  module Compress
    # RFC 1952 gzip; decode accepts several concatenated members.
    class Gzip
      def decode(data)
        out = "".b
        rest = data
        loop do
          z = ::Zlib::Inflate.new(::Zlib::MAX_WBITS + 16)
          begin
            out << z.inflate(rest)
            raise Error, "gzip: truncated member" unless z.finished?
            rest = rest.byteslice(z.total_in, rest.bytesize - z.total_in)
          ensure
            z.close
          end
          break if rest.empty?
        end
        out
      end

      def encode(data)
        ::Zlib.gzip(data)
      end
    end
  end
end
