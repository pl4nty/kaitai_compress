// npm: crypto-js
//
// Block cipher decryption (decode) / encryption (encode).
//   algorithm: "des", "3des" (alias "des3") or "aes" (AES-128/192/256 by key length)
//   mode:      "ecb" or "cbc" (cbc needs an iv of one block)
//   key, iv:   string (one byte per character) or byte array
//   padding:   "pkcs7" (default; same as PKCS#5 for 8-byte blocks) or "none"
// crypto-js is always used with NoPadding; PKCS#7 is checked strictly here.
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['crypto-js'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('crypto-js'));
    } else {
        root.BlockCipher = factory(root.CryptoJS);
    }
}(typeof self !== 'undefined' ? self : this, function (CryptoJS) {
    var ALGORITHMS = {
        "des": { cipher: "DES", blockSize: 8, keySizes: [8] },
        "3des": { cipher: "TripleDES", blockSize: 8, keySizes: [16, 24] },
        "des3": { cipher: "TripleDES", blockSize: 8, keySizes: [16, 24] },
        "aes": { cipher: "AES", blockSize: 16, keySizes: [16, 24, 32] }
    };
    var MODES = { "ecb": "ECB", "cbc": "CBC" };
    var PADDINGS = { "pkcs7": true, "none": true };

    function toBytes(value, what) {
        if (typeof value === 'string') {
            var bytes = new Uint8Array(value.length);
            for (var i = 0; i < value.length; i++) {
                var c = value.charCodeAt(i);
                if (c > 0xFF) {
                    throw new Error("BlockCipher: " + what + " string must only contain characters U+0000..U+00FF");
                }
                bytes[i] = c;
            }
            return bytes;
        }
        return new Uint8Array(value);
    }

    // Uint8Array (any byteOffset) -> CryptoJS WordArray (big-endian 32-bit words)
    function toWordArray(bytes) {
        var words = new Array((bytes.length + 3) >>> 2);
        for (var w = 0; w < words.length; w++) {
            words[w] = 0;
        }
        for (var i = 0; i < bytes.length; i++) {
            words[i >>> 2] |= bytes[i] << (24 - (i & 3) * 8);
        }
        return CryptoJS.lib.WordArray.create(words, bytes.length);
    }

    function fromWordArray(wa) {
        var bytes = new Uint8Array(wa.sigBytes);
        for (var i = 0; i < wa.sigBytes; i++) {
            bytes[i] = (wa.words[i >>> 2] >>> (24 - (i & 3) * 8)) & 0xFF;
        }
        return bytes;
    }

    function BlockCipher(algorithm, mode, key, iv, padding) {
        var algo = ALGORITHMS[String(algorithm).toLowerCase()];
        if (!algo) {
            throw new Error("BlockCipher: unknown algorithm '" + algorithm + "', expected des, 3des or aes");
        }
        var modeName = MODES[String(mode).toLowerCase()];
        if (!modeName) {
            throw new Error("BlockCipher: unknown mode '" + mode + "', expected ecb or cbc");
        }
        this.padding = (padding === undefined || padding === null) ? "pkcs7" : String(padding).toLowerCase();
        if (!PADDINGS[this.padding]) {
            throw new Error("BlockCipher: unknown padding '" + padding + "', expected pkcs7 or none");
        }
        var keyBytes = toBytes(key, "key");
        if (algo.keySizes.indexOf(keyBytes.length) < 0) {
            throw new Error("BlockCipher: invalid key length " + keyBytes.length + " for " + algorithm +
                ", expected " + algo.keySizes.join(" or ") + " bytes");
        }
        this.blockSize = algo.blockSize;
        this.cipher = CryptoJS[algo.cipher];
        this.key = toWordArray(keyBytes);
        this.cfg = { mode: CryptoJS.mode[modeName], padding: CryptoJS.pad.NoPadding };
        if (modeName === "CBC") {
            if (iv === undefined || iv === null) {
                throw new Error("BlockCipher: cbc mode requires an iv");
            }
            var ivBytes = toBytes(iv, "iv");
            if (ivBytes.length !== algo.blockSize) {
                throw new Error("BlockCipher: invalid iv length " + ivBytes.length + ", expected " + algo.blockSize + " bytes");
            }
            this.cfg.iv = toWordArray(ivBytes);
        }
    }

    BlockCipher.prototype.decode = function(data) {
        var bs = this.blockSize;
        if (data.length % bs !== 0) {
            throw new Error("BlockCipher: data length " + data.length + " is not a multiple of the block size " + bs);
        }
        if (this.padding === "pkcs7" && data.length === 0) {
            throw new Error("BlockCipher: empty data cannot hold PKCS#7 padding");
        }
        var params = CryptoJS.lib.CipherParams.create({ ciphertext: toWordArray(data) });
        var plain = fromWordArray(this.cipher.decrypt(params, this.key, this.cfg));
        if (this.padding === "none") {
            return plain;
        }
        var n = plain[plain.length - 1];
        if (n < 1 || n > bs) {
            throw new Error("BlockCipher: bad PKCS#7 padding (last byte is " + n + ")");
        }
        for (var i = plain.length - n; i < plain.length; i++) {
            if (plain[i] !== n) {
                throw new Error("BlockCipher: bad PKCS#7 padding");
            }
        }
        return plain.slice(0, plain.length - n);
    };

    BlockCipher.prototype.encode = function(data) {
        var bs = this.blockSize;
        var padded;
        if (this.padding === "pkcs7") {
            var n = bs - (data.length % bs);
            padded = new Uint8Array(data.length + n);
            padded.set(data);
            padded.fill(n, data.length);
        } else {
            if (data.length % bs !== 0) {
                throw new Error("BlockCipher: data length " + data.length + " is not a multiple of the block size " + bs +
                    " (padding is none)");
            }
            padded = data;
        }
        var encrypted = this.cipher.encrypt(toWordArray(padded), this.key, this.cfg);
        return fromWordArray(encrypted.ciphertext);
    };

    // ksc >= 0.11 generated code does `new BlockCipher_.BlockCipher()`, older code does `new BlockCipher()`
    BlockCipher.BlockCipher = BlockCipher;
    return BlockCipher;
}));
