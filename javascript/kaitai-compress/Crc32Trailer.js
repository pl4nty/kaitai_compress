// No third-party library: CRC-32 (zlib / IEEE 802.3) is computed here.
//
// The last 4 bytes of the data are CRC-32 of `data[0:-4] + salt`, as an
// unsigned little-endian 32-bit integer. decode() verifies it and returns the
// data unchanged; encode() replaces the last 4 bytes with a fresh CRC.
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.Crc32Trailer = factory();
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

    function crc32Update(crc, bytes) {
        for (var i = 0; i < bytes.length; i++) {
            crc = TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
        }
        return crc;
    }

    function toBytes(value, what) {
        if (value == null) {
            return new Uint8Array(0);
        }
        if (typeof value === 'string') {
            var bytes = new Uint8Array(value.length);
            for (var i = 0; i < value.length; i++) {
                var c = value.charCodeAt(i);
                if (c > 0xFF) {
                    throw new Error("Crc32Trailer: " + what + " string must only contain characters U+0000..U+00FF");
                }
                bytes[i] = c;
            }
            return bytes;
        }
        return new Uint8Array(value);
    }

    function Crc32Trailer(salt) {
        this.salt = toBytes(salt, "salt");
    }

    // CRC-32 of the data without its last 4 bytes, followed by the salt
    Crc32Trailer.prototype.checksum = function(data) {
        if (data.length < 4) {
            throw new Error("Crc32Trailer: data is too short (" + data.length + " bytes), need at least 4");
        }
        var crc = crc32Update(-1, data.subarray(0, data.length - 4));
        crc = crc32Update(crc, this.salt);
        return (crc ^ -1) >>> 0;
    };

    Crc32Trailer.prototype.decode = function(data) {
        var actual = this.checksum(data);
        var n = data.length - 4;
        var expected = (data[n] | (data[n + 1] << 8) | (data[n + 2] << 16) | (data[n + 3] << 24)) >>> 0;
        if (actual !== expected) {
            throw new Error("Crc32Trailer: CRC-32 mismatch: stored 0x" + expected.toString(16) +
                ", calculated 0x" + actual.toString(16));
        }
        return data;
    };

    Crc32Trailer.prototype.encode = function(data) {
        var crc = this.checksum(data);
        var out = new Uint8Array(data);
        var n = out.length - 4;
        out[n] = crc & 0xFF;
        out[n + 1] = (crc >>> 8) & 0xFF;
        out[n + 2] = (crc >>> 16) & 0xFF;
        out[n + 3] = crc >>> 24;
        return out;
    };

    // ksc >= 0.11 generated code does `new Crc32Trailer_.Crc32Trailer()`, older code does `new Crc32Trailer()`
    Crc32Trailer.Crc32Trailer = Crc32Trailer;
    return Crc32Trailer;
}));
