class Lz4Block:
    """Raw LZ4 block (no frame header, no size prefix).

    Decodes at most `uncompressed_size` bytes: decoding stops as soon as that
    many bytes have been produced, so trailing bytes after the last sequence
    (e.g. alignment padding in CSO/ZSO disc images) are ignored. A match that
    would run past `uncompressed_size` is an error. The decoder is pure Python; only encode needs
    the `lz4` package (PyPI: lz4).
    """

    def __init__(self, uncompressed_size):
        self.uncompressed_size = uncompressed_size

    def decode(self, data):
        size = self.uncompressed_size
        out = bytearray()
        pos = 0
        end = len(data)
        # A block whose last sequence ends with the input may decode to fewer
        # than `size` bytes (e.g. a short final block).
        while len(out) < size and pos < end:
            token = data[pos]
            pos += 1
            lit_len = token >> 4
            if lit_len == 15:
                while True:
                    if pos >= end:
                        raise ValueError("lz4_block: truncated literal length")
                    b = data[pos]
                    pos += 1
                    lit_len += b
                    if b != 255:
                        break
            if pos + lit_len > end:
                raise ValueError("lz4_block: truncated literals")
            out += data[pos:pos + lit_len]
            pos += lit_len
            if len(out) >= size or pos == end:  # last sequence: literals only
                break
            if pos + 2 > end:
                raise ValueError("lz4_block: truncated match offset")
            offset = data[pos] | (data[pos + 1] << 8)
            pos += 2
            if offset == 0 or offset > len(out):
                raise ValueError("lz4_block: invalid match offset %d at output position %d" % (offset, len(out)))
            match_len = token & 0x0F
            if match_len == 15:
                while True:
                    if pos >= end:
                        raise ValueError("lz4_block: truncated match length")
                    b = data[pos]
                    pos += 1
                    match_len += b
                    if b != 255:
                        break
            match_len += 4
            start = len(out) - offset
            if match_len <= offset:
                out += out[start:start + match_len]
            else:  # overlapping copy: repeat the last `offset` bytes
                chunk = out[start:]
                reps, rest = divmod(match_len, offset)
                out += chunk * reps + chunk[:rest]
        if len(out) > size:
            raise ValueError("lz4_block: block decodes to more than %d bytes" % size)
        return bytes(out)

    def encode(self, data):
        # PyPI: lz4
        import lz4.block
        return lz4.block.compress(data, store_size=False)
