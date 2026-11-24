// Pure JavaScript, synchronous LZMA / LZMA2 decoder shared by LzmaLzma,
// LzmaRaw and LzmaXz. It is not a process itself.
//
// Written from the LZMA specification (lzma-specification.txt in the
// public domain LZMA SDK by Igor Pavlov) and the LZMA2 chunk format as
// documented by XZ Embedded (public domain, Lasse Collin).
//
// The whole output is kept in memory and doubles as the dictionary, so the
// dictionary size from the headers is only informational.
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.LzmaDecoder = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    var PROB_INIT = 1024;  // probabilities are 11-bit, start at one half
    var NUM_STATES = 12;
    var POS_STATES_MAX = 16;  // 1 << 4
    var END_POS_MODEL_INDEX = 14;
    var NUM_FULL_DISTANCES = 128;
    var MATCH_MIN_LEN = 2;

    // Growable output buffer
    function Output(capacity) {
        this.buf = new Uint8Array(Math.max(capacity, 64));
        this.pos = 0;
    }
    Output.prototype.reserve = function(n) {
        var need = this.pos + n;
        if (need > this.buf.length) {
            var grown = new Uint8Array(Math.max(need, this.buf.length * 2));
            grown.set(this.buf.subarray(0, this.pos));
            this.buf = grown;
        }
    };
    Output.prototype.result = function() {
        return this.buf.slice(0, this.pos);
    };

    function LenDecoder() {
        this.choice = new Uint16Array(2);
        this.low = new Uint16Array(POS_STATES_MAX << 3);
        this.mid = new Uint16Array(POS_STATES_MAX << 3);
        this.high = new Uint16Array(256);
    }
    LenDecoder.prototype.reset = function() {
        this.choice.fill(PROB_INIT);
        this.low.fill(PROB_INIT);
        this.mid.fill(PROB_INIT);
        this.high.fill(PROB_INIT);
    };

    function LzmaDecoder(output) {
        this.out = output;
        this.dictStart = 0;
        this.lc = 0;
        this.lp = 0;
        this.pb = 0;
        this.literal = null;
        this.isMatch = new Uint16Array(NUM_STATES * POS_STATES_MAX);
        this.isRep = new Uint16Array(NUM_STATES);
        this.isRepG0 = new Uint16Array(NUM_STATES);
        this.isRepG1 = new Uint16Array(NUM_STATES);
        this.isRepG2 = new Uint16Array(NUM_STATES);
        this.isRep0Long = new Uint16Array(NUM_STATES * POS_STATES_MAX);
        this.posSlot = new Uint16Array(4 << 6);
        this.posSpecial = new Uint16Array(1 + NUM_FULL_DISTANCES - END_POS_MODEL_INDEX);
        this.align = new Uint16Array(16);
        this.lenDecoder = new LenDecoder();
        this.repLenDecoder = new LenDecoder();
    }

    LzmaDecoder.prototype.setProperties = function(props) {
        if (props >= 9 * 5 * 5) {
            throw new Error("LZMA: invalid properties byte " + props);
        }
        this.lc = props % 9;
        props = (props / 9) | 0;
        this.lp = props % 5;
        this.pb = (props / 5) | 0;
        this.literal = new Uint16Array(0x300 << (this.lc + this.lp));
    };

    LzmaDecoder.prototype.resetState = function() {
        this.literal.fill(PROB_INIT);
        this.isMatch.fill(PROB_INIT);
        this.isRep.fill(PROB_INIT);
        this.isRepG0.fill(PROB_INIT);
        this.isRepG1.fill(PROB_INIT);
        this.isRepG2.fill(PROB_INIT);
        this.isRep0Long.fill(PROB_INIT);
        this.posSlot.fill(PROB_INIT);
        this.posSpecial.fill(PROB_INIT);
        this.align.fill(PROB_INIT);
        this.lenDecoder.reset();
        this.repLenDecoder.reset();
        this.state = 0;
        this.rep0 = this.rep1 = this.rep2 = this.rep3 = 0;
    };

    LzmaDecoder.prototype.resetDict = function() {
        this.dictStart = this.out.pos;
    };

    // Range decoder: `range` and `code` are kept as non-negative doubles < 2^32.
    LzmaDecoder.prototype.initRange = function(input, pos, end) {
        if (end - pos < 5) {
            throw new Error("LZMA: truncated input");
        }
        if (input[pos] !== 0) {
            throw new Error("LZMA: corrupted range coder header");
        }
        this.input = input;
        this.inEnd = end;
        this.code = ((input[pos + 1] << 24) | (input[pos + 2] << 16) | (input[pos + 3] << 8) | input[pos + 4]) >>> 0;
        this.range = 0xFFFFFFFF;
        this.inPos = pos + 5;
    };

    LzmaDecoder.prototype.normalize = function() {
        if (this.range < 0x1000000) {
            if (this.inPos >= this.inEnd) {
                throw new Error("LZMA: truncated input");
            }
            this.range *= 256;
            this.code = this.code * 256 + this.input[this.inPos++];
        }
    };

    LzmaDecoder.prototype.bit = function(probs, i) {
        this.normalize();
        var p = probs[i];
        var bound = (this.range >>> 11) * p;
        if (this.code < bound) {
            this.range = bound;
            probs[i] = p + ((2048 - p) >>> 5);
            return 0;
        }
        this.range -= bound;
        this.code -= bound;
        probs[i] = p - (p >>> 5);
        return 1;
    };

    LzmaDecoder.prototype.bitTree = function(probs, base, numBits) {
        var m = 1;
        for (var i = 0; i < numBits; i++) {
            m = (m << 1) | this.bit(probs, base + m);
        }
        return m - (1 << numBits);
    };

    LzmaDecoder.prototype.bitTreeReverse = function(probs, base, numBits) {
        var m = 1, symbol = 0;
        for (var i = 0; i < numBits; i++) {
            var b = this.bit(probs, base + m);
            m = (m << 1) | b;
            symbol |= b << i;
        }
        return symbol;
    };

    LzmaDecoder.prototype.directBits = function(numBits) {
        var res = 0;
        for (var i = 0; i < numBits; i++) {
            this.normalize();
            this.range = this.range >>> 1;
            var b = 0;
            if (this.code >= this.range) {
                this.code -= this.range;
                b = 1;
            }
            res = res * 2 + b;
        }
        return res;
    };

    LzmaDecoder.prototype.decodeLen = function(ld, posState) {
        if (this.bit(ld.choice, 0) === 0) {
            return MATCH_MIN_LEN + this.bitTree(ld.low, posState << 3, 3);
        }
        if (this.bit(ld.choice, 1) === 0) {
            return MATCH_MIN_LEN + 8 + this.bitTree(ld.mid, posState << 3, 3);
        }
        return MATCH_MIN_LEN + 16 + this.bitTree(ld.high, 0, 8);
    };

    LzmaDecoder.prototype.decodeDistance = function(len) {
        var lenState = Math.min(len - MATCH_MIN_LEN, 3);
        var posSlot = this.bitTree(this.posSlot, lenState << 6, 6);
        if (posSlot < 4) {
            return posSlot;
        }
        var numDirectBits = (posSlot >>> 1) - 1;
        var dist = (2 | (posSlot & 1)) * Math.pow(2, numDirectBits);
        if (posSlot < END_POS_MODEL_INDEX) {
            return dist + this.bitTreeReverse(this.posSpecial, dist - posSlot, numDirectBits);
        }
        return dist + this.directBits(numDirectBits - 4) * 16 + this.bitTreeReverse(this.align, 0, 4);
    };

    LzmaDecoder.prototype.decodeLiteral = function() {
        var out = this.out;
        out.reserve(1);
        var buf = out.buf, pos = out.pos;
        var dictPos = pos - this.dictStart;
        var prevByte = dictPos > 0 ? buf[pos - 1] : 0;
        var base = 0x300 * (((dictPos & ((1 << this.lp) - 1)) << this.lc) + (prevByte >>> (8 - this.lc)));
        var probs = this.literal;
        var symbol = 1;
        if (this.state < 7) {
            while (symbol < 0x100) {
                symbol = (symbol << 1) | this.bit(probs, base + symbol);
            }
        } else {
            var matchByte = buf[pos - this.rep0 - 1];
            var offset = 0x100;
            while (symbol < 0x100) {
                matchByte <<= 1;
                var matchBit = matchByte & offset;
                if (this.bit(probs, base + offset + matchBit + symbol)) {
                    symbol = (symbol << 1) | 1;
                    offset = matchBit;
                } else {
                    symbol <<= 1;
                    offset &= ~matchBit;
                }
            }
        }
        buf[out.pos++] = symbol & 0xFF;
        this.state = this.state < 4 ? 0 : (this.state < 10 ? this.state - 3 : this.state - 6);
    };

    LzmaDecoder.prototype.copyMatch = function(len, limit) {
        var out = this.out;
        out.reserve(len);
        var buf = out.buf;
        var dist = this.rep0 + 1;
        if (dist > out.pos - this.dictStart) {
            throw new Error("LZMA: match distance is beyond the start of the dictionary");
        }
        if (out.pos + len > limit) {
            throw new Error("LZMA: match goes past the end of the data");
        }
        var src = out.pos - dist;
        for (var i = 0; i < len; i++) {
            buf[out.pos++] = buf[src++];
        }
    };

    // Decodes until `limit` output bytes in total exist (absolute position in
    // the output buffer, may be Infinity), or an end marker is found when `allowEndMarker`.
    // Returns true if the end marker was found.
    LzmaDecoder.prototype.decode = function(limit, allowEndMarker) {
        var out = this.out;
        var pbMask = (1 << this.pb) - 1;
        while (out.pos < limit) {
            var posState = (out.pos - this.dictStart) & pbMask;
            var state = this.state;
            if (this.bit(this.isMatch, (state << 4) + posState) === 0) {
                this.decodeLiteral();
                continue;
            }
            var len;
            if (this.bit(this.isRep, state) === 0) {
                // simple match
                len = this.decodeLen(this.lenDecoder, posState);
                this.state = state < 7 ? 7 : 10;
                var dist = this.decodeDistance(len);
                if (dist === 0xFFFFFFFF) {
                    if (!allowEndMarker) {
                        throw new Error("LZMA: unexpected end marker");
                    }
                    return true;
                }
                this.rep3 = this.rep2;
                this.rep2 = this.rep1;
                this.rep1 = this.rep0;
                this.rep0 = dist;
            } else {
                if (out.pos === this.dictStart) {
                    throw new Error("LZMA: repeated match in an empty dictionary");
                }
                if (this.bit(this.isRepG0, state) === 0) {
                    if (this.bit(this.isRep0Long, (state << 4) + posState) === 0) {
                        // short rep: one byte at rep0
                        this.state = state < 7 ? 9 : 11;
                        this.copyMatch(1, limit);
                        continue;
                    }
                } else {
                    var d;
                    if (this.bit(this.isRepG1, state) === 0) {
                        d = this.rep1;
                    } else {
                        if (this.bit(this.isRepG2, state) === 0) {
                            d = this.rep2;
                        } else {
                            d = this.rep3;
                            this.rep3 = this.rep2;
                        }
                        this.rep2 = this.rep1;
                    }
                    this.rep1 = this.rep0;
                    this.rep0 = d;
                }
                len = this.decodeLen(this.repLenDecoder, posState);
                this.state = state < 7 ? 8 : 11;
            }
            this.copyMatch(len, limit);
        }
        return false;
    };

    function readU32le(data, pos) {
        return (data[pos] | (data[pos + 1] << 8) | (data[pos + 2] << 16) | (data[pos + 3] << 24)) >>> 0;
    }

    // Legacy .lzma ("LZMA alone") file: 13 byte header, then LZMA data.
    function decodeLzmaAlone(data) {
        if (data.length < 13) {
            throw new Error("LZMA: truncated header");
        }
        var sizeLow = readU32le(data, 5);
        var sizeHigh = readU32le(data, 9);
        var knownSize = !(sizeLow === 0xFFFFFFFF && sizeHigh === 0xFFFFFFFF);
        var size = sizeHigh * 0x100000000 + sizeLow;
        if (knownSize && size > 0x7FFFFFFF) {
            throw new Error("LZMA: uncompressed size is too big: " + size);
        }
        var out = new Output(knownSize ? size : data.length * 4);
        var dec = new LzmaDecoder(out);
        dec.setProperties(data[0]);
        dec.resetState();
        if (knownSize) {
            if (size > 0) {
                dec.initRange(data, 13, data.length);
                dec.decode(size, true);
                if (out.pos !== size) {
                    throw new Error("LZMA: end marker found before the declared size");
                }
            }
        } else {
            dec.initRange(data, 13, data.length);
            dec.decode(Infinity, true);
        }
        return out.result();
    }

    // Raw LZMA2 stream starting at data[pos], ending with a 0x00 control byte.
    // Returns {data: Uint8Array, end: position after the end byte}.
    function decodeLzma2(data, pos, end) {
        if (end === undefined) {
            end = data.length;
        }
        var out = new Output((end - pos) * 4);
        var dec = new LzmaDecoder(out);
        var needDictReset = true;
        var needProps = true;
        while (true) {
            if (pos >= end) {
                throw new Error("LZMA2: truncated input (no end of stream marker)");
            }
            var control = data[pos++];
            if (control === 0x00) {
                return { data: out.result(), end: pos };
            }
            if (control === 0x01 || control === 0x02) {
                // uncompressed chunk
                if (control === 0x01) {
                    dec.resetDict();
                    needDictReset = false;
                } else if (needDictReset) {
                    throw new Error("LZMA2: missing dictionary reset");
                }
                if (pos + 2 > end) {
                    throw new Error("LZMA2: truncated input");
                }
                var usize = ((data[pos] << 8) | data[pos + 1]) + 1;
                pos += 2;
                if (pos + usize > end) {
                    throw new Error("LZMA2: truncated input");
                }
                out.reserve(usize);
                out.buf.set(data.subarray(pos, pos + usize), out.pos);
                out.pos += usize;
                pos += usize;
                continue;
            }
            if (control < 0x80) {
                throw new Error("LZMA2: invalid control byte 0x" + control.toString(16));
            }
            if (pos + 4 > end) {
                throw new Error("LZMA2: truncated input");
            }
            var unpacked = ((control & 0x1F) << 16) + ((data[pos] << 8) | data[pos + 1]) + 1;
            var packed = ((data[pos + 2] << 8) | data[pos + 3]) + 1;
            pos += 4;
            var reset = (control >>> 5) & 3;
            if (reset === 3) {
                dec.resetDict();
                needDictReset = false;
            } else if (needDictReset) {
                throw new Error("LZMA2: missing dictionary reset");
            }
            if (reset >= 2) {
                if (pos >= end) {
                    throw new Error("LZMA2: truncated input");
                }
                var props = data[pos++];
                dec.setProperties(props);
                if (dec.lc + dec.lp > 4) {
                    throw new Error("LZMA2: lc + lp > 4");
                }
                needProps = false;
            } else if (needProps) {
                throw new Error("LZMA2: missing properties");
            }
            if (reset >= 1) {
                dec.resetState();
            }
            if (pos + packed > end) {
                throw new Error("LZMA2: truncated input");
            }
            dec.initRange(data, pos, pos + packed);
            dec.decode(out.pos + unpacked, false);
            pos += packed;
        }
    }

    return {
        LzmaDecoder: LzmaDecoder,
        decodeLzmaAlone: decodeLzmaAlone,
        decodeLzma2: decodeLzma2
    };
}));
