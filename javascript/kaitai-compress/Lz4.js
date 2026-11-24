// npm: lz4js
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['lz4js'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('lz4js'));
    } else {
        root.Lz4 = factory(root.lz4);
    }
}(typeof self !== 'undefined' ? self : this, function (lz4js) {
    function Lz4() {
    }

    Lz4.prototype.decode = function(data) {
        return new Uint8Array(lz4js.decompress(data));
    };

    Lz4.prototype.encode = function(data) {
        return new Uint8Array(lz4js.compress(data));
    };

    // ksc >= 0.11 generated code does `new Lz4_.Lz4()`, older code does `new Lz4()`
    Lz4.Lz4 = Lz4;
    return Lz4;
}));
