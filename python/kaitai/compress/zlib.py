# Optional PyPI: isal (faster drop-in replacement for zlib)
try:
    from isal import isal_zlib as zlib
except ImportError:
    import zlib


class Zlib:
    def decode(self, data):
        return zlib.decompress(data)

    def encode(self, data):
        return zlib.compress(data)
