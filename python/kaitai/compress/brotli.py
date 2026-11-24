# PyPI: brotli
import brotli


class Brotli:
    def decode(self, data):
        return brotli.decompress(data)

    def encode(self, data):
        return brotli.compress(data)
