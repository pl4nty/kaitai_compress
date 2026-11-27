// npm: pako (encode only; decoding is implemented here)
//
// Raw deflate as NSIS writes it. NSIS 2.x compresses with its own copy of
// zlib whose stored blocks have no NLEN (the one's complement of LEN);
// NSIS 3 uses stock zlib. A stored block is read as NSIS 3 if the two bytes
// after LEN are its complement, else as NSIS 2. Data after the final block
// is ignored. encode() writes stock raw deflate, as NSIS 3 does.
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['pako'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('pako'));
    } else {
        root.DeflateNsis = factory(root.pako);
    }
}(typeof self !== 'undefined' ? self : this, function (pako) {
    var LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
        35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
    var LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2,
        3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
    var DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
        257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145,
        8193, 12289, 16385, 24577];
    var DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
        7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
    var CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

    function fail(msg) {
        throw new Error("DeflateNsis: " + msg);
    }

    // Lookup table indexed by the next `bits` input bits (LSB first): each
    // entry is symbol << 4 | code length, or -1 for an unused code.
    function table(lengths) {
        var bits = 0, n, i;
        for (i = 0; i < lengths.length; i++) {
            bits = Math.max(bits, lengths[i]);
        }
        if (bits === 0) {
            return { tab: new Int32Array([-1]), bits: 0 };
        }
        var counts = new Array(16).fill(0);
        for (i = 0; i < lengths.length; i++) {
            counts[lengths[i]]++;
        }
        counts[0] = 0;
        var code = 0, left = 1, next = new Array(16).fill(0);
        for (n = 1; n < 16; n++) {
            left = left * 2 - counts[n];
            if (left < 0) {
                fail("over-subscribed Huffman code");
            }
            code = (code + counts[n - 1]) << 1;
            next[n] = code;
        }
        var tab = new Int32Array(1 << bits).fill(-1);
        for (var sym = 0; sym < lengths.length; sym++) {
            n = lengths[sym];
            if (n === 0) {
                continue;
            }
            var c = next[n]++;
            var rev = 0;
            for (i = 0; i < n; i++) {
                rev = (rev << 1) | ((c >> i) & 1);
            }
            for (i = rev; i < (1 << bits); i += 1 << n) {
                tab[i] = (sym << 4) | n;
            }
        }
        return { tab: tab, bits: bits };
    }

    var FIXED_LIT, FIXED_DIST;
    (function () {
        var l = [];
        for (var i = 0; i < 288; i++) {
            l.push(i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8);
        }
        FIXED_LIT = table(l);
        FIXED_DIST = table(new Array(30).fill(5));
    })();

    function Output() {
        this.buf = new Uint8Array(1 << 16);
        this.pos = 0;
    }
    Output.prototype.reserve = function(n) {
        if (this.pos + n > this.buf.length) {
            var grown = new Uint8Array(Math.max(this.pos + n, this.buf.length * 2));
            grown.set(this.buf.subarray(0, this.pos));
            this.buf = grown;
        }
    };

    function Inflater(data) {
        this.data = data;
        this.pos = 0;
        this.bitBuf = 0;
        this.bitCnt = 0;
        this.out = new Output();
    }

    Inflater.prototype.bits = function(n) {
        while (this.bitCnt < n) {
            if (this.pos >= this.data.length) {
                fail("truncated input");
            }
            this.bitBuf |= this.data[this.pos++] << this.bitCnt;
            this.bitCnt += 8;
        }
        var v = this.bitBuf & ((1 << n) - 1);
        this.bitBuf >>>= n;
        this.bitCnt -= n;
        return v;
    };

    Inflater.prototype.sym = function(t) {
        while (this.bitCnt < t.bits && this.pos < this.data.length) {
            this.bitBuf |= this.data[this.pos++] << this.bitCnt;
            this.bitCnt += 8;
        }
        var e = t.tab[this.bitBuf & ((1 << t.bits) - 1)];
        if (e < 0 || (e & 15) > this.bitCnt) {
            fail("invalid Huffman code or truncated input");
        }
        this.bitBuf >>>= e & 15;
        this.bitCnt -= e & 15;
        return e >> 4;
    };

    Inflater.prototype.stored = function() {
        // byte-align and hand the whole bytes still buffered back to the input
        this.pos -= this.bitCnt >> 3;
        this.bitBuf = this.bitCnt = 0;
        var d = this.data, p = this.pos;
        if (p + 2 > d.length) {
            fail("truncated input");
        }
        var len = d[p] | (d[p + 1] << 8);
        p += 2;
        // NSIS 2 writes no NLEN; standard deflate (NSIS 3) does
        if (p + 2 <= d.length && (d[p] | (d[p + 1] << 8)) === (len ^ 0xFFFF)) {
            p += 2;
        }
        if (p + len > d.length) {
            fail("truncated stored block");
        }
        this.out.reserve(len);
        this.out.buf.set(d.subarray(p, p + len), this.out.pos);
        this.out.pos += len;
        this.pos = p + len;
    };

    Inflater.prototype.dynamicTables = function() {
        var hlit = this.bits(5) + 257;
        var hdist = this.bits(5) + 1;
        var hclen = this.bits(4) + 4;
        var cl = new Array(19).fill(0), i;
        for (i = 0; i < hclen; i++) {
            cl[CL_ORDER[i]] = this.bits(3);
        }
        var clTable = table(cl);
        var lengths = [];
        while (lengths.length < hlit + hdist) {
            var s = this.sym(clTable), n, v;
            if (s < 16) {
                lengths.push(s);
                continue;
            }
            if (s === 16) {
                if (lengths.length === 0) {
                    fail("repeat with no previous length");
                }
                v = lengths[lengths.length - 1];
                n = 3 + this.bits(2);
            } else {
                v = 0;
                n = s === 17 ? 3 + this.bits(3) : 11 + this.bits(7);
            }
            for (i = 0; i < n; i++) {
                lengths.push(v);
            }
        }
        if (lengths.length > hlit + hdist) {
            fail("code lengths overflow");
        }
        if (lengths[256] === 0) {
            fail("no end-of-block code");
        }
        return [table(lengths.slice(0, hlit)), table(lengths.slice(hlit))];
    };

    Inflater.prototype.codes = function(lit, dist) {
        var out = this.out;
        while (true) {
            var s = this.sym(lit);
            if (s < 256) {
                out.reserve(1);
                out.buf[out.pos++] = s;
                continue;
            }
            if (s === 256) {
                return;
            }
            s -= 257;
            if (s >= 29) {
                fail("invalid length code");
            }
            var n = LEN_BASE[s] + this.bits(LEN_EXTRA[s]);
            var d = this.sym(dist);
            if (d >= 30) {
                fail("invalid distance code");
            }
            d = DIST_BASE[d] + this.bits(DIST_EXTRA[d]);
            if (d > out.pos) {
                fail("distance too far back");
            }
            out.reserve(n);
            for (var i = 0; i < n; i++, out.pos++) {
                out.buf[out.pos] = out.buf[out.pos - d];
            }
        }
    };

    Inflater.prototype.run = function() {
        var final = 0;
        while (!final) {
            final = this.bits(1);
            var kind = this.bits(2);
            if (kind === 0) {
                this.stored();
            } else if (kind === 3) {
                fail("invalid block type 3");
            } else if (kind === 1) {
                this.codes(FIXED_LIT, FIXED_DIST);
            } else {
                var t = this.dynamicTables();
                this.codes(t[0], t[1]);
            }
        }
        return this.out.buf.slice(0, this.out.pos);
    };

    function DeflateNsis() {
    }

    DeflateNsis.prototype.decode = function(data) {
        return new Inflater(data).run();
    };

    DeflateNsis.prototype.encode = function(data) {
        return pako.deflateRaw(data);
    };

    // ksc >= 0.11 generated code does `new DeflateNsis_.DeflateNsis()`, older code does `new DeflateNsis()`
    DeflateNsis.DeflateNsis = DeflateNsis;
    return DeflateNsis;
}));
