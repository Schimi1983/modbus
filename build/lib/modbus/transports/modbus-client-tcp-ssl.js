"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_tls_1 = require("node:tls");
const modbus_client_core_1 = __importDefault(require("../modbus-client-core"));
const Put_1 = __importDefault(require("../../Put"));
class ModbusClientTcpSsl extends modbus_client_core_1.default {
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
    ssl;
    unitId;
    constructor(options) {
        super(options);
        this.ignoreTransactionId = !!options.ignoreTransactionId;
        this.setState('init');
        this.tcp = options.tcp;
        this.ssl = options.ssl;
        this.unitId = options.unitId || 1;
        this.on('send', this.#onSend);
        this.on('newState_error', this.#onError);
    }
    #onSocketConnect = () => {
        this.log.debug('SSL/TLS connection established');
        // Log certificate information for debugging
        if (this.socket?.getPeerCertificate) {
            const cert = this.socket.getPeerCertificate();
            if (cert?.subject) {
                this.log.debug(`Connected to SSL server with certificate subject: ${Array.isArray(cert.subject.CN) ? cert.subject.CN.join(', ') : cert.subject.CN || 'Unknown'}`);
            }
        }
        this.emit('connect');
        this.setState('ready');
    };
    #onSocketClose = (hadErrors) => {
        this.log.debug(hadErrors ? 'SSL/TLS socket closed with error' : 'SSL/TLS socket closed');
        // Discard any half-received frame and drop the used socket. For TLS this is
        // mandatory: the socket connects on creation, so without recreating it connect()
        // would be a no-op and the client would never reconnect (issue #594).
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
        this.log.error(`SSL/TLS Socket Error${err}`);
        this.setState('error');
        this.emit('error', err);
    };
    #onSocketData = (data) => {
        this.buffer = Buffer.concat([this.buffer, data]);
        while (this.buffer.length > 8) {
            // http://www.simplymodbus.ca/TCP.htm
            // 1. extract mbap
            const id = this.buffer.readUInt16BE(0);
            //const protId = buffer.readUInt16BE(2);
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
        this.log.error(`SSL/TLS Client in error state (${this.tcp.host}:${this.tcp.port}), closing the socket.`);
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
            // Prepare SSL/TLS options
            const sslOptions = {
                host: this.tcp.host,
                port: this.tcp.port,
                rejectUnauthorized: this.ssl?.rejectUnauthorized !== false,
            };
            // Load SSL certificates if provided
            sslOptions.cert = this.ssl.cert;
            sslOptions.key = this.ssl.key;
            sslOptions.ca = this.ssl.ca;
            this.socket = (0, node_tls_1.connect)(sslOptions);
            this.socket.on('secureConnect', this.#onSocketConnect);
            this.socket.on('close', this.#onSocketClose);
            this.socket.on('error', this.#onSocketError);
            this.socket.on('data', this.#onSocketData);
        }
    }
    reconnect() {
        if (!this.inState('closed')) {
            return;
        }
        this.closedOnPurpose = false;
        this.#reconnect = true;
        this.log.debug('Reconnecting SSL/TLS client.');
        this.socket?.end();
    }
    close() {
        this.closedOnPurpose = true;
        this.log.debug('Closing SSL/TLS client on purpose.');
        this.socket?.end();
    }
}
exports.default = ModbusClientTcpSsl;
//# sourceMappingURL=modbus-client-tcp-ssl.js.map