"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const Put_1 = __importDefault(require("../../Put"));
const node_net_1 = require("node:net");
const modbus_client_core_1 = __importDefault(require("../modbus-client-core"));
class ModbusClientTCP extends modbus_client_core_1.default {
    reqId = 0;
    currentRequestId = 0;
    // The transaction ID identifies the answer, some devices do not echo the unit ID
    checkUnitId = false;
    ignoreTransactionId;
    closedOnPurpose = false;
    #reconnect = false;
    buffer = Buffer.alloc(0);
    socket = null;
    tcp;
    unitId;
    constructor(options) {
        super(options);
        this.ignoreTransactionId = !!options.ignoreTransactionId;
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
        // starts from a clean state with a fresh socket. Otherwise leftover bytes from
        // a frame that was cut off by the disconnect would desync the MBAP parser and
        // (as TCP has no checksum to resync on) break every subsequent poll (issue #594).
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
        while (this.buffer.length > 8) {
            // http://www.simplymodbus.ca/TCP.htm
            // 1. extract mbap
            const id = this.buffer.readUInt16BE(0);
            const len = this.buffer.readUInt16BE(4);
            const unitId = this.buffer.readUInt8(6);
            // 2. extract pdu
            if (this.buffer.length < 7 + len - 1) {
                break;
            }
            const pdu = this.buffer.slice(7, 7 + len - 1);
            if (id !== this.currentRequestId && !this.ignoreTransactionId) {
                // Answer to another request, e.g. a stale one on a fresh connection or a late answer
                // to a timed out request. Taking it would shift every following response (issue #829)
                this.log.warn(`Dropped a response with transaction ID ${id}, expected ${this.currentRequestId}. ` +
                    'If every response is dropped, the device does not echo the transaction ID: enable "ignoreTransactionId"');
            }
            else {
                // emit data event and let the
                // listener handle the pdu
                this.emit('data', pdu, unitId);
            }
            this.buffer = this.buffer.slice(pdu.length + 7, this.buffer.length);
        }
    };
    #onError = () => {
        this.log.error(`Client in error state (${this.tcp.host}:${this.tcp.port}), closing the socket.`);
        this.socket?.destroy();
    };
    #onSend = (pdu, unitId) => {
        this.reqId = (this.reqId + 1) % 0xffff;
        const pkt = new Put_1.default()
            .word16be(this.reqId) // transaction id
            .word16be(this.tcp.protocolVersion) // protocol version
            .word16be(pdu.length + 1) // pdu length
            .word8((unitId === undefined ? this.unitId : unitId) || 0) // unit id
            .put(pdu) // the actual pdu
            .buffer();
        this.currentRequestId = this.reqId;
        this.socket?.write(pkt);
    };
    connect() {
        this.setState('connect');
        // Start every (re)connection from a clean state: no leftover bytes, no
        // expected transaction id until the first request, and open again after an on-purpose close.
        this.buffer = Buffer.alloc(0);
        this.currentRequestId = -1;
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
exports.default = ModbusClientTCP;
//# sourceMappingURL=modbus-client-tcp.js.map