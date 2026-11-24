#!/usr/bin/env python3
"""Tests for the Python kaitai.compress processes.

For every process and every input in uncompressed/*.dat:
- parse the compressed test file with the compiled class, compare body;
- (where encode exists) write body back with the --read-write code, re-parse.

Run from _test/: see run-python.
"""

import importlib
import itertools
import os
import unittest
from glob import glob

from kaitaistruct import KaitaiStream, BytesIO

import kaitai.compress as kc

HERE = os.path.dirname(os.path.abspath(__file__))
NAMES = sorted(os.path.basename(f)[:-len(".dat")] for f in glob(os.path.join(HERE, "uncompressed", "*.dat")))

# compiled module -> (test file extension, equivalent process or None if it cannot encode)
CASES = {
    "test_brotli": ("br", kc.Brotli()),
    "test_bz2": ("bz2", kc.Bz2()),
    "test_deflate": ("deflate", kc.Deflate()),
    "test_gzip": ("gz", kc.Gzip()),
    "test_lz4": ("lz4", kc.Lz4()),
    "test_lzma_lzma": ("lzma", kc.LzmaLzma()),
    "test_lzma_raw": ("lzma_raw", kc.LzmaRaw()),
    "test_lzma_xz": ("xz", kc.LzmaXz()),
    "test_snappy": ("raw.sz", kc.Snappy()),
    "test_snappy_framed": ("framing2.sz", kc.SnappyFramed()),
    "test_zlib": ("zlib", kc.Zlib()),
    "test_zstd": ("zst", kc.Zstd()),
    "test_implode_ascii": ("ascii.implode", None),
    "test_implode_binary": ("binary.implode", None),
    "test_des_cbc": ("des_cbc", kc.BlockCipher("des", "cbc", "S3crtMsG", "S3crtMsG")),
    "test_aes_cbc": ("aes_cbc", kc.BlockCipher("aes", "cbc", "0123456789abcdef", "fedcba9876543210", "pkcs7")),
    "test_aes_ecb": ("aes_ecb", kc.BlockCipher("aes", "ecb", bytes(range(32)))),
}


def read(*path):
    with open(os.path.join(HERE, *path), "rb") as f:
        return f.read()


def compiled_class(module):
    return getattr(importlib.import_module(module), module.title().replace("_", ""))


def parse(cls, data):
    obj = cls.from_bytes(data)
    obj._read()
    return obj


def write(obj, size):
    obj._check()
    io = KaitaiStream(BytesIO(bytearray(size)))
    obj._write(io)
    return io.to_byte_array()


class TestProcesses(unittest.TestCase):
    def test_inputs_present(self):
        self.assertEqual(NAMES, ["25k_uuids", "90_a", "ascii_text"])

    def test_all_classes_listed(self):
        for name in kc.__all__:
            self.assertEqual(getattr(kc, name).__name__, name)
            self.assertIn(name, dir(kc))
        with self.assertRaises(AttributeError):
            kc.NoSuchProcess

    def test_read_and_write(self):
        for (module, (ext, process)), name in itertools.product(CASES.items(), NAMES):
            with self.subTest(file="%s.%s" % (name, ext)):
                cls = compiled_class(module)
                expected = read("uncompressed", name + ".dat")
                compressed = read("compressed", "%s.%s" % (name, ext))
                self.assertEqual(parse(cls, compressed).body, expected)
                if process is None:
                    continue

                obj = cls()
                obj.body = expected
                # The stream has a fixed size: learn it from a dry run of the same encoder.
                written = write(obj, len(process.encode(expected)))
                self.assertEqual(parse(cls, written).body, expected)
                if isinstance(process, kc.BlockCipher):  # deterministic, unlike compressors
                    self.assertEqual(written, compressed)

    def test_crc32_trailer(self):
        cls = compiled_class("test_crc32_trailer")
        for name in NAMES:
            with self.subTest(file=name):
                expected = read("uncompressed", name + ".dat")
                framed_file = read("compressed", name + ".crc32_trailer")
                self.assertEqual(parse(cls, framed_file).body, expected)

                obj = cls()
                obj.framed = cls.Framed(None, obj, obj)
                obj.framed.body = expected
                obj.framed.crc = 0  # replaced by encode
                obj.framed._check()
                obj.framed__inner_size = len(expected) + 4
                written = write(obj, len(expected) + 4)
                self.assertEqual(written, framed_file)
                self.assertEqual(parse(cls, written).body, expected)


