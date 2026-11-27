// No third-party library. Decode only: encode() throws.
//
// bzip2 as NSIS writes it: the bzip2 block format without the stream
// framing. There is no "BZh" header, each block starts with the byte 0x31
// instead of the 48-bit block magic and CRC-32, and 0x17 replaces the
// end-of-stream magic and combined CRC. Blocks are bit-aligned and hold up
// to 900 kB. NSIS 2 and 3 blocks have no "randomised" bit; NSIS 1 blocks
// do, and are tried if the first reading fails. Randomised blocks are not
// supported. Data after the end marker is ignored.
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.Bz2Nsis = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    var MAX_BLOCK = 900000;

    function fail(msg) {
        throw new Error("Bz2Nsis: " + msg);
    }

    // MSB-first bit reader
    function Bits(data) {
        this.data = data;
        this.pos = 0;
        this.buf = 0;
        this.cnt = 0;
    }
    Bits.prototype.bits = function(n) {
        var v = 0;
        while (n > 0) {
            if (this.cnt === 0) {
                if (this.pos >= this.data.length) {
                    fail("truncated input");
                }
                this.buf = this.data[this.pos++];
                this.cnt = 8;
            }
            var take = Math.min(n, this.cnt);
            this.cnt -= take;
            v = v * (1 << take) + ((this.buf >>> this.cnt) & ((1 << take) - 1));
            n -= take;
        }
        return v;
    };

    // Canonical code, bzip2 style: limit/base per length, perm of symbols
    function huffman(lengths) {
        var lo = 32, hi = 0, i, n;
        for (i = 0; i < lengths.length; i++) {
            lo = Math.min(lo, lengths[i]);
            hi = Math.max(hi, lengths[i]);
        }
        var perm = [], limit = [], base = [];
        for (n = lo; n <= hi; n++) {
            for (i = 0; i < lengths.length; i++) {
                if (lengths[i] === n) {
                    perm.push(i);
                }
            }
        }
        var code = 0, idx = 0;
        for (n = lo; n <= hi; n++) {
            var count = 0;
            for (i = 0; i < lengths.length; i++) {
                if (lengths[i] === n) {
                    count++;
                }
            }
            base[n] = idx - code;
            code += count;
            idx += count;
            limit[n] = code - 1;
            code <<= 1;
        }
        return { lo: lo, hi: hi, limit: limit, base: base, perm: perm };
    }

    function symbol(r, t) {
        var n = t.lo;
        var code = r.bits(n);
        while (code > t.limit[n]) {
            n++;
            if (n > t.hi) {
                fail("invalid Huffman code");
            }
            code = (code << 1) | r.bits(1);
        }
        return t.perm[code + t.base[n]];
    }

    function block(r, randomisedBit, out) {
        if (randomisedBit && r.bits(1)) {
            fail("randomised blocks are not supported");
        }
        var origPtr = r.bits(24);
        var used16 = r.bits(16);
        var seq = [], i, j;
        for (i = 0; i < 16; i++) {
            if ((used16 >>> (15 - i)) & 1) {
                for (j = 0; j < 16; j++) {
                    if (r.bits(1)) {
                        seq.push(i * 16 + j);
                    }
                }
            }
        }
        if (seq.length === 0) {
            fail("block uses no symbols");
        }
        var alpha = seq.length + 2;
        var nGroups = r.bits(3);
        var nSelectors = r.bits(15);
        if (nGroups < 2 || nGroups > 6 || nSelectors === 0) {
            fail("invalid block header");
        }
        var mtf = [];
        for (i = 0; i < nGroups; i++) {
            mtf.push(i);
        }
        var selectors = [];
        for (i = 0; i < nSelectors; i++) {
            j = 0;
            while (r.bits(1)) {
                j++;
                if (j >= nGroups) {
                    fail("invalid selector");
                }
            }
            mtf.unshift(mtf.splice(j, 1)[0]);
            selectors.push(mtf[0]);
        }
        var tables = [];
        for (i = 0; i < nGroups; i++) {
            var n = r.bits(5), lengths = [];
            for (j = 0; j < alpha; j++) {
                while (true) {
                    if (n < 1 || n > 20) {
                        fail("invalid code length");
                    }
                    if (!r.bits(1)) {
                        break;
                    }
                    n += r.bits(1) ? -1 : 1;
                }
                lengths.push(n);
            }
            tables.push(huffman(lengths));
        }

        // Huffman, then run lengths of RUNA/RUNB and move-to-front
        var eob = alpha - 1;
        var order = seq.slice();
        var ll = new Uint8Array(MAX_BLOCK);
        var len = 0, run = 0, weight = 1, sel = 0, left = 0, table = null;
        while (true) {
            if (left === 0) {
                if (sel >= nSelectors) {
                    fail("ran out of selectors");
                }
                table = tables[selectors[sel++]];
                left = 50;
            }
            left--;
            var s = symbol(r, table);
            if (s <= 1) {
                run += weight << s;
                weight <<= 1;
                if (run > MAX_BLOCK) {
                    fail("block too big");
                }
                continue;
            }
            if (run) {
                if (len + run > MAX_BLOCK) {
                    fail("block too big");
                }
                ll.fill(order[0], len, len + run);
                len += run;
                run = 0;
                weight = 1;
            }
            if (s === eob) {
                break;
            }
            if (len >= MAX_BLOCK) {
                fail("block too big");
            }
            var v = order.splice(s - 1, 1)[0];
            order.unshift(v);
            ll[len++] = v;
        }
        if (origPtr >= Math.max(len, 1)) {
            fail("invalid origin pointer");
        }

        // inverse Burrows-Wheeler transform
        var start = new Int32Array(256), total = 0, b;
        for (i = 0; i < len; i++) {
            start[ll[i]]++;
        }
        for (b = 0; b < 256; b++) {
            var c = start[b];
            start[b] = total;
            total += c;
        }
        var ptr = new Int32Array(len);
        for (i = 0; i < len; i++) {
            ptr[start[ll[i]]++] = i;
        }

        // undo the initial run-length encoding: 4 equal bytes, then a count
        var p = ptr[origPtr], prev = -1, same = 0;
        for (i = 0; i < len; i++) {
            b = ll[p];
            p = ptr[p];
            if (same === 4) {
                out.push(prev, b);
                same = 0;
                prev = -1;
                continue;
            }
            out.push(b, -1);
            same = b === prev ? same + 1 : 1;
            prev = b;
        }
    }

    // Collects bytes; push(b, -1) adds b, push(b, n) adds n copies of b.
    function Output() {
        this.buf = new Uint8Array(1 << 16);
        this.pos = 0;
    }
    Output.prototype.push = function(b, n) {
        var count = n < 0 ? 1 : n;
        if (this.pos + count > this.buf.length) {
            var grown = new Uint8Array(Math.max(this.pos + count, this.buf.length * 2));
            grown.set(this.buf.subarray(0, this.pos));
            this.buf = grown;
        }
        this.buf.fill(b, this.pos, this.pos + count);
        this.pos += count;
    };

    function run(data, randomisedBit) {
        var r = new Bits(data), out = new Output();
        while (true) {
            var sig = r.bits(8);
            if (sig === 0x17) {
                return out.buf.slice(0, out.pos);
            }
            if (sig !== 0x31) {
                fail("invalid block signature 0x" + sig.toString(16));
            }
            block(r, randomisedBit, out);
        }
    }

    function Bz2Nsis() {
    }

    Bz2Nsis.prototype.decode = function(data) {
        try {
            return run(data, false);
        } catch (e) {
            try {
                return run(data, true);
            } catch (e2) {
                throw e;
            }
        }
    };

    Bz2Nsis.prototype.encode = function(data) {
        throw new Error("Bz2Nsis: encoding is not supported");
    };

    // ksc >= 0.11 generated code does `new Bz2Nsis_.Bz2Nsis()`, older code does `new Bz2Nsis()`
    Bz2Nsis.Bz2Nsis = Bz2Nsis;
    return Bz2Nsis;
}));
