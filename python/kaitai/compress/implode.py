# PKWare Data Compression Library (DCL) "implode" decompressor (decode only).
# Note: this is NOT the "implode" method (6) of PKZIP, which is a different format.
#
# Port of blast.c by Mark Adler (zlib contrib/blast, version 1.3). This is an
# altered version: translated from C to Python for kaitai_compress, decoding a
# whole in-memory buffer. It is not the original software.
#
# Original copyright and licence notice of blast.c / blast.h:
#
#   Copyright (C) 2003, 2012, 2013 Mark Adler
#
#   This software is provided 'as-is', without any express or implied
#   warranty.  In no event will the author be held liable for any damages
#   arising from the use of this software.
#
#   Permission is granted to anyone to use this software for any purpose,
#   including commercial applications, and to alter it and redistribute it
#   freely, subject to the following restrictions:
#
#   1. The origin of this software must not be misrepresented; you must not
#      claim that you wrote the original software. If you use this software
#      in a product, an acknowledgment in the product documentation would be
#      appreciated but is not required.
#   2. Altered source versions must be plainly marked as such, and must not be
#      misrepresented as being the original software.
#   3. This notice may not be removed or altered from any source distribution.
#
#   Mark Adler    madler@alumni.caltech.edu

MAXBITS = 13  # maximum code length


def _construct(rep):
    """Build a canonical Huffman table (count, symbol) from run-length coded
    code lengths: each byte is (repeat count - 1) << 4 | code length."""
    length = []
    for b in rep:
        length += [b & 15] * ((b >> 4) + 1)
    count = [0] * (MAXBITS + 1)
    for ln in length:
        count[ln] += 1
    offs = [0] * (MAXBITS + 1)
    for ln in range(1, MAXBITS):
        offs[ln + 1] = offs[ln] + count[ln]
    symbol = [0] * len(length)
    for sym, ln in enumerate(length):
        if ln:
            symbol[offs[ln]] = sym
            offs[ln] += 1
    return count, symbol


# fixed code tables of the format
_LITCODE = _construct([
    11, 124, 8, 7, 28, 7, 188, 13, 76, 4, 10, 8, 12, 10, 12, 10, 8, 23, 8,
    9, 7, 6, 7, 8, 7, 6, 55, 8, 23, 24, 12, 11, 7, 9, 11, 12, 6, 7, 22, 5,
    7, 24, 6, 11, 9, 6, 7, 22, 7, 11, 38, 7, 9, 8, 25, 11, 8, 11, 9, 12,
    8, 12, 5, 38, 5, 38, 5, 11, 7, 5, 6, 21, 6, 10, 53, 8, 7, 24, 10, 27,
    44, 253, 253, 253, 252, 252, 252, 13, 12, 45, 12, 45, 12, 61, 12, 45,
    44, 173])
_LENCODE = _construct([2, 35, 36, 53, 38, 23])
_DISTCODE = _construct([2, 20, 53, 230, 247, 151, 248])
_BASE = [3, 2, 4, 5, 6, 7, 8, 9, 10, 12, 16, 24, 40, 72, 136, 264]
_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8]


class _Decoder:
    def __init__(self, data):
        self.data = data
        self.pos = 0
        self.bitbuf = 0
        self.bitcnt = 0

    def bits(self, need):
        """Return need bits from the input, least significant bit first."""
        val = self.bitbuf
        while self.bitcnt < need:
            if self.pos >= len(self.data):
                raise ValueError("implode: unexpected end of input")
            val |= self.data[self.pos] << self.bitcnt
            self.pos += 1
            self.bitcnt += 8
        self.bitbuf = val >> need
        self.bitcnt -= need
        return val & ((1 << need) - 1)

    def decode(self, h):
        """Decode one symbol using Huffman table h. Stored codes are
        bit-reversed and inverted relative to canonical order."""
        count, symbol = h
        code = first = index = 0
        for ln in range(1, MAXBITS + 1):
            code |= self.bits(1) ^ 1
            cnt = count[ln]
            if code < first + cnt:
                return symbol[index + (code - first)]
            index += cnt
            first = (first + cnt) << 1
            code <<= 1
        raise ValueError("implode: invalid Huffman code")

    def run(self):
        lit = self.bits(8)
        if lit > 1:
            raise ValueError("implode: literal flag must be 0 or 1, got %d" % lit)
        dict_bits = self.bits(8)
        if dict_bits < 4 or dict_bits > 6:
            raise ValueError("implode: dictionary size code must be 4..6, got %d" % dict_bits)

        out = bytearray()
        while True:
            if self.bits(1):
                # length/distance pair
                symbol = self.decode(_LENCODE)
                length = _BASE[symbol] + self.bits(_EXTRA[symbol])
                if length == 519:  # end code
                    return bytes(out)
                low_bits = 2 if length == 2 else dict_bits
                dist = (self.decode(_DISTCODE) << low_bits) + self.bits(low_bits) + 1
                if dist > len(out):
                    raise ValueError("implode: distance too far back")
                start = len(out) - dist
                if length <= dist:
                    out += out[start:start + length]
                else:
                    # overlapping copy: repeat the last dist bytes
                    chunk = out[start:]
                    out += (chunk * (length // dist + 1))[:length]
            else:
                out.append(self.decode(_LITCODE) if lit else self.bits(8))


class Implode:
    """PKWare DCL implode. Decode only: there is no compressor here."""

    def decode(self, data):
        return _Decoder(data).run()

    def encode(self, data):
        raise NotImplementedError("implode: compression is not supported, only decompression")
