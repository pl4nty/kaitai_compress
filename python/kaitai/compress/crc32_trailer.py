import zlib


class Crc32Trailer:
    """Data followed by a little-endian CRC-32 of (data + salt).

    decode verifies the CRC and returns the data unchanged, trailer included;
    encode replaces the last 4 bytes with a freshly computed CRC.
    """

    def __init__(self, salt=b""):
        self.salt = salt.encode("latin-1") if isinstance(salt, str) else bytes(salt)

    def _crc(self, data):
        if len(data) < 4:
            raise ValueError("crc32_trailer: need at least 4 bytes, got %d" % len(data))
        return zlib.crc32(data[:-4] + self.salt)

    def decode(self, data):
        stored = int.from_bytes(data[-4:], "little")
        computed = self._crc(data)
        if stored != computed:
            raise ValueError("crc32_trailer: CRC mismatch: stored 0x%08x, computed 0x%08x" % (stored, computed))
        return data

    def encode(self, data):
        return bytes(data[:-4]) + self._crc(data).to_bytes(4, "little")
