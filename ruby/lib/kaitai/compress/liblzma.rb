# RubyGems: ruby-xz >= 1 (used for its Fiddle binding of liblzma)
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

      # lzma_filter; a filter chain is an array of these ending with id
      # LZMA_VLI_UNKNOWN.
      Filter = L.struct ["uint64_t id", "void* options"]
      FILTER_LZMA2 = 0x21
      VLI_UNKNOWN = L::UINT64_MAX

      PRESET = 6
      OPTIONS_SIZE = 256 # generously more than sizeof(lzma_options_lzma)
      CHUNK_SIZE = 64 * 1024

      ERRORS = {
        L::LZMA_MEM_ERROR => "out of memory",
        L::LZMA_MEMLIMIT_ERROR => "memory limit reached",
        L::LZMA_FORMAT_ERROR => "unrecognized format",
        L::LZMA_OPTIONS_ERROR => "unsupported options",
        L::LZMA_DATA_ERROR => "corrupt data",
        L::LZMA_BUF_ERROR => "truncated stream", # no progress possible
        L::LZMA_PROG_ERROR => "programming error",
      }.freeze

      module_function

      def alone_decode(data)
        code(data) { |stream, _| L.lzma_alone_decoder(stream, L::UINT64_MAX) }
      end

      def alone_encode(data)
        code(data) { |stream, options| L.lzma_alone_encoder(stream, options) }
      end

      def raw_decode(data)
        code(data) { |stream, options| L.lzma_raw_decoder(stream, lzma2_filters(options)) }
      end

      def raw_encode(data)
        code(data) { |stream, options| L.lzma_raw_encoder(stream, lzma2_filters(options)) }
      end

      # Runs all of `data` through a coder. The block initialises it: it gets
      # the lzma_stream pointer and a pointer to the preset's
      # lzma_options_lzma, and returns an lzma_ret. liblzma copies what it
      # needs from the options during initialisation.
      def code(data)
        stream = L::LZMAStream.malloc
        L.LZMA_STREAM_INIT(stream)
        options = buffer(OPTIONS_SIZE)
        options[0, OPTIONS_SIZE] = "\0".b * OPTIONS_SIZE
        raise Error, "liblzma: unsupported preset #{PRESET}" if L.lzma_lzma_preset(options, PRESET) != 0
        check(yield(stream.to_ptr, options))

        input = buffer(data.bytesize)
        input[0, data.bytesize] = data
        output = buffer(CHUNK_SIZE)
        stream.next_in = input
        stream.avail_in = data.bytesize
        out = "".b
        loop do
          stream.next_out = output
          stream.avail_out = CHUNK_SIZE
          ret = L.lzma_code(stream.to_ptr, L::LZMA_FINISH)
          out << output[0, CHUNK_SIZE - stream.avail_out]
          return out if ret == L::LZMA_STREAM_END
          check(ret)
        end
      ensure
        if stream
          L.lzma_end(stream.to_ptr)
          Fiddle.free(stream.to_ptr)
        end
      end

      # lzma_filter[2]: a single LZMA2 filter with the given options.
      def lzma2_filters(options)
        chain = buffer(2 * Filter.size)
        lzma2 = Filter.new(chain)
        lzma2.id = FILTER_LZMA2
        lzma2.options = options
        terminator = Filter.new(chain + Filter.size)
        terminator.id = VLI_UNKNOWN
        terminator.options = nil
        chain
      end

      # Uninitialised memory that is freed when the pointer is collected.
      def buffer(size)
        Fiddle::Pointer.malloc([size, 1].max, Fiddle::RUBY_FREE)
      end

      def check(ret)
        return if ret == L::LZMA_OK
        raise Error, "liblzma: #{ERRORS.fetch(ret, "error code #{ret}")}"
      end
    end
  end
end
