import gzip

# Optional PyPI: isal, a faster drop-in for decompression. Encoding always uses
# the stdlib so output does not depend on which libraries are installed.
try:
    from isal import igzip as _gunzip
except ImportError:
    _gunzip = gzip


class Gzip:
    """gzip (RFC 1952); concatenated members are decoded as one stream."""

    def decode(self, data):
        return _gunzip.decompress(data)

    def encode(self, data):
        return gzip.compress(data, mtime=0)
