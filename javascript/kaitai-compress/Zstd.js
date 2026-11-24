// npm: fzstd (decoder only)
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['fzstd'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('fzstd'));
    } else {
        root.Zstd = factory(root.fzstd);
    }
}(typeof self !== 'undefined' ? self : this, function (fzstd) {
    function Zstd() {
    }

    Zstd.prototype.decode = function(data) {
        return fzstd.decompress(data);
    };

    Zstd.prototype.encode = function(data) {
        throw new Error("Zstd: encoding is not supported in JavaScript (fzstd is a decoder only)");
    };

    // ksc >= 0.11 generated code does `new Zstd_.Zstd()`, older code does `new Zstd()`
    Zstd.Zstd = Zstd;
    return Zstd;
}));
