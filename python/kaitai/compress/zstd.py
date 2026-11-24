# PyPI: zstandard
import zstandard


class Zstd:
    """Zstandard frames; frames without a content size and concatenated frames are supported."""

    def decode(self, data):
        dctx = zstandard.ZstdDecompressor()
        out = []
        while True:
            obj = dctx.decompressobj()
            out.append(obj.decompress(data))
            if not obj.eof:
                raise ValueError("zstd: truncated frame")
            data = obj.unused_data
            if not data:
                return b"".join(out)

    def encode(self, data):
        return zstandard.ZstdCompressor().compress(data)
