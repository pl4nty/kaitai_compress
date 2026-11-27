"""Raw deflate as NSIS writes it.

NSIS 2.x compresses with its own copy of zlib whose stored blocks have no
NLEN (the one's complement of LEN); NSIS 3 uses stock zlib. A stored block
is read as NSIS 3 if the two bytes after LEN are its complement, else as
NSIS 2 (a wrong guess needs the first two stored bytes of an NSIS 2 block to
be the complement of its length). Data after the final block is ignored.
"""

import zlib

# Length and distance code bases and extra bits (RFC 1951, 3.2.5)
_LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
             35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
_LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2,
              3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
_DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
              257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145,
              8193, 12289, 16385, 24577]
_DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
               7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
_CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]


def _table(lengths):
    """Lookup table indexed by the next `bits` input bits (LSB first):
    each entry is symbol << 4 | code length, or -1 for an unused code."""
    bits = max(lengths)
    if bits == 0:
        return [-1], 0
    counts = [0] * 16
    for n in lengths:
        counts[n] += 1
    counts[0] = 0
    code, next_code, left = 0, [0] * 16, 1
    for n in range(1, 16):
        left = left * 2 - counts[n]
        if left < 0:
            raise ValueError("deflate_nsis: over-subscribed Huffman code")
        code = (code + counts[n - 1]) << 1
        next_code[n] = code
    table = [-1] * (1 << bits)
    for sym, n in enumerate(lengths):
        if n == 0:
            continue
        c = next_code[n]
        next_code[n] += 1
        rev = int(format(c, "0%db" % n)[::-1], 2)
        for i in range(rev, 1 << bits, 1 << n):
            table[i] = sym << 4 | n
    return table, bits


_FIXED = (_table([8] * 144 + [9] * 112 + [7] * 24 + [8] * 8), _table([5] * 30))


class _Inflater:
    def __init__(self, data):
        self.data = data
        self.pos = 0
        self.buf = 0
        self.cnt = 0

    def bits(self, n):
        while self.cnt < n:
            if self.pos >= len(self.data):
                raise ValueError("deflate_nsis: truncated input")
            self.buf |= self.data[self.pos] << self.cnt
            self.pos += 1
            self.cnt += 8
        v = self.buf & ((1 << n) - 1)
        self.buf >>= n
        self.cnt -= n
        return v

    def sym(self, table):
        tab, n = table
        while self.cnt < n and self.pos < len(self.data):
            self.buf |= self.data[self.pos] << self.cnt
            self.pos += 1
            self.cnt += 8
        e = tab[self.buf & ((1 << n) - 1)]
        if e < 0 or (e & 15) > self.cnt:
            raise ValueError("deflate_nsis: invalid Huffman code or truncated input")
        self.buf >>= e & 15
        self.cnt -= e & 15
        return e >> 4

    def u16_aligned(self):
        lo = self.bits(8)
        return lo | self.bits(8) << 8

    def dynamic_tables(self):
        hlit = self.bits(5) + 257
        hdist = self.bits(5) + 1
        hclen = self.bits(4) + 4
        cl = [0] * 19
        for i in range(hclen):
            cl[_CL_ORDER[i]] = self.bits(3)
        cl_table = _table(cl)
        lengths = []
        while len(lengths) < hlit + hdist:
            s = self.sym(cl_table)
            if s < 16:
                lengths.append(s)
            elif s == 16:
                if not lengths:
                    raise ValueError("deflate_nsis: repeat with no previous length")
                lengths += [lengths[-1]] * (3 + self.bits(2))
            elif s == 17:
                lengths += [0] * (3 + self.bits(3))
            else:
                lengths += [0] * (11 + self.bits(7))
        if len(lengths) > hlit + hdist:
            raise ValueError("deflate_nsis: code lengths overflow")
        if lengths[256] == 0:
            raise ValueError("deflate_nsis: no end-of-block code")
        return _table(lengths[:hlit]), _table(lengths[hlit:])

    def run(self):
        out = bytearray()
        final = 0
        while not final:
            final = self.bits(1)
            kind = self.bits(2)
            if kind == 0:
                self._stored(out)
            elif kind == 3:
                raise ValueError("deflate_nsis: invalid block type 3")
            else:
                lit, dist = _FIXED if kind == 1 else self.dynamic_tables()
                self._codes(out, lit, dist)
        return bytes(out)

    def _stored(self, out):
        # Byte-align and hand the whole bytes still buffered back to the input.
        self.pos -= self.cnt // 8
        self.buf = self.cnt = 0
        data, pos = self.data, self.pos
        if pos + 2 > len(data):
            raise ValueError("deflate_nsis: truncated input")
        length = data[pos] | data[pos + 1] << 8
        pos += 2
        # NSIS 2 writes no NLEN; standard deflate (NSIS 3) does.
        if pos + 2 <= len(data) and (data[pos] | data[pos + 1] << 8) == length ^ 0xFFFF:
            pos += 2
        if pos + length > len(data):
            raise ValueError("deflate_nsis: truncated stored block")
        out += data[pos:pos + length]
        self.pos = pos + length

    def _codes(self, out, lit, dist):
        while True:
            s = self.sym(lit)
            if s < 256:
                out.append(s)
                continue
            if s == 256:
                return
            s -= 257
            if s >= 29:
                raise ValueError("deflate_nsis: invalid length code")
            n = _LEN_BASE[s] + self.bits(_LEN_EXTRA[s])
            d = self.sym(dist)
            if d >= 30:
                raise ValueError("deflate_nsis: invalid distance code")
            d = _DIST_BASE[d] + self.bits(_DIST_EXTRA[d])
            if d > len(out):
                raise ValueError("deflate_nsis: distance too far back")
            if d >= n:
                out += out[-d:len(out) - d + n]
            else:
                for _ in range(n):
                    out.append(out[-d])


class DeflateNsis:
    def decode(self, data):
        return _Inflater(bytes(data)).run()

    def encode(self, data):
        # Stock raw deflate, as NSIS 3 writes it; decode reads it back.
        c = zlib.compressobj(9, zlib.DEFLATED, -15)
        return c.compress(data) + c.flush()
