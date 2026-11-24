var assert = require('assert');
var KaitaiStream = global.KaitaiStream = require('kaitai-struct/KaitaiStream');
var fs = require('fs');

var DATA_NAMES = ['90_a', '25k_uuids', 'ascii_text'];

// Test parser (compiled .ksy) and process class, with the process args used
// by the .ksy, the test file extension and what encode() is expected to do:
//   'roundtrip': decode(encode(x)) == x
//   'exact':     encode(x) == test file (deterministic processes)
//   'none':      encode() throws "not supported"
//   undefined:   decode only, no encode()
var PROCESSES = [
    { parser: 'TestBrotli', process: 'Brotli', args: [], ext: 'br', encode: 'none' },
    { parser: 'TestLz4', process: 'Lz4', args: [], ext: 'lz4', encode: 'roundtrip' },
    { parser: 'TestLzmaRaw', process: 'LzmaRaw', args: [], ext: 'lzma_raw', encode: 'none' },
    { parser: 'TestLzmaLzma', process: 'LzmaLzma', args: [], ext: 'lzma', encode: 'roundtrip' },
    { parser: 'TestLzmaXz', process: 'LzmaXz', args: [], ext: 'xz', encode: 'none' },
    { parser: 'TestZlib', process: 'Zlib', args: [], ext: 'zlib', encode: 'roundtrip' },
    { parser: 'TestDeflate', process: 'Deflate', args: [], ext: 'deflate', encode: 'roundtrip' },
    { parser: 'TestGzip', process: 'Gzip', args: [], ext: 'gz', encode: 'roundtrip' },
    { parser: 'TestZstd', process: 'Zstd', args: [], ext: 'zst', encode: 'none' },
    { parser: 'TestBz2', process: 'Bz2', args: [], ext: 'bz2', encode: 'roundtrip' },
    { parser: 'TestSnappy', process: 'Snappy', args: [], ext: 'raw.sz', encode: 'roundtrip' },
    { parser: 'TestSnappyFramed', process: 'SnappyFramed', args: [], ext: 'framing2.sz', encode: 'roundtrip' },
    { parser: 'TestImplodeAscii', process: 'Implode', args: [], ext: 'ascii.implode' },
    { parser: 'TestImplodeBinary', process: 'Implode', args: [], ext: 'binary.implode' },
    { parser: 'TestCrc32Trailer', process: 'Crc32Trailer', args: ['B1gS'], ext: 'crc32_trailer', encode: 'exact' },
    { parser: 'TestDesCbc', process: 'BlockCipher', args: ['des', 'cbc', 'S3crtMsG', 'S3crtMsG'], ext: 'des_cbc', encode: 'exact' },
    { parser: 'TestAesCbc', process: 'BlockCipher', args: ['aes', 'cbc', '0123456789abcdef', 'fedcba9876543210', 'pkcs7'], ext: 'aes_cbc', encode: 'exact' },
    { parser: 'TestAesEcb', process: 'BlockCipher', args: ['aes', 'ecb', aesEcbKey()], ext: 'aes_ecb', encode: 'exact' },
];

// bytes 0x00..0x1f
function aesEcbKey() {
    return new Uint8Array(32).map(function(_, i) { return i; });
}

