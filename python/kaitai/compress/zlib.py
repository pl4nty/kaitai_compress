import zlib

# Optional PyPI: isal, a faster drop-in for decompression. Encoding always uses
# zlib so output does not depend on which libraries are installed.
try:
    from isal import isal_zlib as _inflate
except ImportError:
    _inflate = zlib


class Zlib:
    def decode(self, data):
        return _inflate.decompress(data)

    def encode(self, data):
        return zlib.compress(data)
