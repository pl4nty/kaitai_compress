# PyPI: python-snappy
import snappy


class Snappy:
    """Raw snappy block, no framing."""

    def decode(self, data):
        return snappy.decompress(data)

    def encode(self, data):
        return snappy.compress(data)
