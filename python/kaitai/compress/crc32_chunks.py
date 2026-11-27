import zlib


class Crc32Chunks:
    """Data in chunks of `chunk_size` bytes (the last one may be shorter),
    each preceded by the little-endian CRC-32 of the chunk, as Inno Setup
    stores its compressed headers (4096-byte chunks).

    decode verifies every CRC and returns the chunks joined; encode splits
    and adds the CRCs.
    """

    def __init__(self, chunk_size):
        if isinstance(chunk_size, bool) or not isinstance(chunk_size, int) or chunk_size < 1:
            raise ValueError("crc32_chunks: chunk_size must be a positive integer, got %r" % (chunk_size,))
        self.chunk_size = chunk_size

    def decode(self, data):
        out = bytearray()
        pos, n = 0, len(data)
        while pos < n:
            if n - pos <= 4:
                raise ValueError("crc32_chunks: truncated chunk at offset %d" % pos)
            stored = int.from_bytes(data[pos:pos + 4], "little")
            chunk = data[pos + 4:pos + 4 + self.chunk_size]
            if zlib.crc32(chunk) != stored:
                raise ValueError("crc32_chunks: CRC mismatch in chunk at offset %d" % pos)
            out += chunk
            pos += 4 + len(chunk)
        return bytes(out)

    def encode(self, data):
        out = bytearray()
        for i in range(0, len(data), self.chunk_size):
            chunk = data[i:i + self.chunk_size]
            out += zlib.crc32(chunk).to_bytes(4, "little") + chunk
        return bytes(out)
