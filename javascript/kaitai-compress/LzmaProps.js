// No third-party library: decoding uses ./LzmaDecoder, and the BCJ x86
// filter is implemented here (after the public domain XZ Embedded by Lasse
// Collin and Igor Pavlov). Decode only: encode() throws.
//
// LZMA1 data after its 5 property bytes (lc/lp/pb, then the u4le dictionary
// size), with no uncompressed size: the "properties + stream" form that NSIS
// and Inno Setup store. The stream must end with an end marker. With
// `filterFlag` (NSIS), a byte before the properties says
// whether the BCJ x86 filter was applied: 0 for no, 1 for yes.
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['./LzmaDecoder'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./LzmaDecoder'));
    } else {
        root.LzmaProps = factory(root.LzmaDecoder);
    }
}(typeof self !== 'undefined' ? self : this, function (LzmaDecoder) {
    var ALLOWED = [true, true, true, false, true, false, false, false];
    var BIT_NUM = [0, 1, 2, 2, 3, 3, 3, 3];

    function isMsByte(b) {
        return b === 0x00 || b === 0xFF;
    }

    // Undoes the BCJ x86 filter in place, for a stream that starts at 0.
    function bcjX86Decode(buf) {
        var prevPos = -1;
        var prevMask = 0;
        var size = buf.length - 4;
        for (var i = 0; i < size; i++) {
            if ((buf[i] & 0xFE) !== 0xE8) {
                continue;
            }
            var d = i - prevPos;
            if (d > 3) {
                prevMask = 0;
            } else {
                prevMask = (prevMask << (d - 1)) & 7;
                if (prevMask !== 0) {
                    var b = buf[i + 4 - BIT_NUM[prevMask]];
                    if (!ALLOWED[prevMask] || isMsByte(b)) {
                        prevPos = i;
                        prevMask = (prevMask << 1) | 1;
                        continue;
                    }
                }
            }
            prevPos = i;
            if (isMsByte(buf[i + 4])) {
                var src = (buf[i + 1] | (buf[i + 2] << 8) | (buf[i + 3] << 16) | (buf[i + 4] << 24)) >>> 0;
                var dest;
                while (true) {
                    dest = (src - (i + 5)) >>> 0;
                    if (prevMask === 0) {
                        break;
                    }
                    var j = BIT_NUM[prevMask] * 8;
                    if (!isMsByte((dest >>> (24 - j)) & 0xFF)) {
                        break;
                    }
                    src = (dest ^ (Math.pow(2, 32 - j) - 1)) >>> 0;
                }
                dest &= 0x01FFFFFF;
                dest |= -(dest & 0x01000000);
                buf[i + 1] = dest & 0xFF;
                buf[i + 2] = (dest >>> 8) & 0xFF;
                buf[i + 3] = (dest >>> 16) & 0xFF;
                buf[i + 4] = (dest >>> 24) & 0xFF;
                i += 4;
            } else {
                prevMask = (prevMask << 1) | 1;
            }
        }
        return buf;
    }

    function LzmaProps(filterFlag) {
        this.filterFlag = !!filterFlag;
    }

    LzmaProps.prototype.decode = function(data) {
        var pos = 0;
        var x86 = false;
        if (this.filterFlag) {
            if (data.length < 1 || data[0] > 1) {
                throw new Error("LzmaProps: invalid filter flag");
            }
            x86 = data[0] === 1;
            pos = 1;
        }
        var out = LzmaDecoder.decodeLzmaProps(data, pos);
        return x86 ? bcjX86Decode(out) : out;
    };

    LzmaProps.prototype.encode = function(data) {
        throw new Error("LzmaProps: encoding is not supported");
    };

    // ksc >= 0.11 generated code does `new LzmaProps_.LzmaProps()`, older code does `new LzmaProps()`
    LzmaProps.LzmaProps = LzmaProps;
    LzmaProps.bcjX86Decode = bcjX86Decode;
    return LzmaProps;
}));
