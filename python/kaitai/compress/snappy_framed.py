# PyPI: python-snappy (raw block codec only; framing is implemented here)
import snappy

_STREAM_ID = b"\xff\x06\x00\x00sNaPpY"
_MAX_CHUNK = 65536  # uncompressed bytes per chunk


def _crc32c_table():
    table = []
    for crc in range(256):
        for _ in range(8):
            crc = (crc >> 1) ^ (0x82F63B78 if crc & 1 else 0)
        table.append(crc)
    return table


_TABLE = _crc32c_table()


def _masked_crc32c(data):
    crc = 0xFFFFFFFF
    for b in data:
        crc = _TABLE[(crc ^ b) & 0xFF] ^ (crc >> 8)
    crc ^= 0xFFFFFFFF
    return (((crc >> 15) | (crc << 17)) + 0xA282EAD8) & 0xFFFFFFFF


def _chunk(kind, body):
    return bytes([kind]) + len(body).to_bytes(3, "little") + body


class SnappyFramed:
    """Snappy framing format: a stream identifier chunk followed by
    compressed (0x00) and uncompressed (0x01) chunks, each carrying a masked
    CRC-32C of its uncompressed data, which is verified on decode."""

    def decode(self, data):
        if not data.startswith(_STREAM_ID):
            raise ValueError("snappy_framed: missing stream identifier")
        out = []
        pos = 0
        while pos < len(data):
            kind = data[pos]
            end = pos + 4 + int.from_bytes(data[pos + 1:pos + 4], "little")
            if end > len(data) or pos + 4 > len(data):
                raise ValueError("snappy_framed: truncated chunk")
            body = data[pos + 4:end]
            pos = end
            if kind == 0xFF:
                if body != _STREAM_ID[4:]:
                    raise ValueError("snappy_framed: bad stream identifier")
            elif kind in (0x00, 0x01):
                if len(body) < 4:
                    raise ValueError("snappy_framed: chunk too short")
                payload = snappy.decompress(body[4:]) if kind == 0x00 else body[4:]
                if _masked_crc32c(payload) != int.from_bytes(body[:4], "little"):
                    raise ValueError("snappy_framed: CRC mismatch")
                out.append(payload)
            elif kind < 0x80:
                raise ValueError("snappy_framed: reserved unskippable chunk 0x%02x" % kind)
            # 0x80..0xfe: skippable or padding
        return b"".join(out)

    def encode(self, data):
        out = [_STREAM_ID]
        for i in range(0, len(data), _MAX_CHUNK):
            payload = data[i:i + _MAX_CHUNK]
            crc = _masked_crc32c(payload).to_bytes(4, "little")
            compressed = snappy.compress(payload)
            if len(compressed) < len(payload):
                out.append(_chunk(0x00, crc + compressed))
            else:
                out.append(_chunk(0x01, crc + payload))
        return b"".join(out)
