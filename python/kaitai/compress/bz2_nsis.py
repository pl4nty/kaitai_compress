"""bzip2 as NSIS writes it.

NSIS's bzip2 is the bzip2 block format without the stream framing: no "BZh"
header, and each block starts with the byte 0x31 instead of the 48-bit block
magic and CRC-32, with 0x17 instead of the end-of-stream magic and combined
CRC. Blocks are bit-aligned, as in bzip2, and hold up to 900 kB. NSIS 2 and 3
blocks have no "randomised" bit; NSIS 1 blocks do, and are tried if the
first reading fails. Randomised blocks are not supported. Data after the end
marker is ignored.
"""

_MAX_BLOCK = 900000


class _Bits:
    """MSB-first bit reader."""

    def __init__(self, data):
        self.data = data
        self.pos = 0
        self.buf = 0
        self.cnt = 0

    def bits(self, n):
        while self.cnt < n:
            if self.pos >= len(self.data):
                raise ValueError("bz2_nsis: truncated input")
            self.buf = self.buf << 8 | self.data[self.pos]
            self.pos += 1
            self.cnt += 8
        self.cnt -= n
        v = self.buf >> self.cnt
        self.buf &= (1 << self.cnt) - 1
        return v


def _huffman(lengths):
    """Canonical code as (min length, limit, base, perm), bzip2 style."""
    lo, hi = min(lengths), max(lengths)
    perm = [s for n in range(lo, hi + 1) for s, ln in enumerate(lengths) if ln == n]
    limit, base = {}, {}
    code, i = 0, 0
    for n in range(lo, hi + 1):
        count = lengths.count(n)
        base[n] = i - code  # perm index = code + base
        code += count
        i += count
        limit[n] = code - 1
        code <<= 1
    return lo, hi, limit, base, perm


def _symbol(r, table):
    lo, hi, limit, base, perm = table
    n = lo
    code = r.bits(lo)
    while code > limit[n]:
        n += 1
        if n > hi:
            raise ValueError("bz2_nsis: invalid Huffman code")
        code = code << 1 | r.bits(1)
    return perm[code + base[n]]


def _block(r, randomised_bit):
    if randomised_bit and r.bits(1):
        raise ValueError("bz2_nsis: randomised blocks are not supported")
    orig_ptr = r.bits(24)
    used16 = r.bits(16)
    seq = [i * 16 + j for i in range(16) if used16 >> (15 - i) & 1
           for j in range(16) if r.bits(1)]
    if not seq:
        raise ValueError("bz2_nsis: block uses no symbols")
    alpha = len(seq) + 2
    n_groups = r.bits(3)
    n_selectors = r.bits(15)
    if not 2 <= n_groups <= 6 or n_selectors == 0:
        raise ValueError("bz2_nsis: invalid block header")
    mtf = list(range(n_groups))
    selectors = []
    for _ in range(n_selectors):
        j = 0
        while r.bits(1):
            j += 1
            if j >= n_groups:
                raise ValueError("bz2_nsis: invalid selector")
        mtf.insert(0, mtf.pop(j))
        selectors.append(mtf[0])
    tables = []
    for _ in range(n_groups):
        n = r.bits(5)
        lengths = []
        for _ in range(alpha):
            while True:
                if not 1 <= n <= 20:
                    raise ValueError("bz2_nsis: invalid code length")
                if not r.bits(1):
                    break
                n += -1 if r.bits(1) else 1
            lengths.append(n)
        tables.append(_huffman(lengths))

    # Huffman, then run lengths of RUNA/RUNB and move-to-front
    eob = alpha - 1
    order = list(seq)
    ll = bytearray()
    run, weight = 0, 1
    sel, left, table = 0, 0, None
    while True:
        if left == 0:
            if sel >= n_selectors:
                raise ValueError("bz2_nsis: ran out of selectors")
            table = tables[selectors[sel]]
            sel += 1
            left = 50
        left -= 1
        s = _symbol(r, table)
        if s <= 1:
            run += weight << s
            weight <<= 1
            if run > _MAX_BLOCK:
                raise ValueError("bz2_nsis: block too big")
            continue
        if run:
            if len(ll) + run > _MAX_BLOCK:
                raise ValueError("bz2_nsis: block too big")
            ll += bytes([order[0]]) * run
            run, weight = 0, 1
        if s == eob:
            break
        order.insert(0, order.pop(s - 1))
        ll.append(order[0])
        if len(ll) > _MAX_BLOCK:
            raise ValueError("bz2_nsis: block too big")
    if not ll:
        return bytearray()
    if len(ll) > _MAX_BLOCK or orig_ptr >= max(len(ll), 1):
        raise ValueError("bz2_nsis: invalid block size or origin pointer")

    # inverse Burrows-Wheeler transform
    start, total = [0] * 256, 0
    for b in range(256):
        start[b] = total
        total += ll.count(b)
    ptr = [0] * len(ll)
    for i, b in enumerate(ll):
        ptr[start[b]] = i
        start[b] += 1
    out = bytearray(len(ll))
    p = ptr[orig_ptr]
    for i in range(len(ll)):
        out[i] = ll[p]
        p = ptr[p]

    # undo the initial run-length encoding: 4 equal bytes, then a count
    res = bytearray()
    i, n, prev, same = 0, len(out), -1, 0
    while i < n:
        b = out[i]
        i += 1
        if same == 4:
            res += bytes([prev]) * b
            same = 0
            prev = -1
            continue
        res.append(b)
        same = same + 1 if b == prev else 1
        prev = b
    return res


def _decode(data, randomised_bit):
    r = _Bits(data)
    out = bytearray()
    while True:
        sig = r.bits(8)
        if sig == 0x17:
            return bytes(out)
        if sig != 0x31:
            raise ValueError("bz2_nsis: invalid block signature 0x%02x" % sig)
        out += _block(r, randomised_bit)


class Bz2Nsis:
    def decode(self, data):
        data = bytes(data)
        try:
            return _decode(data, False)
        except (ValueError, IndexError) as e:
            try:
                return _decode(data, True)
            except (ValueError, IndexError):
                raise ValueError(str(e)) from None

    def encode(self, data):
        raise NotImplementedError("bz2_nsis: encoding is not supported")
