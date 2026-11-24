# Optional PyPI: isal (faster drop-in replacement for zlib)
try:
    from isal import isal_zlib as zlib
except ImportError:
    import zlib


class Deflate:
    """Raw deflate stream (RFC 1951), no zlib or gzip header."""

    def decode(self, data):
        return zlib.decompress(data, -zlib.MAX_WBITS)

    def encode(self, data):
        c = zlib.compressobj(wbits=-zlib.MAX_WBITS)
        return c.compress(data) + c.flush()
