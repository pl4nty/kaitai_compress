// npm: pako
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['pako'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('pako'));
    } else {
        root.Gzip = factory(root.pako);
    }
}(typeof self !== 'undefined' ? self : this, function (pako) {
    function Gzip() {
    }

    // Concatenated gzip members are decoded and joined
    Gzip.prototype.decode = function(data) {
        return pako.ungzip(data);
    };

    Gzip.prototype.encode = function(data) {
        return pako.gzip(data);
    };

    // ksc >= 0.11 generated code does `new Gzip_.Gzip()`, older code does `new Gzip()`
    Gzip.Gzip = Gzip;
    return Gzip;
}));
