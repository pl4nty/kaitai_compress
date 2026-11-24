import bz2


class Bz2:
    def decode(self, data):
        return bz2.decompress(data)

    def encode(self, data):
        return bz2.compress(data)
