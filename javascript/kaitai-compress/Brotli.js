// npm: brotli (decoder only)
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['brotli/decompress'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('brotli/decompress'));
    } else {
        root.Brotli = factory(root.brotliDecompress);
    }
}(typeof self !== 'undefined' ? self : this, function (brotliDecompress) {
    function Brotli() {
    }

    Brotli.prototype.decode = function(data) {
        return brotliDecompress(data);
    };

    Brotli.prototype.encode = function(data) {
        throw new Error("Brotli: encoding is not supported in JavaScript (no pure JavaScript brotli encoder is used)");
    };

    // ksc >= 0.11 generated code does `new Brotli_.Brotli()`, older code does `new Brotli()`
    Brotli.Brotli = Brotli;
    return Brotli;
}));
