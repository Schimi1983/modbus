"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class Put {
    words = [];
    len = 0;
    put(buf) {
        this.words.push({ buffer: buf });
        this.len += buf.length;
        return this;
    }
    word8(x) {
        this.words.push({ bytes: 1, value: x });
        this.len += 1;
        return this;
    }
    floatle(x) {
        this.words.push({ bytes: 'float', endian: 'little', value: x });
        this.len += 4;
        return this;
    }
    word8be(x) {
        this.words.push({ endian: 'big', bytes: 1, value: x });
        this.len += 1;
        return this;
    }
    word8le(x) {
        this.words.push({ endian: 'little', bytes: 1, value: x });
        this.len += 1;
        return this;
    }
    word16be(x) {
        this.words.push({ endian: 'big', bytes: 2, value: x });
        this.len += 2;
        return this;
    }
    word16le(x) {
        this.words.push({ endian: 'little', bytes: 2, value: x });
        this.len += 2;
        return this;
    }
    word32be(x) {
        this.words.push({ endian: 'big', bytes: 4, value: x });
        this.len += 4;
        return this;
    }
    word32le(x) {
        this.words.push({ endian: 'little', bytes: 4, value: x });
        this.len += 4;
        return this;
    }
    word64be(x) {
        this.words.push({ endian: 'big', bytes: 8, value: x });
        this.len += 8;
        return this;
    }
    word64le(x) {
        this.words.push({ endian: 'little', bytes: 8, value: x });
        this.len += 8;
        return this;
    }
    pad(bytes) {
        this.words.push({ endian: 'big', bytes: bytes, value: 0 });
        this.len += bytes;
        return this;
    }
    length() {
        return this.len;
    }
    buffer() {
        const buf = Buffer.alloc(this.len);
        let offset = 0;
        this.words.forEach(word => {
            if (word.buffer) {
                word.buffer.copy(buf, offset, 0);
                offset += word.buffer.length;
                return;
            }
            const wordTyped = word;
            if (wordTyped.bytes === 'float') {
                // IEEE-754 single precision (32-bit), little-endian
                buf.writeFloatLE(wordTyped.value, offset);
                offset += 4;
            }
            else {
                const big = wordTyped.endian === 'big';
                const ix = big ? [(wordTyped.bytes - 1) * 8, -8] : [0, 8];
                for (let i = ix[0]; big ? i >= 0 : i < wordTyped.bytes * 8; i += ix[1]) {
                    if (i >= 32) {
                        buf[offset++] = Math.floor(wordTyped.value / Math.pow(2, i)) & 0xff;
                    }
                    else {
                        buf[offset++] = (wordTyped.value >> i) & 0xff;
                    }
                }
            }
        });
        return buf;
    }
    write(stream) {
        stream.write(this.buffer());
    }
}
exports.default = Put;
//# sourceMappingURL=Put.js.map