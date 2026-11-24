// npm: snappyjs
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['snappyjs'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('snappyjs'));
    } else {
        root.Snappy = factory(root.SnappyJS);
    }
}(typeof self !== 'undefined' ? self : this, function (SnappyJS) {
    function Snappy() {
    }

    // Raw snappy block (no framing)
    Snappy.prototype.decode = function(data) {
        return SnappyJS.uncompress(data);
    };

    Snappy.prototype.encode = function(data) {
        return SnappyJS.compress(data);
    };

    // ksc >= 0.11 generated code does `new Snappy_.Snappy()`, older code does `new Snappy()`
    Snappy.Snappy = Snappy;
    return Snappy;
}));
