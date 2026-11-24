# Optional PyPI: isal (faster drop-in replacement for gzip)
try:
    from isal import igzip as gzip
except ImportError:
    import gzip


class Gzip:
    """gzip (RFC 1952); concatenated members are decoded as one stream."""

    def decode(self, data):
        return gzip.decompress(data)

    def encode(self, data):
        return gzip.compress(data, mtime=0)
