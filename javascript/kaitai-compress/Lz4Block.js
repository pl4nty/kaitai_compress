// Raw LZ4 block (no frame header, no size prefix), pure JavaScript, no dependencies.
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.Lz4Block = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    /**
     * Decodes at most `uncompressedSize` bytes: decoding stops as soon as that
     * many bytes have been produced, so trailing bytes after the last sequence
     * (e.g. alignment padding in CSO/ZSO disc images) are ignored. A match that
     * would run past `uncompressedSize` is an error.
     *
     * encode emits a valid block made of a single literal-only sequence (no
     * compression), so written files stay readable by any LZ4 decoder.
     */
    function Lz4Block(uncompressedSize) {
        this.uncompressedSize = uncompressedSize;
    }

    function readLength(src, state, base, what) {
        if (base !== 15) {
            return base;
        }
        var b;
        do {
            if (state.pos >= src.length) {
                throw new Error('lz4_block: truncated ' + what);
            }
            b = src[state.pos++];
            base += b;
        } while (b === 255);
        return base;
    }

    Lz4Block.prototype.decode = function(data) {
        var size = this.uncompressedSize;
        var out = new Uint8Array(size);
        var op = 0;
        var state = { pos: 0 };
        var len = data.length;
        // A block whose last sequence ends with the input may decode to fewer
        // than `size` bytes (e.g. a short final block).
        while (op < size && state.pos < len) {
            var token = data[state.pos++];
            var litLen = readLength(data, state, token >> 4, 'literal length');
            if (state.pos + litLen > len) {
                throw new Error('lz4_block: truncated literals');
            }
            if (op + litLen > size) {
                throw new Error('lz4_block: block decodes to more than ' + size + ' bytes');
            }
            out.set(data.subarray(state.pos, state.pos + litLen), op);
            op += litLen;
            state.pos += litLen;
            if (op >= size || state.pos === len) {  // last sequence: literals only
                break;
            }
            if (state.pos + 2 > len) {
                throw new Error('lz4_block: truncated match offset');
            }
            var offset = data[state.pos] | (data[state.pos + 1] << 8);
            state.pos += 2;
            if (offset === 0 || offset > op) {
                throw new Error('lz4_block: invalid match offset ' + offset + ' at output position ' + op);
            }
            var matchLen = readLength(data, state, token & 0x0f, 'match length') + 4;
            if (op + matchLen > size) {
                throw new Error('lz4_block: block decodes to more than ' + size + ' bytes');
            }
            // byte by byte, so overlapping matches repeat the last `offset` bytes
            for (var i = 0; i < matchLen; i++, op++) {
                out[op] = out[op - offset];
            }
        }
        return op === size ? out : out.slice(0, op);
    };

    Lz4Block.prototype.encode = function(data) {
        var n = data.length;
        var header = [];
        if (n < 15) {
            header.push(n << 4);
        } else {
            header.push(0xf0);
            var rest = n - 15;
            for (; rest >= 255; rest -= 255) {
                header.push(0xff);
            }
            header.push(rest);
        }
        var out = new Uint8Array(header.length + n);
        out.set(header);
        out.set(data, header.length);
        return out;
    };

    // ksc >= 0.11 generated code does `new Lz4Block_.Lz4Block()`, older code does `new Lz4Block()`
    Lz4Block.Lz4Block = Lz4Block;
    return Lz4Block;
}));
