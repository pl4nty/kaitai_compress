# PyPI: pycryptodome
from Crypto.Cipher import AES, DES, DES3
from Crypto.Util.Padding import pad, unpad

_ALGORITHMS = {"des": DES, "3des": DES3, "des3": DES3, "aes": AES}
_MODES = {"ecb": "MODE_ECB", "cbc": "MODE_CBC"}
_PADDINGS = ("pkcs7", "none")


def _to_bytes(value):
    return value.encode("latin-1") if isinstance(value, str) else bytes(value)


class BlockCipher:
    """DES, 3DES or AES in ECB or CBC mode, with PKCS#7 or no padding.

    decode decrypts and strictly removes the padding; encode pads and encrypts.
    """

    def __init__(self, algorithm, mode, key, iv=None, padding="pkcs7"):
        try:
            self.cipher = _ALGORITHMS[algorithm.lower()]
        except KeyError:
            raise ValueError("block_cipher: unknown algorithm %r, expected one of %s" % (algorithm, ", ".join(_ALGORITHMS))) from None
        try:
            self.mode = getattr(self.cipher, _MODES[mode.lower()])
        except KeyError:
            raise ValueError("block_cipher: unknown mode %r, expected one of %s" % (mode, ", ".join(_MODES))) from None
        if padding.lower() not in _PADDINGS:
            raise ValueError("block_cipher: unknown padding %r, expected one of %s" % (padding, ", ".join(_PADDINGS)))
        self.padding = padding.lower()
        self.key = _to_bytes(key)
        if len(self.key) not in self._key_sizes():
            raise ValueError("block_cipher: %s key must be %s bytes, got %d" % (
                algorithm, " or ".join(map(str, self._key_sizes())), len(self.key)))
        self.block_size = self.cipher.block_size
        self.iv = None
        if self.mode == self.cipher.MODE_CBC:
            if iv is None:
                raise ValueError("block_cipher: cbc mode requires an iv")
            self.iv = _to_bytes(iv)
            if len(self.iv) != self.block_size:
                raise ValueError("block_cipher: iv must be %d bytes, got %d" % (self.block_size, len(self.iv)))

    def _key_sizes(self):
        return {DES: (8,), DES3: (16, 24), AES: (16, 24, 32)}[self.cipher]

    def _new(self):
        if self.iv is None:
            return self.cipher.new(self.key, self.mode)
        return self.cipher.new(self.key, self.mode, iv=self.iv)

    def decode(self, data):
        if len(data) % self.block_size:
            raise ValueError("block_cipher: data length %d is not a multiple of block size %d" % (len(data), self.block_size))
        if self.padding == "none":
            return self._new().decrypt(data)
        if not data:
            raise ValueError("block_cipher: empty input cannot be unpadded")
        return unpad(self._new().decrypt(data), self.block_size, style="pkcs7")

    def encode(self, data):
        if self.padding == "pkcs7":
            data = pad(data, self.block_size, style="pkcs7")
        elif len(data) % self.block_size:
            raise ValueError("block_cipher: data length %d is not a multiple of block size %d" % (len(data), self.block_size))
        return self._new().encrypt(data)
