# RubyGems: bzip2-ffi
require 'bzip2/ffi'
require 'stringio'

module Kaitai
  module Compress
    class Bz2
      def decode(data)
        ::Bzip2::FFI::Reader.read(StringIO.new(data))
      end

      def encode(data)
        io = StringIO.new("".b)
        ::Bzip2::FFI::Writer.write(io, data)
        io.string
      end
    end
  end
end
