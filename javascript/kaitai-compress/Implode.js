/*
 * PKWare Data Compression Library (DCL) "implode" decompressor (decode only).
 * Note: this is NOT the "implode" method (6) of PKZIP, which is a different
 * format.
 *
 * Port of blast.c by Mark Adler (zlib contrib/blast, version 1.3). This is an
 * altered version: translated from C to JavaScript for kaitai_compress,
 * decoding a whole in-memory buffer. It is not the original software.
 *
 * Original copyright and licence notice of blast.c / blast.h:
 *
 *   Copyright (C) 2003, 2012, 2013 Mark Adler
 *
 *   This software is provided 'as-is', without any express or implied
 *   warranty.  In no event will the author be held liable for any damages
 *   arising from the use of this software.
 *
 *   Permission is granted to anyone to use this software for any purpose,
 *   including commercial applications, and to alter it and redistribute it
 *   freely, subject to the following restrictions:
 *
 *   1. The origin of this software must not be misrepresented; you must not
 *      claim that you wrote the original software. If you use this software
 *      in a product, an acknowledgment in the product documentation would be
 *      appreciated but is not required.
 *   2. Altered source versions must be plainly marked as such, and must not be
 *      misrepresented as being the original software.
 *   3. This notice may not be removed or altered from any source distribution.
 *
 *   Mark Adler    madler@alumni.caltech.edu
 */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.Implode = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    var MAXBITS = 13; // maximum code length

    // Build a canonical Huffman table {count, symbol} from run-length coded
    // code lengths: each byte is (repeat count - 1) << 4 | code length.
    function construct(rep) {
        var length = [], i, len;
        for (i = 0; i < rep.length; i++) {
            for (var r = (rep[i] >> 4) + 1; r > 0; r--) length.push(rep[i] & 15);
        }
        var count = new Array(MAXBITS + 1).fill(0);
        for (i = 0; i < length.length; i++) count[length[i]]++;
        var offs = new Array(MAXBITS + 1).fill(0);
        for (len = 1; len < MAXBITS; len++) offs[len + 1] = offs[len] + count[len];
        var symbol = new Array(length.length).fill(0);
        for (i = 0; i < length.length; i++) {
            if (length[i] !== 0) symbol[offs[length[i]]++] = i;
        }
        return { count: count, symbol: symbol };
    }

    // fixed code tables of the format
    var LITCODE = construct([
        11, 124, 8, 7, 28, 7, 188, 13, 76, 4, 10, 8, 12, 10, 12, 10, 8, 23, 8,
        9, 7, 6, 7, 8, 7, 6, 55, 8, 23, 24, 12, 11, 7, 9, 11, 12, 6, 7, 22, 5,
        7, 24, 6, 11, 9, 6, 7, 22, 7, 11, 38, 7, 9, 8, 25, 11, 8, 11, 9, 12,
        8, 12, 5, 38, 5, 38, 5, 11, 7, 5, 6, 21, 6, 10, 53, 8, 7, 24, 10, 27,
        44, 253, 253, 253, 252, 252, 252, 13, 12, 45, 12, 45, 12, 61, 12, 45,
        44, 173]);
    var LENCODE = construct([2, 35, 36, 53, 38, 23]);
    var DISTCODE = construct([2, 20, 53, 230, 247, 151, 248]);
    var BASE = [3, 2, 4, 5, 6, 7, 8, 9, 10, 12, 16, 24, 40, 72, 136, 264];
    var EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8];

    function Implode() {
    }

    Implode.prototype.decode = function(data) {
        // data may be a subarray view; indexing a Uint8Array respects its offset
        var pos = 0, bitbuf = 0, bitcnt = 0;

        // Return need bits from the input, least significant bit first.
        function bits(need) {
            var val = bitbuf;
            while (bitcnt < need) {
                if (pos >= data.length) throw new Error('implode: unexpected end of input');
                val |= data[pos++] << bitcnt;
                bitcnt += 8;
            }
            bitbuf = val >> need;
            bitcnt -= need;
            return val & ((1 << need) - 1);
        }

        // Decode one symbol using Huffman table h. Stored codes are
        // bit-reversed and inverted relative to canonical order.
        function huff(h) {
            var code = 0, first = 0, index = 0;
            for (var len = 1; len <= MAXBITS; len++) {
                code |= bits(1) ^ 1;
                var cnt = h.count[len];
                if (code < first + cnt) return h.symbol[index + (code - first)];
                index += cnt;
                first = (first + cnt) << 1;
                code <<= 1;
            }
            throw new Error('implode: invalid Huffman code');
        }

        var out = new Uint8Array(Math.max(4096, data.length * 4)), outLen = 0;
        function reserve(n) {
            if (outLen + n <= out.length) return;
            var bigger = new Uint8Array(Math.max(out.length * 2, outLen + n));
            bigger.set(out.subarray(0, outLen));
            out = bigger;
        }

        var lit = bits(8);
        if (lit > 1) throw new Error('implode: literal flag must be 0 or 1, got ' + lit);
        var dict = bits(8);
        if (dict < 4 || dict > 6) throw new Error('implode: dictionary size code must be 4..6, got ' + dict);

        while (true) {
            if (bits(1)) {
                // length/distance pair
                var symbol = huff(LENCODE);
                var len = BASE[symbol] + bits(EXTRA[symbol]);
                if (len === 519) break; // end code

                symbol = len === 2 ? 2 : dict;
                var dist = (huff(DISTCODE) << symbol) + bits(symbol) + 1;
                if (dist > outLen) throw new Error('implode: distance too far back');

                // byte-wise forward copy, which also handles overlapping copies
                reserve(len);
                for (var from = outLen - dist; len > 0; len--) out[outLen++] = out[from++];
            } else {
                reserve(1);
                out[outLen++] = lit ? huff(LITCODE) : bits(8);
            }
        }
        return out.slice(0, outLen);
    };

    // ksc 0.11 generated code uses `Implode_.Implode`; older code uses the
    // module value itself as the class.
    Implode.Implode = Implode;
    return Implode;
}));
