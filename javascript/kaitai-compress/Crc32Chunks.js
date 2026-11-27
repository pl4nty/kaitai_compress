// No third-party library: CRC-32 (zlib / IEEE 802.3) is computed here.
//
// Data in chunks of `chunkSize` bytes (the last one may be shorter), each
// preceded by the little-endian CRC-32 of the chunk, as Inno Setup stores
// its compressed headers (4096-byte chunks). decode() verifies every CRC and
// returns the chunks joined; encode() splits and adds the CRCs.
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.Crc32Chunks = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    var TABLE = new Int32Array(256);
    for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        TABLE[n] = c;
    }

    function crc32(bytes) {
        var crc = -1;
        for (var i = 0; i < bytes.length; i++) {
            crc = TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
        }
        return (crc ^ -1) >>> 0;
    }

    function Crc32Chunks(chunkSize) {
        if (typeof chunkSize !== 'number' || !Number.isInteger(chunkSize) || chunkSize < 1) {
            throw new Error("Crc32Chunks: chunkSize must be a positive integer, got " + chunkSize);
        }
        this.chunkSize = chunkSize;
    }

    Crc32Chunks.prototype.decode = function(data) {
        var out = new Uint8Array(data.length);
        var outPos = 0, pos = 0;
        while (pos < data.length) {
            if (data.length - pos <= 4) {
                throw new Error("Crc32Chunks: truncated chunk at offset " + pos);
            }
            var stored = (data[pos] | (data[pos + 1] << 8) | (data[pos + 2] << 16) | (data[pos + 3] << 24)) >>> 0;
            var chunk = data.subarray(pos + 4, Math.min(pos + 4 + this.chunkSize, data.length));
            if (crc32(chunk) !== stored) {
                throw new Error("Crc32Chunks: CRC mismatch in chunk at offset " + pos);
            }
            out.set(chunk, outPos);
            outPos += chunk.length;
            pos += 4 + chunk.length;
        }
        return out.slice(0, outPos);
    };

    Crc32Chunks.prototype.encode = function(data) {
        var n = Math.ceil(data.length / this.chunkSize);
        var out = new Uint8Array(data.length + 4 * n);
        var pos = 0;
        for (var i = 0; i < data.length; i += this.chunkSize) {
            var chunk = data.subarray(i, Math.min(i + this.chunkSize, data.length));
            var crc = crc32(chunk);
            out[pos] = crc & 0xFF;
            out[pos + 1] = (crc >>> 8) & 0xFF;
            out[pos + 2] = (crc >>> 16) & 0xFF;
            out[pos + 3] = (crc >>> 24) & 0xFF;
            out.set(chunk, pos + 4);
            pos += 4 + chunk.length;
        }
        return out;
    };

    // ksc >= 0.11 generated code does `new Crc32Chunks_.Crc32Chunks()`, older code does `new Crc32Chunks()`
    Crc32Chunks.Crc32Chunks = Crc32Chunks;
    return Crc32Chunks;
}));
