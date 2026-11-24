#!/usr/bin/env python3
"""Tests for the Python kaitai.compress processes.

For every process and every input in uncompressed/*.dat:
- parse the compressed test file with the compiled class, compare body;
- (where encode exists) write body back with the --read-write code, re-parse.

Run from _test/: see run-python.
"""

import importlib
import os
import unittest
from glob import glob

from kaitaistruct import KaitaiStream, BytesIO

import kaitai.compress

HERE = os.path.dirname(os.path.abspath(__file__))
NAMES = sorted(os.path.basename(f)[:-len(".dat")] for f in glob(os.path.join(HERE, "uncompressed", "*.dat")))

# (compiled module, test file extension, can encode, written bytes must equal the test file)
CASES = [
    ("test_brotli", "br", True, False),
    ("test_bz2", "bz2", True, False),
    ("test_deflate", "deflate", True, False),
    ("test_gzip", "gz", True, False),
    ("test_lz4", "lz4", True, False),
    ("test_lzma_lzma", "lzma", True, False),
    ("test_lzma_raw", "lzma_raw", True, False),
    ("test_lzma_xz", "xz", True, False),
    ("test_snappy", "raw.sz", True, False),
    ("test_snappy_framed", "framing2.sz", True, False),
    ("test_zlib", "zlib", True, False),
    ("test_zstd", "zst", True, False),
    ("test_implode_ascii", "ascii.implode", False, False),
    ("test_implode_binary", "binary.implode", False, False),
    ("test_des_cbc", "des_cbc", True, True),
    ("test_aes_cbc", "aes_cbc", True, True),
    ("test_aes_ecb", "aes_ecb", True, True),
]


def read(*path):
    with open(os.path.join(HERE, *path), "rb") as f:
        return f.read()


def compiled_class(module):
    mod = importlib.import_module(module)
    return getattr(mod, "".join(p.capitalize() for p in module.split("_")))


def parse(cls, data):
    obj = cls.from_bytes(data)
    obj._read()
    return obj


def write(obj, size):
    io = KaitaiStream(BytesIO(bytearray(size)))
    obj._write(io)
    return io.to_byte_array()


class TestProcesses(unittest.TestCase):
    def test_inputs_present(self):
        self.assertEqual(NAMES, ["25k_uuids", "90_a", "ascii_text"])

    def test_all_classes_listed(self):
        for name in kaitai.compress.__all__:
            self.assertIn(name, dir(kaitai.compress))
        with self.assertRaises(AttributeError):
            kaitai.compress.NoSuchProcess

    def _check_case(self, module, ext, can_encode, exact):
        cls = compiled_class(module)
        for name in NAMES:
            with self.subTest(file="%s.%s" % (name, ext)):
                expected = read("uncompressed", name + ".dat")
                compressed = read("compressed", "%s.%s" % (name, ext))
                self.assertEqual(parse(cls, compressed).body, expected)
                if not can_encode:
                    continue

                obj = cls()
                obj.body = expected
                obj._check()
                # Size the output from a dry run of the same encoder.
                size = len(_encoder_for(module).encode(expected))
                written = write(obj, size)
                self.assertEqual(parse(cls, written).body, expected)
                if exact:
                    self.assertEqual(written, compressed)

    def test_crc32_trailer(self):
        cls = compiled_class("test_crc32_trailer")
        for name in NAMES:
            with self.subTest(file=name):
                expected = read("uncompressed", name + ".dat")
                framed_file = read("compressed", name + ".crc32_trailer")
                self.assertEqual(parse(cls, framed_file).body, expected)

                obj = cls()
                framed = cls.Framed(None, obj, obj)
                framed.body = expected
                framed.crc = 0  # replaced by encode
                framed._check()
                obj.framed = framed
                obj.framed__inner_size = len(expected) + 4
                obj._check()
                written = write(obj, len(expected) + 4)
                self.assertEqual(written, framed_file)
                self.assertEqual(parse(cls, written).body, expected)


_ENCODERS = {
    "test_des_cbc": lambda: kaitai.compress.BlockCipher("des", "cbc", "S3crtMsG", "S3crtMsG"),
    "test_aes_cbc": lambda: kaitai.compress.BlockCipher("aes", "cbc", "0123456789abcdef", "fedcba9876543210", "pkcs7"),
    "test_aes_ecb": lambda: kaitai.compress.BlockCipher("aes", "ecb", bytes(range(32))),
}


