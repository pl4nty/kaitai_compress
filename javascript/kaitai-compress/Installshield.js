// No third-party library.
//
// The obfuscation of files in an InstallShield setup launcher. Each byte b
// becomes ~(key[i % len(key)] ^ rotl(b, 4)), where the key is the file name
// (UTF-8) XORed with 13 35 86 07 repeated, and i restarts at 0 every 1024
// bytes if `chunked` (flag 4 of the file entry). The result is often zlib
// data, which is left to the caller.
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.Installshield = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    var MAGIC = [0x13, 0x35, 0x86, 0x07];

    function rotate(b) {
        return ((b << 4) | (b >>> 4)) & 0xFF;
    }

    function Installshield(name, chunked) {
        var bytes = typeof name === 'string' ? new TextEncoder().encode(name) : new Uint8Array(name);
        if (bytes.length === 0) {
            throw new Error("Installshield: empty file name");
        }
        // the key with the final NOT folded in
        var len = chunked ? 1024 : bytes.length;
        this.key = new Uint8Array(len);
        for (var i = 0; i < len; i++) {
            var j = i % bytes.length;
            this.key[i] = bytes[j] ^ MAGIC[j % 4] ^ 0xFF;
        }
    }

    Installshield.prototype.decode = function(data) {
        var out = new Uint8Array(data.length), key = this.key;
        for (var i = 0; i < data.length; i++) {
            out[i] = rotate(data[i]) ^ key[i % key.length];
        }
        return out;
    };

    Installshield.prototype.encode = function(data) {
        var out = new Uint8Array(data.length), key = this.key;
        for (var i = 0; i < data.length; i++) {
            out[i] = rotate(data[i] ^ key[i % key.length]);
        }
        return out;
    };

    // ksc >= 0.11 generated code does `new Installshield_.Installshield()`, older code does `new Installshield()`
    Installshield.Installshield = Installshield;
    return Installshield;
}));
