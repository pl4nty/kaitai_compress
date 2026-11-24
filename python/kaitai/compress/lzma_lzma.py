import lzma


class LzmaLzma:
    def decode(self, data):
        return lzma.decompress(data, format=lzma.FORMAT_ALONE)

    def encode(self, data):
        return lzma.compress(data, format=lzma.FORMAT_ALONE)
