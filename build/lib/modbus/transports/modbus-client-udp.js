"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const Put_1 = __importDefault(require("../../Put"));
const node_dgram_1 = require("node:dgram");
const modbus_client_core_1 = __importDefault(require("../modbus-client-core"));
/**
 * Modbus/UDP master transport.
 *
 * Modbus/UDP uses the same MBAP header + PDU framing as Modbus/TCP (transaction id, protocol id,
 * length, unit id), but each request/response is carried in a single UDP datagram instead of a TCP
 * stream. That makes framing simpler (one datagram = one complete frame, no reassembly), but UDP is
 * connectionless and unreliable: a request to an offline device usually produces no socket error,
 * it just times out (handled by ModbusClientCore's per-request timeout).
 *
 * The class mirrors `ModbusClientTCP` so it plugs into the same core state machine: the socket
 * `close` event drives the state back to `closed`, and reconnection is left to the caller (Master).
 */
class ModbusClientUDP extends modbus_client_core_1.default {
    reqId = 0;
    currentRequestId = 0;
    // The transaction ID identifies the answer, some devices do not echo the unit ID
    checkUnitId = false;
    ignoreTransactionId;
    closedOnPurpose = false;
    #reconnect = false;
    socket = null;
    udp;
    unitId;
    constructor(options) {
        super(options);
        this.ignoreTransactionId = !!options.ignoreTransactionId;
        this.setState('init');
        this.udp = options.udp;
        this.unitId = options.unitId || 1;
        this.udp.protocolVersion ||= 0;
        this.udp.port ||= 502;
        this.udp.host ||= 'localhost';
        this.udp.autoReconnect ||= false;
        this.udp.reconnectTimeout ||= 0;
        this.on('send', this.#onSend);
        this.on('newState_error', this.#onError);
    }
    #onSocketConnect = () => {
        this.emit('connect');
        this.setState('ready');
    };
    #onSocketClose = () => {
        this.log.debug('Socket closed');
        if (this.socket) {
            this.socket.removeAllListeners();
            this.socket = null;
        }
        this.setState('closed');
        this.emit('close');
        if (!this.closedOnPurpose && (this.udp.autoReconnect || this.#reconnect)) {
            setTimeout(() => {
                this.#reconnect = false;
                this.connect();
            }, this.udp.reconnectTimeout);
        }
    };
    #onSocketError = (err) => {
        this.log.error(`Socket Error ${err}`);
        this.setState('error');
        this.emit('error', err);
    };
    #onSocketMessage = (msg) => {
        // A UDP datagram carries exactly one complete MBAP + PDU frame, so no stream reassembly.
        if (msg.length <= 8) {
            this.log.debug('UDP datagram too short for an MBAP header');
            return;
        }
        // 1. extract mbap
        const id = msg.readUInt16BE(0);
        const len = msg.readUInt16BE(4);
        const unitId = msg.readUInt8(6);
        // 2. extract pdu (length counts unit id + pdu, so pdu length is len - 1)
        if (msg.length < 7 + len - 1) {
            this.log.debug('UDP datagram shorter than the announced MBAP length');
            return;
        }
        const pdu = msg.subarray(7, 7 + len - 1);
        if (id !== this.currentRequestId && !this.ignoreTransactionId) {
            // Late answer to a timed out request, or a duplicated datagram (issue #829)
            this.log.warn(`Dropped a response with transaction ID ${id}, expected ${this.currentRequestId}. ` +
                'If every response is dropped, the device does not echo the transaction ID: enable "ignoreTransactionId"');
        }
        else {
            // emit data event and let the listener handle the pdu
            this.emit('data', pdu, unitId);
        }
    };
    #onError = () => {
        this.log.error(`Client in error state (${this.udp.host}:${this.udp.port}), closing the socket.`);
        // Close the datagram socket; the 'close' event moves the FSM to 'closed'.
        this.#safeClose();
    };
    #onSend = (pdu, unitId) => {
        this.reqId = (this.reqId + 1) % 0xffff;
        const pkt = new Put_1.default()
            .word16be(this.reqId) // transaction id
            .word16be(this.udp.protocolVersion) // protocol version
            .word16be(pdu.length + 1) // pdu length
            .word8((unitId === undefined ? this.unitId : unitId) || 0) // unit id
            .put(pdu) // the actual pdu
            .buffer();
        this.currentRequestId = this.reqId;
        // The socket is connected to the remote peer, so send() needs no explicit address.
        this.socket?.send(pkt, err => {
            if (err) {
                this.#onSocketError(err);
            }
        });
    };
    #safeClose() {
        try {
            this.socket?.close();
        }
        catch {
            // socket not running / already closing – the 'close' handler still fires
        }
    }
    connect() {
        this.setState('connect');
        // Start every (re)connection from a clean state.
        this.currentRequestId = -1;
        this.closedOnPurpose = false;
        if (!this.socket) {
            this.socket = (0, node_dgram_1.createSocket)('udp4');
            this.socket.on('connect', this.#onSocketConnect);
            this.socket.on('close', this.#onSocketClose);
            this.socket.on('error', this.#onSocketError);
            this.socket.on('message', this.#onSocketMessage);
        }
        // `connect` fixes the remote peer (and does the DNS lookup); afterwards send()/message
        // only talk to that peer and it emits 'connect'. UDP has no real handshake.
        this.socket.connect(this.udp.port, this.udp.host);
    }
    reconnect() {
        if (!this.inState('closed')) {
            return;
        }
        this.closedOnPurpose = false;
        this.#reconnect = true;
        this.log.debug('Reconnecting client.');
        this.#safeClose();
    }
    close() {
        this.closedOnPurpose = true;
        this.log.debug('Closing client on purpose.');
        this.#safeClose();
    }
}
exports.default = ModbusClientUDP;
//# sourceMappingURL=modbus-client-udp.js.map