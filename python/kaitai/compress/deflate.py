import zlib

# Optional PyPI: isal, a faster drop-in for decompression. Encoding always uses
# zlib so output does not depend on which libraries are installed.
try:
    from isal import isal_zlib as _inflate
except ImportError:
    _inflate = zlib


class Deflate:
    """Raw deflate stream (RFC 1951), no zlib or gzip header."""

    def decode(self, data):
        return _inflate.decompress(data, -zlib.MAX_WBITS)

    def encode(self, data):
        c = zlib.compressobj(wbits=-zlib.MAX_WBITS)
        return c.compress(data) + c.flush()
