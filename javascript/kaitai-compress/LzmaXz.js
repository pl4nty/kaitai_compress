// No third-party library: the .xz container is parsed here and LZMA2 is
// decoded by ./LzmaDecoder.
//
// Format: https://tukaani.org/xz/xz-file-format.txt
// Supported: one or more concatenated streams (with stream padding), any
// number of blocks, the LZMA2 filter alone (no BCJ/delta filters). All header,
// index and footer fields are verified, and so are CRC32 and CRC64 block
// checks; a SHA-256 block check is skipped.
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

    function concat(chunks) {
        var total = 0, i;
        for (i = 0; i < chunks.length; i++) {
            total += chunks[i].length;
        }
        var out = new Uint8Array(total);
        var pos = 0;
        for (i = 0; i < chunks.length; i++) {
            out.set(chunks[i], pos);
            pos += chunks[i].length;
        }
        return out;
    }

    function fail(msg) {
        throw new Error("LzmaXz: " + msg);
    }

    // Reads a multibyte integer at cursor `cur` ({pos, end}) and advances it
    function readVarint(data, cur) {
        var value = 0, mul = 1;
        for (var i = 0; i < 9; i++) {
            if (cur.pos >= cur.end) {
                fail("truncated integer");
            }
            var b = data[cur.pos++];
            value += (b & 0x7F) * mul;
            mul *= 128;
            if ((b & 0x80) === 0) {
                if (b === 0 && i > 0) {
                    fail("non-minimal integer encoding");
                }
                return value;
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

    // Decodes one block starting at `pos`. Returns its data, the position
    // after it and its "unpadded size" (as recorded in the index).
    function decodeBlock(data, pos, checkType) {
        var headerEnd = pos + (data[pos] + 1) * 4;
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
        if (flags & 0x03) {
            fail("unsupported filter chain (only a single LZMA2 filter is supported)");
        }
        var cur = { pos: pos + 2, end: headerEnd - 4 };
        var compressedSize = (flags & 0x40) ? readVarint(data, cur) : -1;
        var uncompressedSize = (flags & 0x80) ? readVarint(data, cur) : -1;
        var filterId = readVarint(data, cur);
        if (filterId !== FILTER_LZMA2) {
            fail("unsupported filter id 0x" + filterId.toString(16) + " (only LZMA2 is supported)");
        }
        // the only filter property is the dictionary size, which is not needed
        if (readVarint(data, cur) !== 1 || cur.pos >= cur.end || data[cur.pos++] > 40) {
            fail("invalid LZMA2 filter properties");
        }
        while (cur.pos < cur.end) {
            if (data[cur.pos++] !== 0) {
                fail("non-zero block header padding");
            }
        }

        var res = LzmaDecoder.decodeLzma2(data, headerEnd, data.length);
        var block = res.data;
        var p = res.end;
        if (compressedSize >= 0 && p - headerEnd !== compressedSize) {
            fail("compressed size does not match the block header");
        }
        if (uncompressedSize >= 0 && block.length !== uncompressedSize) {
            fail("uncompressed size does not match the block header");
        }
        var checkSize = CHECK_SIZES[checkType];
        var unpaddedSize = p - pos + checkSize;
        // blocks start at a multiple of 4 bytes from the start of the stream
        // and so does `pos`
        while ((p - pos) % 4 !== 0) {
            if (data[p++] !== 0) {
                fail("non-zero or truncated block padding");
            }
        }
        if (p + checkSize > data.length) {
            fail("truncated block check");
        }
        verifyCheck(checkType, block, data, p);
        return { data: block, end: p + checkSize, unpaddedSize: unpaddedSize };
    }

    // Verifies the index starting at `pos` (at its 0x00 indicator) against
    // the decoded blocks; returns the position after it
    function checkIndex(data, pos, blocks) {
        var cur = { pos: pos + 1, end: data.length };
        var numRecords = readVarint(data, cur);
        if (numRecords !== blocks.length) {
            fail("index has " + numRecords + " records but the stream has " + blocks.length + " blocks");
        }
        for (var i = 0; i < blocks.length; i++) {
            var unpaddedSize = readVarint(data, cur);
            var uncompressedSize = readVarint(data, cur);
            if (unpaddedSize !== blocks[i].unpaddedSize || uncompressedSize !== blocks[i].data.length) {
                fail("index record " + i + " does not match the block");
            }
        }
        var p = cur.pos;
        while ((p - pos) % 4 !== 0) {
            if (data[p++] !== 0) {
                fail("non-zero or truncated index padding");
            }
        }
        if (p + 4 > data.length || crc32(data, pos, p) !== readU32le(data, p)) {
            fail("CRC32 mismatch in index");
        }
        return p + 4;
    }

    function LzmaXz() {
    }

    LzmaXz.prototype.decode = function(data) {
        var chunks = [];
        var pos = 0;
        do {
            // stream header
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

            // blocks, until the index indicator (0x00)
            var blocks = [];
            while (true) {
                if (pos >= data.length) {
                    fail("truncated stream");
                }
                if (data[pos] === 0) {
                    break;
                }
                var block = decodeBlock(data, pos, checkType);
                blocks.push(block);
                chunks.push(block.data);
                pos = block.end;
            }
            var indexStart = pos;
            pos = checkIndex(data, pos, blocks);

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

        return concat(chunks);
    };

    LzmaXz.prototype.encode = function(data) {
        throw new Error("LzmaXz: encoding is not supported in JavaScript (no pure JavaScript LZMA2 encoder is used)");
    };

    // ksc >= 0.11 generated code does `new LzmaXz_.LzmaXz()`, older code does `new LzmaXz()`
    LzmaXz.LzmaXz = LzmaXz;
    return LzmaXz;
}));
