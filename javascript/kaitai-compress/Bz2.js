// npm: compressjs
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['compressjs/lib/Bzip2'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('compressjs/lib/Bzip2'));
    } else {
        root.Bz2 = factory(root.Bzip2);
    }
}(typeof self !== 'undefined' ? self : this, function (Bzip2) {
    function Bz2() {
    }

    Bz2.prototype.decode = function(data) {
        return new Uint8Array(Bzip2.decompressFile(data));
    };

    Bz2.prototype.encode = function(data) {
        return new Uint8Array(Bzip2.compressFile(data));
    };

    // ksc >= 0.11 generated code does `new Bz2_.Bz2()`, older code does `new Bz2()`
    Bz2.Bz2 = Bz2;
    return Bz2;
}));
