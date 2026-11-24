export default class Put {
    private words;
    private len;
    put(buf: Buffer): Put;
    word8(x: number): Put;
    floatle(x: number): Put;
    word8be(x: number): Put;
    word8le(x: number): Put;
    word16be(x: number): Put;
    word16le(x: number): Put;
    word32be(x: number): Put;
    word32le(x: number): Put;
    word64be(x: number): Put;
    word64le(x: number): Put;
    pad(bytes: number): Put;
    length(): number;
    buffer(): Buffer;
    write(stream: NodeJS.WritableStream): void;
}
