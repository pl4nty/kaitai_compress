import lzma


class LzmaXz:
    def decode(self, data):
        return lzma.decompress(data, format=lzma.FORMAT_XZ)

    def encode(self, data):
        return lzma.compress(data, format=lzma.FORMAT_XZ)