class TestErrors(unittest.TestCase):
    def test_crc32_trailer_mismatch(self):
        data = bytearray(read("compressed", "ascii_text.crc32_trailer"))
        data[0] ^= 1
        with self.assertRaises(ValueError):
            kc.Crc32Trailer("B1gS").decode(bytes(data))
        with self.assertRaises(ValueError):
            kc.Crc32Trailer().decode(read("compressed", "ascii_text.crc32_trailer"))
        with self.assertRaises(ValueError):
            kc.Crc32Trailer().decode(b"abc")

    def test_crc32_trailer_salt_types(self):
        data = read("compressed", "90_a.crc32_trailer")
        self.assertEqual(kc.Crc32Trailer(b"B1gS").decode(data), data)

    def test_block_cipher_bad_padding(self):
        key = bytes(range(16))
        raw = kc.BlockCipher("aes", "ecb", key, padding="none")
        # 0x00 and 0x11 are never valid padding lengths; 0x02 needs two equal bytes
        bad = [raw.encode(b"x" * 15 + bytes([last])) for last in (0x00, 0x11, 0x02)]
        for data in bad + [b"", b"x" * 15]:
            with self.subTest(data=data):
                with self.assertRaises(ValueError):
                    kc.BlockCipher("aes", "ecb", key).decode(data)
        for data in (b"x" * 15, b"x" * 17):
            with self.subTest(unpadded=data):
                with self.assertRaises(ValueError):
                    raw.encode(data)
                with self.assertRaises(ValueError):
                    raw.decode(data)

    def test_implode_cannot_encode(self):
        with self.assertRaisesRegex(NotImplementedError, "implode"):
            kc.Implode().encode(b"data")

    def test_block_cipher_variants(self):
        data = b"hello, world"
        for args in [("des3", "cbc", b"0123456789abcdefABCDEFGH", b"12345678"),
                     ("3des", "ecb", "0123456789abcdefABCDEFGH"),
                     ("aes", "cbc", b"k" * 24, b"i" * 16),
                     ("aes", "ecb", b"k" * 32, None, "none")]:
            with self.subTest(args=args):
                c = kc.BlockCipher(*args)
                plain = data.ljust(16, b"\x00") if args[-1] == "none" else data
                self.assertEqual(c.decode(c.encode(plain)), plain)

    def test_block_cipher_bad_args(self):
        bc = kc.BlockCipher
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
            kc.SnappyFramed().decode(bytes(data))
        with self.assertRaises(ValueError):
            kc.SnappyFramed().decode(read("compressed", "25k_uuids.framing2.sz")[:-5])

    def test_zstd_without_content_size(self):
        import zstandard
        data = b"no content size " * 1000
        frame = zstandard.ZstdCompressor(write_content_size=False).compress(data)
        self.assertEqual(kc.Zstd().decode(frame + frame), data + data)
        with self.assertRaises(ValueError):
            kc.Zstd().decode(frame[:-3])

    def test_gzip_concatenated_members(self):
        g = kc.Gzip()
        self.assertEqual(g.decode(g.encode(b"ab") + g.encode(b"cd")), b"abcd")

    def test_reuse(self):
        for name in ("LzmaRaw", "LzmaLzma", "LzmaXz", "Zstd", "Deflate"):
            with self.subTest(name=name):
                p = getattr(kc, name)()
                for data in (b"first", b"second"):
                    self.assertEqual(p.decode(p.encode(data)), data)


if __name__ == "__main__":
    unittest.main()
