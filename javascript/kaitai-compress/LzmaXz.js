// No third-party library: the .xz container is parsed here and LZMA2 is
// decoded by ./LzmaDecoder.
//
// Format: https://tukaani.org/xz/xz-file-format.txt
// Supported: one or more concatenated streams (with stream padding), any
// number of blocks, the LZMA2 filter alone (no BCJ/delta filters), and the
// none/CRC32/CRC64/SHA-256 checks (CRC32 and CRC64 are verified; SHA-256 is
// skipped).
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['./LzmaDecoder'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./LzmaDecoder'));
    } else {
        root.LzmaXz = factory(root.LzmaDecoder);
    }
}(typeof self !== 'undefined' ? self : this, function (LzmaDecoder) {
    var HEADER_MAGIC = [0xFD, 0x37, 0x7A, 0x58, 0x5A, 0x00];
    var FILTER_LZMA2 = 0x21;
    var CHECK_SIZES = [0, 4, 4, 4, 8, 8, 8, 16, 16, 16, 32, 32, 32, 64, 64, 64];

    // CRC-32 (IEEE) table
    var CRC32 = new Int32Array(256);
    // CRC-64 (ECMA-182, reflected), as low and high 32-bit halves
    var CRC64_LO = new Uint32Array(256);
    var CRC64_HI = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
        var c = n;
        var lo = n, hi = 0;
        for (var k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            var carry = lo & 1;
            lo = ((lo >>> 1) | (hi << 31)) >>> 0;
            hi = hi >>> 1;
            if (carry) {
                lo = (lo ^ 0xD7870F42) >>> 0;
                hi = (hi ^ 0xC96C5795) >>> 0;
            }
        }
        CRC32[n] = c;
        CRC64_LO[n] = lo;
        CRC64_HI[n] = hi;
    }

    function crc32(data, start, end) {
        var crc = -1;
        for (var i = start; i < end; i++) {
            crc = CRC32[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
        }
        return (crc ^ -1) >>> 0;
    }

    // Returns [low, high] 32-bit halves
    function crc64(data) {
        var lo = 0xFFFFFFFF, hi = 0xFFFFFFFF;
        for (var i = 0; i < data.length; i++) {
            var idx = (lo ^ data[i]) & 0xFF;
            lo = (((lo >>> 8) | (hi << 24)) ^ CRC64_LO[idx]) >>> 0;
            hi = ((hi >>> 8) ^ CRC64_HI[idx]) >>> 0;
        }
        return [(~lo) >>> 0, (~hi) >>> 0];
    }

    function readU32le(data, pos) {
        return (data[pos] | (data[pos + 1] << 8) | (data[pos + 2] << 16) | (data[pos + 3] << 24)) >>> 0;
    }

    function fail(msg) {
        throw new Error("LzmaXz: " + msg);
    }

    // Reads a multibyte integer; returns [value, next position]
    function readVarint(data, pos, end) {
        var value = 0, mul = 1;
        for (var i = 0; i < 9; i++) {
            if (pos >= end) {
                fail("truncated integer");
            }
            var b = data[pos++];
            value += (b & 0x7F) * mul;
            mul *= 128;
            if ((b & 0x80) === 0) {
                if (b === 0 && i > 0) {
                    fail("non-minimal integer encoding");
                }
                return [value, pos];
            }
        }
        fail("integer is too long");
    }

    function checkStreamFlags(data, pos) {
        if (data[pos] !== 0 || (data[pos + 1] & 0xF0) !== 0) {
            fail("unsupported stream flags");
        }
        return data[pos + 1];
    }

    function verifyCheck(checkType, block, data, pos) {
        if (checkType === 1) {
            if (crc32(block, 0, block.length) !== readU32le(data, pos)) {
                fail("CRC32 mismatch in block data");
            }
        } else if (checkType === 4) {
            var crc = crc64(block);
            if (crc[0] !== readU32le(data, pos) || crc[1] !== readU32le(data, pos + 4)) {
                fail("CRC64 mismatch in block data");
            }
        }
    }

    // Decodes one block starting at `pos`; returns [Uint8Array, next position]
    function decodeBlock(data, pos, streamStart, checkType) {
        var headerSize = (data[pos] + 1) * 4;
        var headerEnd = pos + headerSize;
        if (headerEnd > data.length) {
            fail("truncated block header");
        }
        if (crc32(data, pos, headerEnd - 4) !== readU32le(data, headerEnd - 4)) {
            fail("CRC32 mismatch in block header");
        }
        var flags = data[pos + 1];
        if (flags & 0x3C) {
            fail("unsupported block flags");
        }
        var p = pos + 2, r;
        var compressedSize = -1, uncompressedSize = -1;
        if (flags & 0x40) {
            r = readVarint(data, p, headerEnd - 4); compressedSize = r[0]; p = r[1];
        }
        if (flags & 0x80) {
            r = readVarint(data, p, headerEnd - 4); uncompressedSize = r[0]; p = r[1];
        }
        var numFilters = (flags & 3) + 1;
        for (var f = 0; f < numFilters; f++) {
            r = readVarint(data, p, headerEnd - 4); var id = r[0]; p = r[1];
            r = readVarint(data, p, headerEnd - 4); var propsSize = r[0]; p = r[1];
            if (id !== FILTER_LZMA2 || numFilters !== 1) {
                fail("unsupported filter chain (only a single LZMA2 filter is supported, got filter id 0x" + id.toString(16) + ")");
            }
            if (propsSize !== 1) {
                fail("invalid LZMA2 filter properties");
            }
            p += propsSize;
        }
        for (; p < headerEnd - 4; p++) {
            if (data[p] !== 0) {
                fail("non-zero block header padding");
            }
        }

        var res = LzmaDecoder.decodeLzma2(data, headerEnd, data.length);
        var block = res.data;
        p = res.end;
        if (compressedSize >= 0 && p - headerEnd !== compressedSize) {
            fail("compressed size does not match the block header");
        }
        if (uncompressedSize >= 0 && block.length !== uncompressedSize) {
            fail("uncompressed size does not match the block header");
        }
        while ((p - streamStart) % 4 !== 0) {
            if (data[p++] !== 0) {
                fail("non-zero block padding");
            }
        }
        var checkSize = CHECK_SIZES[checkType];
        if (p + checkSize > data.length) {
            fail("truncated block check");
        }
        verifyCheck(checkType, block, data, p);
        return [block, p + checkSize];
    }

    // Skips and verifies the index starting at `pos` (at its 0x00 indicator)
    function skipIndex(data, pos, numBlocks) {
        var start = pos;
        var r = readVarint(data, pos + 1, data.length);
        var numRecords = r[0];
        var p = r[1];
        if (numRecords !== numBlocks) {
            fail("index has " + numRecords + " records but the stream has " + numBlocks + " blocks");
        }
        for (var i = 0; i < 2 * numRecords; i++) {
            p = readVarint(data, p, data.length)[1];
        }
        while ((p - start) % 4 !== 0) {
            if (data[p++] !== 0) {
                fail("non-zero index padding");
            }
        }
        if (p + 4 > data.length || crc32(data, start, p) !== readU32le(data, p)) {
            fail("CRC32 mismatch in index");
        }
        return p + 4;
    }

    function LzmaXz() {
    }

    LzmaXz.prototype.decode = function(data) {
        var blocks = [];
        var total = 0;
        var pos = 0;
        do {
            // stream header
            var streamStart = pos;
            if (pos + 12 > data.length) {
                fail("truncated stream header");
            }
            for (var i = 0; i < HEADER_MAGIC.length; i++) {
                if (data[pos + i] !== HEADER_MAGIC[i]) {
                    fail("invalid stream header magic");
                }
            }
            var checkType = checkStreamFlags(data, pos + 6);
            if (crc32(data, pos + 6, pos + 8) !== readU32le(data, pos + 8)) {
                fail("CRC32 mismatch in stream header");
            }
            pos += 12;

            // blocks
            var numBlocks = 0;
            while (true) {
                if (pos >= data.length) {
                    fail("truncated stream");
                }
                if (data[pos] === 0) {
                    break;
                }
                var r = decodeBlock(data, pos, streamStart, checkType);
                blocks.push(r[0]);
                total += r[0].length;
                pos = r[1];
                numBlocks++;
            }
            var indexStart = pos;
            pos = skipIndex(data, pos, numBlocks);

            // stream footer
            if (pos + 12 > data.length) {
                fail("truncated stream footer");
            }
            if (crc32(data, pos + 4, pos + 10) !== readU32le(data, pos)) {
                fail("CRC32 mismatch in stream footer");
            }
            if ((readU32le(data, pos + 4) + 1) * 4 !== pos - indexStart) {
                fail("backward size in the stream footer does not match the index size");
            }
            if (data[pos + 8] !== 0 || data[pos + 9] !== checkType) {
                fail("stream footer flags do not match the stream header");
            }
            if (data[pos + 10] !== 0x59 || data[pos + 11] !== 0x5A) {
                fail("invalid stream footer magic");
            }
            pos += 12;

            // stream padding
            var paddingStart = pos;
            while (pos < data.length && data[pos] === 0) {
                pos++;
            }
            if ((pos - paddingStart) % 4 !== 0) {
                fail("stream padding is not a multiple of 4 bytes");
            }
        } while (pos < data.length);

        var out = new Uint8Array(total);
        var off = 0;
        for (var b = 0; b < blocks.length; b++) {
            out.set(blocks[b], off);
            off += blocks[b].length;
        }
        return out;
    };

    LzmaXz.prototype.encode = function(data) {
        throw new Error("LzmaXz: encoding is not supported in JavaScript (no pure JavaScript LZMA2 encoder is used)");
    };

    // ksc >= 0.11 generated code does `new LzmaXz_.LzmaXz()`, older code does `new LzmaXz()`
    LzmaXz.LzmaXz = LzmaXz;
    return LzmaXz;
}));
