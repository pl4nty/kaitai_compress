# PyPI: pycryptodome
from Crypto.Cipher import AES, DES, DES3
from Crypto.Util.Padding import pad, unpad

_ALGORITHMS = {"des": DES, "3des": DES3, "des3": DES3, "aes": AES}
_MODES = {"ecb": AES.MODE_ECB, "cbc": AES.MODE_CBC}  # same constants for every algorithm
_PADDINGS = {"pkcs7": True, "none": False}


def _to_bytes(value):
    return value.encode("latin-1") if isinstance(value, str) else bytes(value)


def _lookup(what, choices, name):
    try:
        return choices[name.lower()]
    except KeyError:
        raise ValueError("block_cipher: unknown %s %r, expected one of %s" % (what, name, ", ".join(choices))) from None


class BlockCipher:
    """DES, 3DES or AES in ECB or CBC mode, with PKCS#7 or no padding.

    decode decrypts and strictly removes the padding; encode pads and encrypts.
    Every error (bad arguments, key/iv/data length, padding) is a ValueError.
    """

    def __init__(self, algorithm, mode, key, iv=None, padding="pkcs7"):
        self.cipher = _lookup("algorithm", _ALGORITHMS, algorithm)
        self.args = [_to_bytes(key), _lookup("mode", _MODES, mode)]
        self.padded = _lookup("padding", _PADDINGS, padding)
        if mode.lower() == "cbc":
            if iv is None:  # the library would silently pick a random one
                raise ValueError("block_cipher: cbc mode requires an iv")
            self.args.append(_to_bytes(iv))
        self._new()  # report a wrong key or iv length now rather than on first use

    def _new(self):
        return self.cipher.new(*self.args)

    def decode(self, data):
        data = self._new().decrypt(data)
        return unpad(data, self.cipher.block_size) if self.padded else data

    def encode(self, data):
        if self.padded:
            data = pad(data, self.cipher.block_size)
        return self._new().encrypt(data)
