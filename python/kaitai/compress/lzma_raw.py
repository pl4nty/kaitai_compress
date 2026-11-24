import lzma

# Raw streams carry no header, so the filter chain must be given explicitly.
# This matches `xz --format=raw` defaults: a single LZMA2 filter, preset 6.
_FILTERS = [{"id": lzma.FILTER_LZMA2, "preset": 6}]


class LzmaRaw:
    def decode(self, data):
        return lzma.decompress(data, format=lzma.FORMAT_RAW, filters=_FILTERS)

    def encode(self, data):
        return lzma.compress(data, format=lzma.FORMAT_RAW, filters=_FILTERS)
