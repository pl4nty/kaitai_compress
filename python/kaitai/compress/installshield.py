_ROTATE = bytes((b << 4 | b >> 4) & 0xFF for b in range(256))
_MAGIC = b"\x13\x35\x86\x07"


class Installshield:
    """The obfuscation of files in an InstallShield setup launcher.

    Each byte b becomes ~(key[i % len(key)] ^ rotl(b, 4)), where the key is
    the file name (UTF-8) XORed with 13 35 86 07 repeated, and i restarts
    at 0 every 1024 bytes if `chunked` (flag 4 of the file entry). The
    result is often zlib data, which is left to the caller.
    """

    def __init__(self, name, chunked=False):
        name = name.encode("utf-8") if isinstance(name, str) else bytes(name)
        if not name:
            raise ValueError("installshield: empty file name")
        # the key with the final NOT folded in
        self.key = bytes(b ^ _MAGIC[i % 4] ^ 0xFF for i, b in enumerate(name))
        self.chunked = chunked

    def _xor(self, data):
        key = self.key
        if self.chunked:
            key = (key * (1024 // len(key) + 1))[:1024]
        stream = (key * (len(data) // len(key) + 1))[:len(data)]
        x = int.from_bytes(data, "little") ^ int.from_bytes(stream, "little")
        return x.to_bytes(len(data), "little")

    def decode(self, data):
        return self._xor(bytes(data).translate(_ROTATE))

    def encode(self, data):
        return self._xor(bytes(data)).translate(_ROTATE)
