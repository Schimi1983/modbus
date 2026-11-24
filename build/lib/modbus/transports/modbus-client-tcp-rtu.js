"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const Put_1 = __importDefault(require("../../Put"));
const crc16modbus_1 = __importDefault(require("../../crc16modbus"));
const node_net_1 = require("node:net");
const modbus_client_core_1 = __importDefault(require("../modbus-client-core"));
const errors_1 = __importDefault(require("./errors"));
function toStrArray(buf) {
    if (!buf?.length) {
        return '';
    }
    let text = '';
    for (let i = 0; i < buf.length; i++) {
        text += (text ? ',' : '') + buf[i];
    }
    return text;
}
class ModbusClientTcpRtu extends modbus_client_core_1.default {
    closedOnPurpose = false;
    #reconnect = false;
    buffer = Buffer.alloc(0);
    socket = null;
    tcp;
    unitId;
    constructor(options) {
        super(options);
        this.setState('init');
        this.tcp = options.tcp;
        this.unitId = options.unitId || 1;
        this.tcp.protocolVersion ||= 0;
        this.tcp.port ||= 502;
        this.tcp.host ||= 'localhost';
        this.tcp.autoReconnect ||= false;
        this.tcp.reconnectTimeout ||= 0;
        this.on('send', this.#onSend);
        this.on('newState_error', this.#onError);
    }
    #onSocketConnect = () => {
        this.emit('connect');
        this.setState('ready');
    };
    #onSocketClose = (hadErrors) => {
        this.log.debug(hadErrors ? 'Socket closed with error' : 'Socket closed');
        // Discard any half-received frame and drop the used socket, so a reconnect
        // starts from a clean state with a fresh socket (issue #594).
        this.buffer = Buffer.alloc(0);
        if (this.socket) {
            this.socket.removeAllListeners();
            this.socket.destroy();
            this.socket = null;
        }
        this.setState('closed');
        this.emit('close');
        if (!this.closedOnPurpose && (this.tcp.autoReconnect || this.#reconnect)) {
            setTimeout(() => {
                this.#reconnect = false;
                this.connect();
            }, this.tcp.reconnectTimeout);
        }
    };
    #onSocketError = (err) => {
        this.log.error(`Socket Error ${err}`);
        this.setState('error');
        this.emit('error', err);
    };
    #onSocketData = (data) => {
        this.buffer = Buffer.concat([this.buffer, data]);
        while (this.buffer.length > 4) {
            // 1. there is no mbap
            // 2. extract pdu
            // 0 - device ID
            // 1 - Function CODE
            // 2 - Bytes length
            // 3.. Data
            // checksum.(2 bytes
            let len;
            let pdu;
            // if response for write
            if (this.buffer[1] === 5 || this.buffer[1] === 6 || this.buffer[1] === 15 || this.buffer[1] === 16) {
                if (this.buffer.length < 8) {
                    break;
                }
                pdu = this.buffer.slice(0, 8); // 1 byte device ID + 1 byte FC + 2 bytes address + 2 bytes value + 2 bytes CRC
            }
            else if (this.buffer[1] > 0 && this.buffer[1] < 5) {
                len = this.buffer[2];
                if (this.buffer.length < len + 5) {
                    break;
                }
                pdu = this.buffer.slice(0, len + 5); // 1 byte deviceID + 1 byte FC + 1 byte length  + 2 bytes CRC
            }
            else {
                if (this.buffer[1] & 0x80) {
                    const errorCode = this.buffer[2];
                    // error code
                    if (errorCode && errors_1.default[errorCode]) {
                        this.log.error(`Error response for FCx${this.buffer[1] & 0x7f}: ${errors_1.default[errorCode].name}`);
                        this.log.error(`Error response: ${errors_1.default[errorCode].desc}`);
                    }
                    else {
                        this.log.error(`Error response: ${errorCode.toString(16)}`);
                    }
                }
                else {
                    // unknown function code
                    this.log.error(`unknown function code: 0x${this.buffer[1].toString(16)}, 0x${this.buffer[2].toString(16)}`);
                }
                // reset buffer and try again
                this.buffer = Buffer.alloc(0);
                break;
            }
            if (!(0, crc16modbus_1.default)(pdu)) {
                /* PDU is valid if CRC across whole PDU equals 0, else ignore and do nothing */
                // The client core drops an answer from another unit than the pending request was sent to
                // emit data event and let the
                // listener handle the pdu
                this.emit('data', pdu.slice(1, pdu.length - 2), pdu[0]);
            }
            else {
                this.log.error(`Wrong CRC for frame: ${toStrArray(pdu)}`);
                // reset buffer and try again
                this.buffer = Buffer.alloc(0);
                break;
            }
            this.buffer = this.buffer.slice(pdu.length, this.buffer.length);
        }
    };
    #onError = () => {
        this.log.error(`Client in error state (${this.tcp.host}:${this.tcp.port}), closing the socket.`);
        this.socket?.destroy();
    };
    #onSend = (pdu, unitId) => {
        this.log.debug('Sending pdu to the socket.');
        const pkt = new Put_1.default()
            .word8((unitId === undefined ? this.unitId : unitId) || 0) // unit id
            .put(pdu); // the actual pdu
        const buf = pkt.buffer();
        const crc16 = (0, crc16modbus_1.default)(buf);
        this.socket?.write(pkt.word16le(crc16).buffer());
    };
    connect() {
        this.setState('connect');
        // Start every (re)connection from a clean state: no leftover bytes and
        // open again after an on-purpose close.
        this.buffer = Buffer.alloc(0);
        this.closedOnPurpose = false;
        if (!this.socket) {
            this.socket = new node_net_1.Socket();
            this.socket.on('connect', this.#onSocketConnect);
            this.socket.on('close', this.#onSocketClose);
            this.socket.on('error', this.#onSocketError);
            this.socket.on('data', this.#onSocketData);
        }
        this.socket.connect(this.tcp.port, this.tcp.host);
    }
    reconnect() {
        if (!this.inState('closed')) {
            return;
        }
        this.closedOnPurpose = false;
        this.#reconnect = true;
        this.log.debug('Reconnecting client.');
        this.socket?.end();
    }
    close() {
        this.closedOnPurpose = true;
        this.log.debug('Closing client on purpose.');
        this.socket?.end();
    }
}
exports.default = ModbusClientTcpRtu;
//# sourceMappingURL=modbus-client-tcp-rtu.js.map