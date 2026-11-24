# RubyGems: ruby-xz >= 1 (used for its liblzma binding)
#
# ruby-xz only exposes the .xz container. This helper binds the few extra
# liblzma functions needed for legacy .lzma ("alone") and raw LZMA2 streams
# and runs a whole-buffer coding loop.
require 'xz'
require 'kaitai/compress/error'

module Kaitai
  module Compress
    module LibLzma
      L = ::XZ::LibLZMA
      L.extern "lzma_ret lzma_alone_decoder(lzma_stream*, uint64_t)"
      L.extern "lzma_ret lzma_alone_encoder(lzma_stream*, void*)"
      L.extern "lzma_ret lzma_raw_decoder(lzma_stream*, void*)"
      L.extern "lzma_ret lzma_raw_encoder(lzma_stream*, void*)"
      L.extern "unsigned char lzma_lzma_preset(void*, uint32_t)"

      FILTER_LZMA2 = 0x21
      VLI_UNKNOWN = L::UINT64_MAX
      PRESET = 6
      CHUNK_SIZE = 64 * 1024
      OPTIONS_SIZE = 256 # >= sizeof(lzma_options_lzma)

      module_function

      # Runs `data` through a stream set up by the block (which gets the
      # lzma_stream pointer and preset options pointer, and returns an
      # lzma_ret).
      def code(data)
        stream = L::LZMAStream.malloc
        L.LZMA_STREAM_INIT(stream)
        options = Fiddle::Pointer.malloc(OPTIONS_SIZE)
        options[0, OPTIONS_SIZE] = "\0".b * OPTIONS_SIZE
        raise Error, "liblzma: lzma_lzma_preset failed" if L.lzma_lzma_preset(options, PRESET) != 0
        check(yield(stream.to_ptr, options))

        input = Fiddle::Pointer.malloc([data.bytesize, 1].max)
        input[0, data.bytesize] = data unless data.empty?
        output = Fiddle::Pointer.malloc(CHUNK_SIZE)
        stream.next_in = input
        stream.avail_in = data.bytesize
        out = "".b
        loop do
          stream.next_out = output
          stream.avail_out = CHUNK_SIZE
          ret = L.lzma_code(stream.to_ptr, L::LZMA_FINISH)
          out << output[0, CHUNK_SIZE - stream.avail_out]
          break if ret == L::LZMA_STREAM_END
          raise Error, "liblzma: truncated stream" if ret == L::LZMA_BUF_ERROR
          check(ret)
        end
        out
      ensure
        L.lzma_end(stream.to_ptr) if stream
        [stream&.to_ptr, options, input, output].compact.each { |p| Fiddle.free(p) }
      end

      # lzma_filter[2] for a single LZMA2 filter with preset options.
      def lzma2_filters(options)
        f = Fiddle::Pointer.malloc(32)
        f[0, 32] = [FILTER_LZMA2, options.to_i, VLI_UNKNOWN, 0].pack('QQQQ')
        f
      end

      def check(ret)
        return if ret == L::LZMA_OK
        ::XZ::LZMAError.raise_if_necessary(ret)
        raise Error, "liblzma: error code #{ret}"
      rescue ::XZ::LZMAError => e
        raise Error, "liblzma: #{e.message}"
      end

      def alone_decode(data)
        code(data) { |s, _| L.lzma_alone_decoder(s, L::UINT64_MAX) }
      end

      def alone_encode(data)
        code(data) { |s, o| L.lzma_alone_encoder(s, o) }
      end

      def raw_decode(data)
        filters = nil
        code(data) { |s, o| L.lzma_raw_decoder(s, filters = lzma2_filters(o)) }
      ensure
        Fiddle.free(filters) if filters
      end

      def raw_encode(data)
        filters = nil
        code(data) { |s, o| L.lzma_raw_encoder(s, filters = lzma2_filters(o)) }
      ensure
        Fiddle.free(filters) if filters
      end
    end
  end
end
