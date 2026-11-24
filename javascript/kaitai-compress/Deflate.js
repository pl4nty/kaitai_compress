// npm: pako
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['pako'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('pako'));
    } else {
        root.Deflate = factory(root.pako);
    }
}(typeof self !== 'undefined' ? self : this, function (pako) {
    function Deflate() {
    }

    Deflate.prototype.decode = function(data) {
        return pako.inflateRaw(data);
    };

    Deflate.prototype.encode = function(data) {
        return pako.deflateRaw(data);
    };

    // ksc >= 0.11 generated code does `new Deflate_.Deflate()`, older code does `new Deflate()`
    Deflate.Deflate = Deflate;
    return Deflate;
}));
