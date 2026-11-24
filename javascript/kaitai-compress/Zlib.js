// npm: pako
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['pako'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('pako'));
    } else {
        root.Zlib = factory(root.pako);
    }
}(typeof self !== 'undefined' ? self : this, function (pako) {
    function Zlib() {
    }

    Zlib.prototype.decode = function(data) {
        return pako.inflate(data);
    };

    Zlib.prototype.encode = function(data) {
        return pako.deflate(data);
    };

    // ksc >= 0.11 generated code does `new Zlib_.Zlib()`, older code does `new Zlib()`
    Zlib.Zlib = Zlib;
    return Zlib;
}));