function readFile(path) {
    var buf = fs.readFileSync(path);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function compressed(dataName, ext) {
    return readFile('compressed/' + dataName + '.' + ext);
}

function uncompressed(dataName) {
    return readFile('uncompressed/' + dataName + '.dat');
}

// Copy into a bigger buffer, so the view has a non-zero byteOffset
function asSubarray(bytes) {
    var big = new Uint8Array(bytes.length + 7);
    big.fill(0xAA);
    big.set(bytes, 3);
    return big.subarray(3, 3 + bytes.length);
}

function concat(a, b) {
    var out = new Uint8Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out;
}

function assertBytesEqual(actual, expected) {
    assert.ok(actual instanceof Uint8Array, 'expected a Uint8Array, got ' + Object.prototype.toString.call(actual));
    assert.strictEqual(actual.length, expected.length, 'length');
    assert.strictEqual(Buffer.from(actual.buffer, actual.byteOffset, actual.byteLength).toString('hex'),
        Buffer.from(expected.buffer, expected.byteOffset, expected.byteLength).toString('hex'));
}

function newProcess(p) {
    var Cls = require('kaitai-compress/' + p.process)[p.process];
    return Reflect.construct(Cls, p.args);
}

describe('kaitai_compress', function() {
    this.timeout(120000);

    PROCESSES.forEach(function(p) {
        describe(p.parser + ' / ' + p.process + ' (' + p.ext + ')', function() {
            it('module exports work for ksc >= 0.11 and older generated code', function() {
                var Mod = require('kaitai-compress/' + p.process);
                assert.strictEqual(typeof Mod[p.process], 'function');
                assert.strictEqual(Mod[p.process], Mod);
            });

            DATA_NAMES.forEach(function(dataName) {
                var expected = uncompressed(dataName);

                it(dataName + ': parses with the compiled .ksy', function() {
                    var Parser = require(p.parser)[p.parser];
                    var r = new Parser(new KaitaiStream(compressed(dataName, p.ext)));
                    assertBytesEqual(r.body, expected);
                });

                it(dataName + ': decodes a subarray view', function() {
                    var proc = newProcess(p);
                    var out = proc.decode(asSubarray(compressed(dataName, p.ext)));
                    if (p.process === 'Crc32Trailer') {
                        out = out.subarray(0, out.length - 4);
                    }
                    assertBytesEqual(out, expected);
                });

                if (p.encode === 'roundtrip') {
                    it(dataName + ': decode(encode(x)) == x', function() {
                        var proc = newProcess(p);
                        var enc = proc.encode(asSubarray(expected));
                        assertBytesEqual(proc.decode(enc), expected);
                    });
                } else if (p.encode === 'exact') {
                    it(dataName + ': encode(x) == test file', function() {
                        var proc = newProcess(p);
                        var input = p.process === 'Crc32Trailer' ? concat(expected, new Uint8Array(4)) : expected;
                        assertBytesEqual(proc.encode(asSubarray(input)), compressed(dataName, p.ext));
                    });
                }
            });

            if (p.encode === 'none') {
                it('encode() throws "not supported"', function() {
                    assert.throws(function() { newProcess(p).encode(new Uint8Array([1, 2, 3])); }, /not supported/);
                });
            }
        });
    });

    describe('binary round trips', function() {
        var bytes = new Uint8Array(70000);
        for (var i = 0; i < bytes.length; i++) {
            bytes[i] = (i * 7919 + (i >> 8)) & 0xFF;
        }
        PROCESSES.forEach(function(p) {
            if (p.encode === 'roundtrip' || p.encode === 'exact') {
                it(p.process + ' ' + p.args.slice(0, 2).join(' '), function() {
                    var proc = newProcess(p);
                    var dec = proc.decode(proc.encode(bytes));
                    if (p.process === 'Crc32Trailer') {
                        assertBytesEqual(dec.subarray(0, dec.length - 4), bytes.subarray(0, bytes.length - 4));
                    } else {
                        assertBytesEqual(dec, bytes);
                    }
                });
            }
        });
        it('empty input', function() {
            ['Zlib', 'Deflate', 'Gzip', 'Lz4', 'LzmaLzma', 'Bz2', 'Snappy', 'SnappyFramed'].forEach(function(name) {
                var proc = newProcess({ process: name, args: [] });
                assertBytesEqual(proc.decode(proc.encode(new Uint8Array(0))), new Uint8Array(0));
            });
        });
    });

    describe('errors', function() {
        var BlockCipher = require('kaitai-compress/BlockCipher').BlockCipher;
        var Crc32Trailer = require('kaitai-compress/Crc32Trailer').Crc32Trailer;
        var SnappyFramed = require('kaitai-compress/SnappyFramed').SnappyFramed;
        var LzmaXz = require('kaitai-compress/LzmaXz').LzmaXz;
        var LzmaRaw = require('kaitai-compress/LzmaRaw').LzmaRaw;
        var LzmaLzma = require('kaitai-compress/LzmaLzma').LzmaLzma;
        var KEY16 = '0123456789abcdef';

        function corrupt(bytes, pos) {
            var copy = new Uint8Array(bytes);
            copy[pos < 0 ? copy.length + pos : pos] ^= 0x01;
            return copy;
        }

        it('Crc32Trailer: CRC mismatch', function() {
            var data = compressed('ascii_text', 'crc32_trailer');
            assert.throws(function() { new Crc32Trailer('B1gS').decode(corrupt(data, 0)); }, /mismatch/);
            assert.throws(function() { new Crc32Trailer('B1gS').decode(corrupt(data, -1)); }, /mismatch/);
            assert.throws(function() { new Crc32Trailer('wrong').decode(data); }, /mismatch/);
        });

        it('Crc32Trailer: too short', function() {
            assert.throws(function() { new Crc32Trailer().decode(new Uint8Array(3)); }, /too short/);
            assert.throws(function() { new Crc32Trailer().encode(new Uint8Array(3)); }, /too short/);
        });

        it('Crc32Trailer: salt as string and bytes are the same, default is empty', function() {
            var data = new Uint8Array([1, 2, 3, 0, 0, 0, 0]);
            assertBytesEqual(new Crc32Trailer('ab').encode(data), new Crc32Trailer(new Uint8Array([0x61, 0x62])).encode(data));
            assertBytesEqual(new Crc32Trailer().encode(data), new Crc32Trailer('').encode(data));
            // CRC-32 of "123456789" is 0xcbf43926
            var check = new Crc32Trailer().encode(new Uint8Array([49, 50, 51, 52, 53, 54, 55, 56, 57, 0, 0, 0, 0]));
            assertBytesEqual(check.subarray(9), new Uint8Array([0x26, 0x39, 0xf4, 0xcb]));
        });

        it('SnappyFramed: CRC mismatch', function() {
            var data = compressed('ascii_text', 'framing2.sz');
            // first chunk is the 10-byte stream identifier; the next chunk's CRC starts at 14
            assert.throws(function() { new SnappyFramed().decode(corrupt(data, 14)); }, /CRC-32C mismatch/);
        });

        it('SnappyFramed: missing stream identifier, reserved chunk', function() {
            assert.throws(function() { new SnappyFramed().decode(new Uint8Array([0x01, 0x05, 0, 0, 0, 0, 0, 0, 0x41])); }, /stream identifier/);
            var reserved = concat(compressed('ascii_text', 'framing2.sz').subarray(0, 10), new Uint8Array([0x02, 0, 0, 0]));
            assert.throws(function() { new SnappyFramed().decode(reserved); }, /unskippable/);
        });

        it('LzmaXz: CRC mismatch and bad magic', function() {
            var data = compressed('ascii_text', 'xz');
            assert.throws(function() { new LzmaXz().decode(corrupt(data, 0)); }, /magic/);
            // the file ends with the block check (CRC64), the 8-byte index
            // (indicator, record count, 2 sizes, CRC32) and the 12-byte footer
            var indexPos = data.length - 12 - 8;
            assert.throws(function() { new LzmaXz().decode(corrupt(data, indexPos - 8)); }, /CRC64 mismatch/);
            assert.throws(function() { new LzmaXz().decode(corrupt(data, indexPos + 2)); }, /index record/);
        });

        it('LzmaXz: concatenated streams with stream padding', function() {
            var a = compressed('90_a', 'xz');
            var b = compressed('ascii_text', 'xz');
            var both = concat(concat(a, new Uint8Array(8)), b);
            assertBytesEqual(new LzmaXz().decode(both), concat(uncompressed('90_a'), uncompressed('ascii_text')));
            assert.throws(function() { new LzmaXz().decode(concat(a, new Uint8Array(3))); }, /padding/);
        });

        it('LZMA2: junk after the LZMA data of a chunk', function() {
            // a single LZMA chunk (control byte, 2 bytes unpacked size - 1,
            // 2 bytes packed size - 1, properties, LZMA data) and the end byte
            var raw = compressed('90_a', 'lzma_raw');
            var junk = concat(concat(raw.subarray(0, raw.length - 1), new Uint8Array([0x00])), raw.subarray(raw.length - 1));
            junk[4]++;
            assert.throws(function() { new LzmaRaw().decode(junk); }, /corrupted/);
        });

        it('Gzip: concatenated members', function() {
            var Gzip = require('kaitai-compress/Gzip').Gzip;
            var both = concat(compressed('90_a', 'gz'), compressed('ascii_text', 'gz'));
            assertBytesEqual(new Gzip().decode(both), concat(uncompressed('90_a'), uncompressed('ascii_text')));
        });

        it('LZMA: truncated input', function() {
            var raw = compressed('25k_uuids', 'lzma_raw');
            assert.throws(function() { new LzmaRaw().decode(raw.subarray(0, raw.length >> 1)); }, /truncated/);
            var lzma = compressed('25k_uuids', 'lzma');
            assert.throws(function() { new LzmaLzma().decode(lzma.subarray(0, lzma.length >> 1)); }, /truncated/);
        });

        it('BlockCipher: unknown algorithm, mode, padding', function() {
            assert.throws(function() { new BlockCipher('rc4', 'ecb', KEY16); }, /unknown algorithm/);
            assert.throws(function() { new BlockCipher('aes', 'ctr', KEY16); }, /unknown mode/);
            assert.throws(function() { new BlockCipher('aes', 'ecb', KEY16, undefined, 'zeros'); }, /unknown padding/);
        });

        it('BlockCipher: wrong key or iv length, missing iv', function() {
            assert.throws(function() { new BlockCipher('aes', 'ecb', '0123456789'); }, /key length/);
            assert.throws(function() { new BlockCipher('des', 'ecb', KEY16); }, /key length/);
            assert.throws(function() { new BlockCipher('aes', 'cbc', KEY16); }, /requires an iv/);
            assert.throws(function() { new BlockCipher('aes', 'cbc', KEY16, '01234567'); }, /iv length/);
        });

        it('BlockCipher: bad padding', function() {
            var noPad = new BlockCipher('aes', 'ecb', KEY16, undefined, 'none');
            var pkcs7 = new BlockCipher('aes', 'ecb', KEY16);
            var block = new Uint8Array(16);
            block[15] = 0x11;  // > block size
            assert.throws(function() { pkcs7.decode(noPad.encode(block)); }, /padding/);
            block[15] = 0x00;  // zero
            assert.throws(function() { pkcs7.decode(noPad.encode(block)); }, /padding/);
            block[15] = 0x03;
            block[14] = 0x03;
            block[13] = 0x04;  // inconsistent
            assert.throws(function() { pkcs7.decode(noPad.encode(block)); }, /padding/);
            block[13] = 0x03;  // valid
            assertBytesEqual(pkcs7.decode(noPad.encode(block)), block.subarray(0, 13));
        });

        it('BlockCipher: empty or unaligned ciphertext', function() {
            var pkcs7 = new BlockCipher('3des', 'cbc', '0123456789abcdefFEDCBA98', 'S3crtMsG');
            assert.throws(function() { pkcs7.decode(new Uint8Array(0)); }, /empty/);
            assert.throws(function() { pkcs7.decode(new Uint8Array(12)); }, /multiple of the block size/);
            var noPad = new BlockCipher('des3', 'ecb', '0123456789abcdef', undefined, 'none');
            assert.throws(function() { noPad.encode(new Uint8Array(5)); }, /multiple of the block size/);
        });

        it('BlockCipher: 3DES and AES-192 round trips, PKCS#7 adds a full block', function() {
            var data = uncompressed('ascii_text');
            [
                new BlockCipher('3des', 'cbc', '0123456789abcdefFEDCBA98', 'S3crtMsG'),
                new BlockCipher('des3', 'ecb', '0123456789abcdef'),
                new BlockCipher('aes', 'cbc', '0123456789abcdef01234567', KEY16),
            ].forEach(function(c) {
                assertBytesEqual(c.decode(c.encode(data)), data);
            });
            var aes = new BlockCipher('aes', 'ecb', KEY16);
            assert.strictEqual(aes.encode(new Uint8Array(16)).length, 32);
        });
    });
});
