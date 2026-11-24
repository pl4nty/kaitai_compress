// npm: lzma (encoder only; decoding uses ./LzmaDecoder)
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['./LzmaDecoder', 'lzma'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./LzmaDecoder'), require('lzma'));
    } else {
        root.LzmaLzma = factory(root.LzmaDecoder, root.LZMA);
    }
}(typeof self !== 'undefined' ? self : this, function (LzmaDecoder, LZMA) {
    function LzmaLzma() {
    }

    // Legacy .lzma ("LZMA alone") format
    LzmaLzma.prototype.decode = function(data) {
        return LzmaDecoder.decodeLzmaAlone(data);
    };

    LzmaLzma.prototype.encode = function(data) {
        // LZMA-JS returns an array of signed bytes; 6 is its compression mode (1..9)
        return new Uint8Array(LZMA.compress(data, 6));
    };

    // ksc >= 0.11 generated code does `new LzmaLzma_.LzmaLzma()`, older code does `new LzmaLzma()`
    LzmaLzma.LzmaLzma = LzmaLzma;
    return LzmaLzma;
}));
