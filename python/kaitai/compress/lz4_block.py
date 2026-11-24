class Lz4Block:
    """Raw LZ4 block (no frame header, no size prefix).

    Decodes at most `uncompressed_size` bytes. Decoding stops as soon as that
    many bytes have been produced, and only then are the remaining input bytes
    (e.g. alignment padding in CSO/ZSO disc images) ignored. A block may also
    end with the input after a complete sequence and decode to fewer bytes, but
    a short block followed by padding is an error: the padding is read as more
    sequences. Output beyond `uncompressed_size` is an error.

    The decoder is pure Python. encode uses the `lz4` package (PyPI: lz4)
    when it is installed, otherwise it writes a valid literal-only block.
    """

    def __init__(self, uncompressed_size):
        if isinstance(uncompressed_size, bool) or not isinstance(uncompressed_size, int) or uncompressed_size < 0:
            raise ValueError("lz4_block: uncompressed_size must be a non-negative integer, got %r" % (uncompressed_size,))
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
        try:
            import lz4.block  # PyPI: lz4
        except ImportError:
            return _encode_literals(data)
        return lz4.block.compress(bytes(data), store_size=False)


def _encode_literals(data):
    """A valid LZ4 block holding `data` as a single literal-only sequence."""
    n = len(data)
    if n < 15:
        return bytes([n << 4]) + bytes(data)
    rest = n - 15
    return bytes([0xF0]) + b"\xff" * (rest // 255) + bytes([rest % 255]) + bytes(data)
