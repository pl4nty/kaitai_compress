// npm: snappyjs
//
// Snappy framing format, version 2:
// https://github.com/google/snappy/blob/main/framing_format.txt
// Each chunk is a type byte, a 24-bit little-endian length and the chunk
// data. Compressed (0x00) and uncompressed (0x01) chunks start with a masked
// CRC-32C of the uncompressed data, which decode() verifies.
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['snappyjs'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('snappyjs'));
    } else {
        root.SnappyFramed = factory(root.SnappyJS);
    }
}(typeof self !== 'undefined' ? self : this, function (SnappyJS) {
    var STREAM_IDENTIFIER = [0xFF, 0x06, 0x00, 0x00, 0x73, 0x4E, 0x61, 0x50, 0x70, 0x59];  // "sNaPpY"
    var MAX_BLOCK_SIZE = 65536;

    // CRC-32C (Castagnoli)
    var TABLE = new Int32Array(256);
    for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) {
            c = (c & 1) ? (0x82F63B78 ^ (c >>> 1)) : (c >>> 1);
        }
        TABLE[n] = c;
    }

    function maskedCrc32c(bytes) {
        var crc = -1;
        for (var i = 0; i < bytes.length; i++) {
            crc = TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
        }
        crc = (crc ^ -1) >>> 0;
        return ((((crc >>> 15) | (crc << 17)) >>> 0) + 0xA282EAD8) >>> 0;
    }

    function readU32le(data, pos) {
        return (data[pos] | (data[pos + 1] << 8) | (data[pos + 2] << 16) | (data[pos + 3] << 24)) >>> 0;
    }

    function writeU32le(data, pos, value) {
        data[pos] = value & 0xFF;
        data[pos + 1] = (value >>> 8) & 0xFF;
        data[pos + 2] = (value >>> 16) & 0xFF;
        data[pos + 3] = value >>> 24;
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

    function SnappyFramed() {
    }

    SnappyFramed.prototype.decode = function(data) {
        var blocks = [];
        var pos = 0;
        while (pos < data.length) {
            if (pos + 4 > data.length) {
                throw new Error("SnappyFramed: truncated chunk header at offset " + pos);
            }
            var type = data[pos];
            var len = data[pos + 1] | (data[pos + 2] << 8) | (data[pos + 3] << 16);
            var start = pos + 4;
            var end = start + len;
            if (end > data.length) {
                throw new Error("SnappyFramed: truncated chunk at offset " + pos);
            }
            var chunk = data.subarray(start, end);
            if (pos === 0 && type !== 0xFF) {
                throw new Error("SnappyFramed: stream does not start with a stream identifier");
            }
            if (type === 0xFF) {
                for (var i = 0; i < STREAM_IDENTIFIER.length; i++) {
                    if (data[pos + i] !== STREAM_IDENTIFIER[i]) {
                        throw new Error("SnappyFramed: invalid stream identifier at offset " + pos);
                    }
                }
            } else if (type === 0x00 || type === 0x01) {
                if (len < 4) {
                    throw new Error("SnappyFramed: chunk at offset " + pos + " is too short");
                }
                var block = chunk.subarray(4);
                if (type === 0x00) {
                    block = SnappyJS.uncompress(block, MAX_BLOCK_SIZE);
                } else if (block.length > MAX_BLOCK_SIZE) {
                    throw new Error("SnappyFramed: uncompressed chunk at offset " + pos + " is longer than " + MAX_BLOCK_SIZE + " bytes");
                }
                var expected = readU32le(chunk, 0);
                var actual = maskedCrc32c(block);
                if (actual !== expected) {
                    throw new Error("SnappyFramed: CRC-32C mismatch in chunk at offset " + pos +
                        ": stored 0x" + expected.toString(16) + ", calculated 0x" + actual.toString(16));
                }
                blocks.push(block);
            } else if (type <= 0x7F) {
                throw new Error("SnappyFramed: reserved unskippable chunk type 0x" + type.toString(16));
            }
            // 0x80..0xFE: skippable chunks and padding
            pos = end;
        }
        return concat(blocks);
    };

    SnappyFramed.prototype.encode = function(data) {
        var chunks = [new Uint8Array(STREAM_IDENTIFIER)];
        for (var pos = 0; pos < data.length; pos += MAX_BLOCK_SIZE) {
            var block = data.subarray(pos, Math.min(pos + MAX_BLOCK_SIZE, data.length));
            var compressed = SnappyJS.compress(block);
            var useCompressed = compressed.length < block.length;
            var body = useCompressed ? compressed : block;
            var chunk = new Uint8Array(8 + body.length);
            // type byte and 24-bit length (of the CRC and the body)
            writeU32le(chunk, 0, (useCompressed ? 0x00 : 0x01) | ((4 + body.length) << 8));
            writeU32le(chunk, 4, maskedCrc32c(block));
            chunk.set(body, 8);
            chunks.push(chunk);
        }
        return concat(chunks);
    };

    // ksc >= 0.11 generated code does `new SnappyFramed_.SnappyFramed()`, older code does `new SnappyFramed()`
    SnappyFramed.SnappyFramed = SnappyFramed;
    return SnappyFramed;
}));
