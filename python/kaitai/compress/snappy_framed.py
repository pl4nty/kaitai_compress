# PyPI: python-snappy (raw block codec only; framing is implemented here)
import struct

import snappy

_STREAM_ID = b"\xff\x06\x00\x00sNaPpY"
_MAX_CHUNK = 65536


def _crc32c_table():
    table = []
    for i in range(256):
        crc = i
        for _ in range(8):
            crc = (crc >> 1) ^ (0x82F63B78 if crc & 1 else 0)
        table.append(crc)
    return table


_TABLE = _crc32c_table()


def _masked_crc32c(data):
    crc = 0xFFFFFFFF
    table = _TABLE
    for b in data:
        crc = table[(crc ^ b) & 0xFF] ^ (crc >> 8)
    crc ^= 0xFFFFFFFF
    return (((crc >> 15) | (crc << 17)) + 0xA282EAD8) & 0xFFFFFFFF


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
            if pos + 4 > len(data):
                raise ValueError("snappy_framed: truncated chunk header")
            kind = data[pos]
            length = int.from_bytes(data[pos + 1:pos + 4], "little")
            body = data[pos + 4:pos + 4 + length]
            if len(body) != length:
                raise ValueError("snappy_framed: truncated chunk")
            pos += 4 + length
            if kind == 0xFF:
                if data[pos - 10:pos] != _STREAM_ID:
                    raise ValueError("snappy_framed: bad stream identifier")
            elif kind in (0x00, 0x01):
                if length < 4:
                    raise ValueError("snappy_framed: chunk too short")
                (crc,) = struct.unpack("<I", body[:4])
                chunk = snappy.decompress(body[4:]) if kind == 0x00 else body[4:]
                if _masked_crc32c(chunk) != crc:
                    raise ValueError("snappy_framed: CRC mismatch")
                out.append(chunk)
            elif kind < 0x80:
                raise ValueError("snappy_framed: reserved unskippable chunk 0x%02x" % kind)
            # 0x80..0xfe: skippable or padding
        return b"".join(out)

    def encode(self, data):
        out = [_STREAM_ID]
        for i in range(0, len(data), _MAX_CHUNK):
            chunk = data[i:i + _MAX_CHUNK]
            crc = struct.pack("<I", _masked_crc32c(chunk))
            compressed = snappy.compress(chunk)
            if len(compressed) < len(chunk):
                kind, body = 0x00, compressed
            else:
                kind, body = 0x01, chunk
            out.append(struct.pack("<I", kind | (len(body) + 4) << 8) + crc + body)
        return b"".join(out)