def _encoder_for(module):
    if module in _ENCODERS:
        return _ENCODERS[module]()
    return getattr(kaitai.compress, compiled_class(module).__name__[len("Test"):])()


def _make_test(case):
    return lambda self: self._check_case(*case)


for _case in CASES:
    setattr(TestProcesses, "test_" + _case[0][len("test_"):], _make_test(_case))


class TestErrors(unittest.TestCase):
    def test_crc32_trailer_mismatch(self):
        data = bytearray(read("compressed", "ascii_text.crc32_trailer"))
        data[0] ^= 1
        with self.assertRaises(ValueError):
            kaitai.compress.Crc32Trailer("B1gS").decode(bytes(data))
        with self.assertRaises(ValueError):
            kaitai.compress.Crc32Trailer().decode(read("compressed", "ascii_text.crc32_trailer"))
        with self.assertRaises(ValueError):
            kaitai.compress.Crc32Trailer().decode(b"abc")

    def test_crc32_trailer_salt_types(self):
        data = read("compressed", "90_a.crc32_trailer")
        self.assertEqual(kaitai.compress.Crc32Trailer(b"B1gS").decode(data), data)

    def test_block_cipher_bad_padding(self):
        c = kaitai.compress.BlockCipher("aes", "ecb", bytes(range(16)))
        # last plaintext byte 0x00 is never valid PKCS#7 padding
        bad = kaitai.compress.BlockCipher("aes", "ecb", bytes(range(16)), padding="none").encode(b"x" * 15 + b"\x00")
        for data in (bad, b"", b"x" * 15):
            with self.subTest(data=data):
                with self.assertRaises(ValueError):
                    c.decode(data)

    def test_block_cipher_variants(self):
        data = b"hello, world"
        for args in [("des3", "cbc", b"0123456789abcdefABCDEFGH", b"12345678"),
                     ("3des", "ecb", "0123456789abcdefABCDEFGH"),
                     ("aes", "cbc", b"k" * 24, b"i" * 16),
                     ("aes", "ecb", b"k" * 32, None, "none")]:
            with self.subTest(args=args):
                c = kaitai.compress.BlockCipher(*args)
                plain = data.ljust(16, b"\x00") if args[-1] == "none" else data
                self.assertEqual(c.decode(c.encode(plain)), plain)

    def test_block_cipher_bad_args(self):
        bc = kaitai.compress.BlockCipher
        for args in [("rc4", "ecb", b"k" * 16), ("aes", "ctr", b"k" * 16), ("aes", "ecb", b"k" * 16, None, "zero"),
                     ("aes", "ecb", b"k" * 15), ("des", "ecb", b"k" * 16), ("aes", "cbc", b"k" * 16),
                     ("aes", "cbc", b"k" * 16, b"i" * 8)]:
            with self.subTest(args=args):
                with self.assertRaises(ValueError):
                    bc(*args)

    def test_snappy_framed_bad_crc(self):
        data = bytearray(read("compressed", "ascii_text.framing2.sz"))
        data[14] ^= 1
        with self.assertRaises(ValueError):
            kaitai.compress.SnappyFramed().decode(bytes(data))
        with self.assertRaises(ValueError):
            kaitai.compress.SnappyFramed().decode(read("compressed", "25k_uuids.framing2.sz")[:-5])

    def test_zstd_without_content_size(self):
        import zstandard
        data = b"no content size " * 1000
        frame = zstandard.ZstdCompressor(write_content_size=False).compress(data)
        self.assertEqual(kaitai.compress.Zstd().decode(frame + frame), data + data)
        with self.assertRaises(ValueError):
            kaitai.compress.Zstd().decode(frame[:-3])

    def test_gzip_concatenated_members(self):
        g = kaitai.compress.Gzip()
        self.assertEqual(g.decode(g.encode(b"ab") + g.encode(b"cd")), b"abcd")

    def test_reuse(self):
        for name in ("LzmaRaw", "LzmaLzma", "LzmaXz", "Zstd", "Deflate"):
            with self.subTest(name=name):
                p = getattr(kaitai.compress, name)()
                for data in (b"first", b"second"):
                    self.assertEqual(p.decode(p.encode(data)), data)


if __name__ == "__main__":
    unittest.main()
