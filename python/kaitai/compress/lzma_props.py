import lzma


class LzmaProps:
    """LZMA1 data after its 5 property bytes (lc/lp/pb, then the u4le
    dictionary size), with no uncompressed size: the "properties + stream"
    form that NSIS and Inno Setup store, and 7-Zip calls LZMA.

    The stream must end with an end marker, as NSIS and Inno Setup write
    it; bytes after the end marker are ignored. With `filter_flag`
    (NSIS), a byte before the properties says whether the BCJ x86 filter
    was applied: 0 for no, 1 for yes.
    """

    def __init__(self, filter_flag=False):
        self.filter_flag = filter_flag

    @staticmethod
    def _filters(props, x86):
        lc, lp, pb = props[0] % 9, props[0] // 9 % 5, props[0] // 45
        if props[0] >= 9 * 5 * 5:
            raise ValueError("lzma_props: invalid properties byte 0x%02x" % props[0])
        if lc + lp > 4:
            raise ValueError("lzma_props: lc + lp > 4 is not supported (properties byte 0x%02x)" % props[0])
        lzma1 = {"id": lzma.FILTER_LZMA1, "lc": lc, "lp": lp, "pb": pb,
                 "dict_size": max(int.from_bytes(props[1:5], "little"), 4096)}
        return ([{"id": lzma.FILTER_X86}] if x86 else []) + [lzma1]

    def decode(self, data):
        data = bytes(data)
        x86 = False
        if self.filter_flag:
            if not data or data[0] > 1:
                raise ValueError("lzma_props: invalid filter flag")
            x86, data = data[0] == 1, data[1:]
        if len(data) < 5:
            raise ValueError("lzma_props: truncated properties")
        d = lzma.LZMADecompressor(lzma.FORMAT_RAW, filters=self._filters(data, x86))
        try:
            out = d.decompress(data[5:])
        except lzma.LZMAError as e:
            raise ValueError("lzma_props: %s" % e) from None
        if not d.eof:
            raise ValueError("lzma_props: truncated input (no end marker)")
        return out

    def encode(self, data):
        props = bytes([93]) + (1 << 23).to_bytes(4, "little")  # lc=3 lp=0 pb=2, 8 MiB
        out = props + lzma.compress(data, lzma.FORMAT_RAW, filters=self._filters(props, False))
        return b"\x00" + out if self.filter_flag else out
