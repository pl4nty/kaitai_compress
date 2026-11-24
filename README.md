# Kaitai Struct: compression processing libraries

This package provides custom processing routines to deal with
compressed binary data. Implementations are provided for:

* JavaScript
* Python
* Ruby

Note that most implementations are actually wrappers which route calls
to well-known implementations for that languages.

## Usage

To use these routines, one should add processing instruction into
.ksy file and then add relevant language-specific implementations
into one's project.

### In .ksy file

To use it, just invoke the following in your .ksy:

```
process: kaitai.compress.PROCESS_NAME(ARGUMENTS)
```

where `PROCESS_NAME` and `ARGUMENTS` should be as described in the table below.

Fully working example:

```yaml
meta:
  id: example_lz4
seq:
  - id: buf
    size: 50
    process: kaitai.compress.lz4
```

### In JavaScript / Node

Add [javascript/](https://github.com/kaitai-io/kaitai_compress/tree/master/javascript) to one's `NODE_PATH`.

### In Python

Add [python/](https://github.com/kaitai-io/kaitai_compress/tree/master/python) to one's `PYTHONPATH`.

### In Ruby

Add [ruby/lib/](https://github.com/kaitai-io/kaitai_compress/tree/master/ruby/lib/) to one's `$LOAD_PATH`.

## Supported algorithms

`decode` is implemented everywhere. `encode` (used by ksc `--read-write`, currently Python and Java targets only) is marked per language: P = Python, R = Ruby, J = JavaScript.

| Algorithm | Process name | Arguments | Conforming | Encode | Test file extension |
| - | - | - | - | - | - |
| [Brotli](https://en.wikipedia.org/wiki/Brotli) | `brotli` | None | [RFC 7932](https://datatracker.ietf.org/doc/html/rfc7932) | P R | br |
| [bzip2](https://en.wikipedia.org/wiki/Bzip2) | `bz2` | None | bzip2 stream | P R J | bz2 |
| [DEFLATE](https://en.wikipedia.org/wiki/DEFLATE) | `deflate` | None | Raw stream, [RFC 1951](https://datatracker.ietf.org/doc/html/rfc1951) | P R J | deflate |
| [gzip](https://en.wikipedia.org/wiki/Gzip) | `gzip` | None | [RFC 1952](https://datatracker.ietf.org/doc/html/rfc1952), concatenated members on decode | P R J | gz |
| PKWare DCL implode | `implode` | None | As decoded by Mark Adler's blast.c (not ZIP method 6) | - | ascii.implode, binary.implode |
| [LZ4](https://en.wikipedia.org/wiki/LZ4_(compression_algorithm)) | `lz4` | None | [LZ4 frame format](https://github.com/lz4/lz4/blob/dev/doc/lz4_Frame_format.md) | P R J | lz4 |
| [LZ4](https://en.wikipedia.org/wiki/LZ4_(compression_algorithm)) | `lz4_block` | `uncompressed_size` | Raw [LZ4 block format](https://github.com/lz4/lz4/blob/dev/doc/lz4_Block_format.md), no frame or size prefix. Decodes at most `uncompressed_size` bytes and ignores trailing bytes after that (e.g. CSO/ZSO alignment padding). Pure-code decoder in all languages; Ruby/JS encode emits literal-only blocks | P R J | lz4_block (u4le size prefix + block) |
| [LZMA](https://en.wikipedia.org/wiki/Lempel%E2%80%93Ziv%E2%80%93Markov_chain_algorithm) | `lzma_raw` | None | Raw LZMA2 stream (`xz --format=raw`) | P R | lzma_raw |
| [LZMA](https://en.wikipedia.org/wiki/Lempel%E2%80%93Ziv%E2%80%93Markov_chain_algorithm) | `lzma_lzma` | None | Legacy .lzma file format (AKA alone) | P R J | lzma |
| [LZMA](https://en.wikipedia.org/wiki/Lempel%E2%80%93Ziv%E2%80%93Markov_chain_algorithm) | `lzma_xz` | None | .xz file format | P R | xz |
| [Snappy](https://en.wikipedia.org/wiki/Snappy_(compression)) | `snappy` | None | Raw block format | P R J | raw.sz |
| [Snappy](https://en.wikipedia.org/wiki/Snappy_(compression)) | `snappy_framed` | None | [Framing format](https://github.com/google/snappy/blob/main/framing_format.txt), CRC-32C verified | P R J | framing2.sz |
| [zlib](https://en.wikipedia.org/wiki/Zlib) | `zlib` | None | [RFC 1950](https://datatracker.ietf.org/doc/html/rfc1950) | P R J | zlib |
| [zstd](https://zstd.net) (AKA zstandard) | `zstd` | None | [RFC 8878](https://datatracker.ietf.org/doc/html/rfc8878) | P R | zst |

### Integrity and encryption

Not compression, but common wrappers around compressed payloads.

| Process | Arguments | Behaviour | Test file extension |
| - | - | - | - |
| `crc32_trailer` | `salt` (string or bytes, optional) | Last 4 bytes are little-endian CRC-32 of the preceding bytes followed by `salt`. Decode verifies and returns the data unchanged, so the type can still parse the CRC field; encode recomputes it. | crc32_trailer |
| `block_cipher` | `algorithm`, `mode`, `key`, `iv` (optional), `padding` (optional) | `algorithm`: `des`, `3des`, `aes` (size from key length). `mode`: `ecb`, `cbc`. `padding`: `pkcs7` (default, strict on decode) or `none`. Encode in all languages. | des_cbc, aes_cbc, aes_ecb |

Example:

```yaml
seq:
  - id: header
    size: 0x40
    type: header
    process: kaitai.compress.crc32_trailer("B1gS")
  - id: payload
    size: len_payload
    process: kaitai.compress.block_cipher("des", "cbc", "S3crtMsG", "S3crtMsG")
```

## Dependencies

* Python: stdlib for zlib/deflate/gzip/bz2/lzma; `pip install ./python[all]` or pick extras (`brotli`, `lz4` (`lz4_block` needs it only to encode), `zstd`, `snappy`, `crypto`, `isal`). Libraries are imported only when a process is used. With `isal` installed, zlib, deflate and gzip use it.
* Ruby: `require 'kaitai/compress'` autoloads every process. Gems are listed in [_test/Gemfile](_test/Gemfile). DES needs OpenSSL's legacy provider, which is loaded on demand.
* JavaScript: pure-JS, synchronous libraries (works in browsers); see [javascript/package.json](javascript/package.json).

## Testing

```sh
cd _test
./compile-ksy          # needs kaitai-struct-compiler 0.11
./run-python
./run-ruby
./run-javascript
```

Or, with Docker or Podman, after `./compile-ksy`:

```sh
cd _test/docker
./build-images
./dockerci python/3.12   # or ruby/3.2, javascript/nodejs22
```

`generate-data` documents how the files in `_test/compressed` were made.
