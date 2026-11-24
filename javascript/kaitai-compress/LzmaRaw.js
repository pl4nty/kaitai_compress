// no third-party library: uses ./LzmaDecoder
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['./LzmaDecoder'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./LzmaDecoder'));
    } else {
        root.LzmaRaw = factory(root.LzmaDecoder);
    }
}(typeof self !== 'undefined' ? self : this, function (LzmaDecoder) {
    function LzmaRaw() {
    }

    // Raw LZMA2 stream, as written by `xz --format=raw`
    LzmaRaw.prototype.decode = function(data) {
        return LzmaDecoder.decodeLzma2(data, 0, data.length).data;
    };

    LzmaRaw.prototype.encode = function(data) {
        throw new Error("LzmaRaw: encoding is not supported in JavaScript (no pure JavaScript LZMA2 encoder is used)");
    };

    // ksc >= 0.11 generated code does `new LzmaRaw_.LzmaRaw()`, older code does `new LzmaRaw()`
    LzmaRaw.LzmaRaw = LzmaRaw;
    return LzmaRaw;
}));
