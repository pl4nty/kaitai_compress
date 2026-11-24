# Kaitai Struct compression, checksum and encryption processes.
#
# ksc emits `Kaitai::Compress::Name.new(...)` without a require, so this file
# registers every process class with autoload: requiring it is enough, and
# each process's library is only loaded when that process is first used.
module Kaitai
  module Compress
    autoload :Error, 'kaitai/compress/error'

    {
      BlockCipher: 'block_cipher',
      Brotli: 'brotli',
      Bz2: 'bz2',
      Crc32Trailer: 'crc32_trailer',
      Deflate: 'deflate',
      Gzip: 'gzip',
      Implode: 'implode',
      Lz4: 'lz4',
      LzmaLzma: 'lzma_lzma',
      LzmaRaw: 'lzma_raw',
      LzmaXz: 'lzma_xz',
      Snappy: 'snappy',
      SnappyFramed: 'snappy_framed',
      Zlib: 'zlib',
      Zstd: 'zstd',
    }.each { |name, file| autoload name, "kaitai/compress/#{file}" }
  end
end
