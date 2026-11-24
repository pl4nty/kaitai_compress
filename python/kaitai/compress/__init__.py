"""Compression, checksum and encryption processes for Kaitai Struct.

Classes are imported lazily on first access, so that using one process does
not require installing the libraries every other process depends on.
"""

import importlib

_MODULES = {
    "BlockCipher": "block_cipher",
    "Brotli": "brotli",
    "Bz2": "bz2",
    "Crc32Trailer": "crc32_trailer",
    "Deflate": "deflate",
    "Gzip": "gzip",
    "Implode": "implode",
    "Lz4": "lz4",
    "LzmaLzma": "lzma_lzma",
    "LzmaRaw": "lzma_raw",
    "LzmaXz": "lzma_xz",
    "Snappy": "snappy",
    "SnappyFramed": "snappy_framed",
    "Zlib": "zlib",
    "Zstd": "zstd",
}

__all__ = sorted(_MODULES)


def __getattr__(name):
    try:
        module = _MODULES[name]
    except KeyError:
        raise AttributeError("module %r has no attribute %r" % (__name__, name)) from None
    cls = getattr(importlib.import_module("." + module, __name__), name)
    globals()[name] = cls
    return cls


def __dir__():
    return sorted(set(globals()) | set(__all__))
