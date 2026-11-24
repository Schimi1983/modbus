"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.describeRequest = describeRequest;
const node_events_1 = require("node:events");
const Put_1 = __importDefault(require("../Put"));
const ExceptionMessage = {
    0x01: 'ILLEGAL FUNCTION',
    0x02: 'ILLEGAL DATA ADDRESS',
    0x03: 'ILLEGAL DATA VALUE',
    0x04: 'SLAVE DEVICE FAILURE',
    0x05: 'ACKNOWLEDGE',
    0x06: 'SLAVE DEVICE BUSY',
    0x08: 'MEMORY PARITY ERROR',
    0x0a: 'GATEWAY PATH UNAVAILABLE',
    0x0b: 'GATEWAY TARGET DEVICE FAILED TO RESPOND',
};
/** Function code names used in log messages */
const FUNCTION_NAMES = {
    1: 'read coils',
    2: 'read discrete inputs',
    3: 'read holding registers',
    4: 'read input registers',
    5: 'write single coil',
    6: 'write single register',
    15: 'write multiple coils',
    16: 'write multiple registers',
};
/**
 * One line description of a request for log messages, e.g.
 * `FC16 write multiple registers, address 6609, quantity 1, unit 1`.
 *
 * Without it a timeout or a device exception only says THAT something failed, but not for which
 * register, function code or device - the first question of every analysis (issue #811).
 */
function describeRequest(request) {
    const name = FUNCTION_NAMES[request.fc];
    const parts = [`FC${request.fc}${name ? ` ${name}` : ''}`];
    if (request.pdu.length >= 5) {
        parts.push(`address ${request.pdu.readUInt16BE(1)}`);
        // FC5/FC6 carry the written value where the other function codes carry the quantity
        parts.push(request.fc === 5 || request.fc === 6
            ? `value 0x${request.pdu.readUInt16BE(3).toString(16).padStart(4, '0')}`
            : `quantity ${request.pdu.readUInt16BE(3)}`);
    }
    parts.push(`unit ${request.unitId}`);
    return parts.join(', ');
}
/**
 * `Error` for a failed request that keeps the Modbus details.
 *
 * The request callbacks report an object with the exception and timeout information, but the promise
 * of every function code used to reject with `new Error(err.message)` - so everything but `timeout`
 * or the exception text was lost before it reached the adapter's log (issue #811).
 */
function requestError(err) {
    const parts = [err.message === 'timeout' && err.timeout ? `timeout after ${err.timeout} ms` : err.message];
    if (err.exceptionCode !== undefined) {
        parts.push(`exception 0x${err.exceptionCode.toString(16).padStart(2, '0')}`);
    }
    if (err.request) {
        parts.push(err.request);
    }
    return Object.assign(new Error(parts.join(' - ')), {
        errorCode: err.errorCode,
        exceptionCode: err.exceptionCode,
        timeout: err.timeout,
        request: err.request,
        incomplete: err.incomplete,
    });
}
class ModbusClientCore extends node_events_1.EventEmitter {
    log;
    responseHandler = {};
    currentRequest = null;
    reqFifo = [];
    timeout;
    /** Optional per-device settings, keyed by unitId. `timeout` overrides `timeout` for that device (issue #605) */
    deviceTimeouts;
    currentState = 'init';
    /**
     * Drop responses from another unit. The MBAP transports (TCP, SSL, UDP) match the transaction ID
     * instead, as some TCP devices do not echo the unit ID.
     */
    checkUnitId = true;
    /**
     * A timeout fails only its request, the connection stays open (issue #832). Only safe where the
     * transaction ID drops a late answer to the timed out request (TCP, SSL, UDP).
     */
    keepConnectionOnTimeout;
    /** Units that timed out since the last response, see `TrashedRequestInfo.silentUnits` */
    silentUnits = new Set();
    constructor(options) {
        super();
        this.log = options.logger;
        this.timeout ||= options.timeout || 5 * 1000; // 5s
        this.deviceTimeouts = options.deviceTimeouts;
        this.keepConnectionOnTimeout = !!options.keepConnectionOnTimeout;
        this.on('data', this.onData);
        this.on('newState_ready', this.flush);
        this.on('newState_closed', this.onClosed);
        this.responseHandler = {
            1: this.#onReadCoils,
            2: this.#onReadDiscreteInputs,
            3: this.#onReadHoldingRegisters,
            4: this.#onReadInputRegisters,
            5: this.#onWriteSingleCoil,
            6: this.#onWriteSingleRegister,
            15: this.#onWriteMultipleCoils,
            16: this.#onWriteMultipleRegisters,
        };
    }
    inState(state) {
        return this.currentState === state;
    }
    getState() {
        return this.currentState;
    }
    setState(newState) {
        const oldState = this.currentState;
        this.currentState = newState;
        this.emit('stateChanged', oldState, newState);
        this.emit(`newState_${newState}`);
    }
    flush = () => {
        if (this.reqFifo.length) {
            // Capture the request the timer belongs to: `this.currentRequest` may already be the next
            // one by the time the timeout fires
            const request = (this.currentRequest = this.reqFifo.shift());
            // Per-device timeout overrides the global one for this unit ID (issue #605)
            const timeout = request.options?.timeout || this.deviceTimeouts?.[request.unitId]?.timeout || this.timeout;
            request.timeout = setTimeout(() => {
                const description = describeRequest(request);
                request.timeout = undefined;
                // A response that arrives after the timeout must not be taken for the next request
                if (this.currentRequest === request) {
                    this.currentRequest = null;
                }
                request.cb?.({ message: 'timeout', timeout, request: description });
                if (request.options?.probe) {
                    // An unanswered probe is expected, e.g. a register of another device type
                    this.log.debug(`Probe timed out after ${timeout} ms: ${description}`);
                    if (this.inState('waiting')) {
                        this.setState('ready');
                    }
                    return;
                }
                const info = {
                    reason: `timeout after ${timeout} ms`,
                    request: description,
                    fc: request.fc,
                    unitId: request.unitId,
                    timeout,
                };
                if (this.keepConnectionOnTimeout) {
                    // Only this request failed: a late answer to it is dropped by its transaction ID,
                    // so the next request can go out on the same connection (issue #832)
                    this.silentUnits.add(request.unitId);
                    info.silentUnits = [...this.silentUnits];
                    this.log.warn(`Request timed out after ${timeout} ms, keeping the connection: ${description}`);
                    this.emit('requestTimeout', info);
                    if (this.inState('waiting')) {
                        this.setState('ready');
                    }
                    return;
                }
                this.emit('trashCurrentRequest', info);
                this.log.error(`Request timed out after ${timeout} ms: ${description}`);
                this.setState('error');
            }, timeout);
            this.setState('waiting');
            this.emit('send', request.pdu, request.unitId);
        }
    };
    onClosed() {
        // The socket is gone, so any in-flight or queued request can never be answered. Reject them all (instead
        // of leaving their promises pending forever) so callers - e.g. a block-read retry - react promptly.
        const reject = (request) => {
            if (request.timeout) {
                clearTimeout(request.timeout);
                request.timeout = undefined;
            }
            request.cb?.({ message: 'connection closed', request: describeRequest(request) });
        };
        this.log.debug('Cleaning up request fifo.');
        if (this.currentRequest) {
            reject(this.currentRequest);
            this.currentRequest = null;
        }
        for (const request of this.reqFifo) {
            reject(request);
        }
        this.reqFifo = [];
    }
    handleErrorPDU(pdu, request) {
        const errorCode = pdu.readUInt8(0);
        // if error code is smaller than 0x80
        // ths pdu describes no error
        if (errorCode < 0x80) {
            return false;
        }
        // pdu describes an error
        const exceptionCode = pdu.readUInt8(1);
        const message = ExceptionMessage[exceptionCode];
        const err = {
            errorCode,
            exceptionCode,
            message,
            request: describeRequest(request),
        };
        // call the desired deferred
        request.cb(err);
        return true;
    }
    /**
     * Why a response cannot be the answer to the pending request, or `null` if it can.
     *
     * Such a response is dropped and the request keeps waiting for its own answer (or its timeout).
     * Taking it would decode the registers of another block as this one - e.g. a stale answer on a
     * fresh connection shifts every response of the cycle by one request (issue #829).
     * The transaction ID is checked by the MBAP transports themselves (TCP, SSL, UDP).
     */
    #foreignResponse(request, pdu, unitId) {
        if (!pdu.length) {
            return 'empty PDU';
        }
        const fc = pdu.readUInt8(0) & 0x7f;
        if (fc !== request.fc) {
            return `function code ${fc} instead of ${request.fc}`;
        }
        if (this.checkUnitId && unitId !== request.unitId) {
            return `unit ${unitId} instead of ${request.unitId}`;
        }
        return null;
    }
    /**
     * Why the answer to the pending request is unusable, or `null` if it is fine.
     *
     * The request fails with this reason: a read must return exactly the requested quantity, a write
     * must confirm the requested address. A device that answers a read with fewer registers than
     * requested does not implement every address of the block (issues #502/#581) - decoding the part
     * that fits could store garbage, so the whole block is discarded.
     */
    #invalidResponse(request, pdu) {
        if (pdu.readUInt8(0) & 0x80) {
            // exception response, handled by handleErrorPDU
            return pdu.length < 2 ? { message: 'exception response without exception code' } : null;
        }
        const address = request.pdu.readUInt16BE(1);
        const quantity = request.pdu.readUInt16BE(3);
        if (request.fc >= 1 && request.fc <= 4) {
            const isBinary = request.fc <= 2;
            const expected = isBinary ? Math.ceil(quantity / 8) : quantity * 2;
            if (pdu.length < 2) {
                return { message: 'response without byte count' };
            }
            const byteCount = pdu.readUInt8(1);
            if (byteCount + 2 > pdu.length) {
                return {
                    message: `response length is invalid: received ${pdu.length} bytes, expected ${byteCount + 2} bytes`,
                };
            }
            if (byteCount !== expected) {
                return {
                    message: isBinary
                        ? `device returned ${byteCount} of ${expected} requested bytes`
                        : `device returned ${byteCount >> 1} of ${quantity} requested registers`,
                    incomplete: byteCount < expected,
                };
            }
            return null;
        }
        // FC5, FC6, FC15 and FC16 echo the address (and value or quantity)
        if (pdu.length < 5) {
            return { message: `response length is invalid: received ${pdu.length} bytes, expected 5 bytes` };
        }
        if (pdu.readUInt16BE(1) !== address) {
            return { message: `device confirmed address ${pdu.readUInt16BE(1)} instead of ${address}` };
        }
        return null;
    }
    /**
     *  Handle the incoming data, cut out the packet and send the pdu to the listener
     */
    onData = (pdu, unitId) => {
        const request = this.currentRequest;
        if (!request) {
            this.log.debug(`Dropped a response without a pending request (unit ${unitId}, ${pdu.length} bytes)`);
            return;
        }
        const foreign = this.#foreignResponse(request, pdu, unitId);
        if (foreign) {
            this.log.warn(`Dropped a response that does not belong to the pending request (${foreign}): ${describeRequest(request)}`);
            return;
        }
        if (request.timeout) {
            clearTimeout(request.timeout);
            request.timeout = undefined;
        }
        // The request is answered now: nothing that arrives later may be taken as its response
        this.currentRequest = null;
        // The connection works: units that timed out before are just not answering themselves
        this.silentUnits.clear();
        const invalid = this.#invalidResponse(request, pdu);
        if (invalid) {
            request.cb({ ...invalid, request: describeRequest(request) });
            this.setState('ready');
            return;
        }
        // check pdu for error
        if (this.handleErrorPDU(pdu, request)) {
            this.log.debug('Received pdu describes an error.');
            this.setState('ready');
            return;
        }
        // handle pdu
        const handler = this.responseHandler[request.fc];
        if (!handler) {
            this.log.warn(`Found no handler for fc ${request.fc}`);
            request.cb({ message: `no handler implemented for fc ${request.fc}`, request: describeRequest(request) });
            this.setState('ready');
            return;
        }
        // The request must be answered in any case: a request whose callback is never called leaves
        // the promise of the poll pending forever, and the master stops polling (issue #831)
        let answered = false;
        const cb = (err, response) => {
            answered = true;
            request.cb(err, response);
        };
        try {
            handler(unitId, pdu, cb);
        }
        catch (err) {
            this.log.warn(`Error in handler for FC${request.fc}: ${err}`);
            if (!answered) {
                cb({
                    message: `invalid response: ${err.message || err}`,
                    request: describeRequest(request),
                });
            }
        }
        this.setState('ready');
    };
    queueRequest = (unitId, fc, pdu, cb, options) => {
        this.reqFifo.push({ unitId, fc, pdu, cb, options });
        if (this.inState('ready')) {
            this.flush();
        }
    };
    // FC 1 - Read Coils
    #onReadCoils = (unitId, pdu, cb) => {
        const fc = pdu.readUInt8(0);
        // Check if this is an error response (FC + 0x80)
        if (fc === 1 + 0x80) {
            // This is a ModBus error response for ReadCoils
            const exceptionCode = pdu.readUInt8(1);
            const message = ExceptionMessage[exceptionCode] || `Unknown exception code: ${exceptionCode}`;
            cb({
                errorCode: fc,
                exceptionCode,
                message: `ReadCoils: ${message}`,
            });
        }
        else if (fc !== 1) {
            cb({ message: `ReadCoils: Invalid FC ${fc}` });
        }
        else {
            const byteCount = pdu.readUInt8(1);
            // let bitCount    = byteCount * 8;
            const resp = {
                unitId,
                fc,
                byteCount,
                payload: pdu.slice(2),
                data: [],
            };
            let counter = 0;
            for (let i = 0; i < byteCount; i += 1) {
                let h = 1;
                const cur = pdu.readUInt8(2 + i);
                for (let j = 0; j < 8; j++) {
                    resp.data[counter] = (cur & h) > 0;
                    h = h << 1;
                    counter += 1;
                }
            }
            cb(null, resp);
        }
    };
    readCoils = (unitId, start, quantity) => {
        return new Promise((resolve, reject) => {
            const pdu = new Put_1.default().word8(1).word16be(start).word16be(quantity).buffer();
            this.queueRequest(unitId, 1, pdu, (err, resp) => {
                if (err) {
                    reject(requestError(err));
                }
                else {
                    resolve(resp);
                }
            });
        });
    };
    // FC 2 - Read Discrete Inputs
    #onReadDiscreteInputs = (unitId, pdu, cb) => {
        const fc = pdu.readUInt8(0);
        // Check if this is an error response (FC + 0x80)
        if (fc === 2 + 0x80) {
            // This is a ModBus error response for ReadDiscreteInputs
            const exceptionCode = pdu.readUInt8(1);
            const message = ExceptionMessage[exceptionCode] || `Unknown exception code: ${exceptionCode}`;
            cb({
                errorCode: fc,
                exceptionCode,
                message: `ReadDiscreteInputs: ${message}`,
            });
        }
        else if (fc !== 2) {
            cb({ message: `ReadDiscreteInputs: Invalid FC ${fc}` });
        }
        else {
            const byteCount = pdu.readUInt8(1);
            let counter = 0;
            const resp = {
                unitId,
                fc,
                byteCount,
                payload: pdu.slice(2),
                data: [],
            };
            for (let i = 0; i < byteCount; i++) {
                let h = 1;
                const cur = pdu.readUInt8(2 + i);
                for (let j = 0; j < 8; j += 1) {
                    resp.data[counter] = (cur & h) > 0;
                    h = h << 1;
                    counter += 1;
                }
            }
            cb(null, resp);
        }
    };
    readDiscreteInputs = (unitId, start, quantity) => {
        return new Promise((resolve, reject) => {
            if (quantity > 2000) {
                return reject(new Error('quantity is too big'));
            }
            const pdu = new Put_1.default().word8be(2).word16be(start).word16be(quantity).buffer();
            this.queueRequest(unitId, 2, pdu, (err, resp) => {
                if (err) {
                    reject(requestError(err));
                }
                else {
                    resolve(resp);
                }
            });
        });
    };
    // FC 3 - Read Holding Registers
    #onReadHoldingRegisters = (unitId, pdu, cb) => {
        const fc = pdu.readUInt8(0);
        // Check if this is an error response (FC + 0x80)
        if (fc === 3 + 0x80) {
            // This is a ModBus error response for ReadHoldingRegisters
            const exceptionCode = pdu.readUInt8(1);
            const message = ExceptionMessage[exceptionCode] || `Unknown exception code: ${exceptionCode}`;
            cb({
                errorCode: fc,
                exceptionCode,
                message: `ReadHoldingRegisters: ${message}`,
            });
        }
        else if (fc !== 3) {
            cb({ message: `ReadHoldingRegisters: Invalid FC ${fc}` });
        }
        else {
            const byteCount = pdu.readUInt8(1);
            const resp = {
                unitId,
                fc,
                byteCount,
                payload: pdu.slice(2),
                register: [],
            };
            const registerCount = byteCount / 2;
            if (byteCount + 2 > pdu.byteLength) {
                cb({
                    message: `ReadHoldingRegisters: Response length is invalid. Received ${pdu.byteLength} bytes, expected ${byteCount + 2} bytes`,
                });
                return;
            }
            for (let i = 0; i < registerCount; i++) {
                resp.register.push(pdu.readUInt16BE(2 + i * 2));
            }
            cb(null, resp);
        }
    };
    readHoldingRegisters = (unitId, start, quantity, options) => {
        return new Promise((resolve, reject) => {
            const pdu = new Put_1.default().word8be(3).word16be(start).word16be(quantity).buffer();
            this.queueRequest(unitId, 3, pdu, (err, resp) => {
                if (err) {
                    reject(requestError(err));
                }
                else {
                    resolve(resp);
                }
            }, options);
        });
    };
    // FC 4 - Read Input Registers
    #onReadInputRegisters = (unitId, pdu, cb) => {
        const fc = pdu.readUInt8(0);
        // Check if this is an error response (FC + 0x80)
        if (fc === 4 + 0x80) {
            // This is a ModBus error response for ReadInputRegisters
            const exceptionCode = pdu.readUInt8(1);
            const message = ExceptionMessage[exceptionCode] || `Unknown exception code: ${exceptionCode}`;
            cb({
                errorCode: fc,
                exceptionCode,
                message: `ReadInputRegisters: ${message}`,
            });
        }
        else if (fc !== 4) {
            cb({ message: `ReadInputRegisters: Invalid FC ${fc}` });
        }
        else {
            const byteCount = pdu.readUInt8(1);
            const resp = {
                unitId,
                fc,
                byteCount,
                payload: pdu.slice(2),
                register: [],
            };
            const registerCount = byteCount / 2;
            if (byteCount + 2 > pdu.byteLength) {
                cb({
                    message: `ReadInputRegisters: Response length is invalid. Received ${pdu.byteLength} bytes, expected ${byteCount + 2} bytes`,
                });
                return;
            }
            for (let i = 0; i < registerCount; i++) {
                resp.register.push(pdu.readUInt16BE(2 + i * 2));
            }
            cb(null, resp);
        }
    };
    readInputRegisters = (unitId, start, quantity, options) => {
        return new Promise((resolve, reject) => {
            const pdu = new Put_1.default().word8be(4).word16be(start).word16be(quantity).buffer();
            this.queueRequest(unitId, 4, pdu, (err, resp) => {
                if (err) {
                    reject(requestError(err));
                }
                else {
                    resolve(resp);
                }
            }, options);
        });
    };
    // FC 5 - Write Single Coil
    #onWriteSingleCoil = (unitId, pdu, cb) => {
        const fc = pdu.readUInt8(0);
        const outputAddress = pdu.readUInt16BE(1);
        const outputValue = pdu.readUInt16BE(3);
        const resp = {
            unitId,
            fc,
            outputAddress,
            outputValue: outputValue === 0x0000 ? false : outputValue === 0xff00 ? true : undefined,
        };
        if (fc !== 5) {
            cb({ message: `WriteSingleCoil: Invalid FC ${fc}` });
        }
        else {
            cb(null, resp);
        }
    };
    writeSingleCoil = (unitId, address, value) => {
        return new Promise((resolve, reject) => {
            const payload = value instanceof Buffer ? value.readUInt8(0) > 0 : value;
            const pdu = new Put_1.default()
                .word8be(5)
                .word16be(address)
                .word16be(payload ? 0xff00 : 0x0000);
            this.queueRequest(unitId, 5, pdu.buffer(), (err, resp) => {
                if (err) {
                    reject(requestError(err));
                }
                else {
                    resolve(resp);
                }
            });
        });
    };
    // FC 6 - Write Single Register
    #onWriteSingleRegister = (unitId, pdu, cb) => {
        const fc = pdu.readUInt8(0);
        const registerAddress = pdu.readUInt16BE(1);
        const registerValue = pdu.readUInt16BE(3);
        const resp = {
            unitId,
            fc,
            registerAddress,
            registerValue,
            registerAddressRaw: pdu.slice(1, 3),
            registerValueRaw: pdu.slice(3, 5),
        };
        if (fc !== 6) {
            cb({ message: `WriteSingleRegister: Invalid FC ${fc}` });
        }
        else {
            cb(null, resp);
        }
    };
    writeSingleRegister = (unitId, address, value) => {
        return new Promise((resolve, reject) => {
            const payload = value instanceof Buffer ? value : new Put_1.default().word16be(value).buffer();
            const pdu = new Put_1.default().word8be(6).word16be(address).put(payload);
            this.queueRequest(unitId, 6, pdu.buffer(), (err, resp) => {
                if (err) {
                    reject(requestError(err));
                }
                else {
                    resolve(resp);
                }
            });
        });
    };
    // FC 15 - Write Multiple Coils
    #onWriteMultipleCoils = (unitId, pdu, cb) => {
        const fc = pdu.readUInt8(0);
        const startAddress = pdu.readUInt16BE(1);
        const quantity = pdu.readUInt16BE(3);
        const resp = {
            unitId,
            fc,
            startAddress,
            quantity,
        };
        if (fc !== 15) {
            cb({ message: `WriteMultipleCoils: Invalid FC ${fc}` });
        }
        else {
            cb(null, resp);
        }
    };
    writeMultipleCoils = (unitId, startAddress, data, N) => {
        return new Promise((resolve, reject) => {
            const pdu = new Put_1.default().word8(15).word16be(startAddress);
            if (data instanceof Buffer) {
                pdu.word16be(N).word8(data.length).put(data);
            }
            else if (data instanceof Array) {
                if (data.length > 1968) {
                    reject(new Error('Length is too big'));
                    return;
                }
                const byteCount = Math.ceil(data.length / 8);
                let curByte = 0;
                let cntr = 0;
                pdu.word16be(data.length).word8(byteCount);
                for (let i = 0; i < data.length; i++) {
                    curByte += data[i] ? Math.pow(2, cntr) : 0;
                    cntr = (cntr + 1) % 8;
                    if (cntr === 0 || i === data.length - 1) {
                        pdu.word8(curByte);
                        curByte = 0;
                    }
                }
            }
            this.queueRequest(unitId, 15, pdu.buffer(), (err, resp) => {
                if (err) {
                    reject(requestError(err));
                }
                else {
                    resolve(resp);
                }
            });
        });
    };
    // FC 16 - Write Multiple Registers
    #onWriteMultipleRegisters = (unitId, pdu, cb) => {
        const fc = pdu.readUInt8(0);
        if (fc !== 16) {
            cb({ message: `WriteMultipleRegisters: Invalid FC ${fc}` });
        }
        else {
            const startAddress = pdu.readUInt16BE(1);
            const quantity = pdu.readUInt16BE(3);
            const resp = {
                unitId,
                fc,
                startAddress,
                quantity,
            };
            cb(null, resp);
        }
    };
    writeMultipleRegisters = (unitId, startAddress, data) => {
        return new Promise((resolve, reject) => {
            const pdu = new Put_1.default().word8(16).word16be(startAddress);
            if (data instanceof Buffer) {
                if (data.length / 2 > 0x007b) {
                    reject(new Error('Length is too big'));
                    return;
                }
                pdu.word16be(data.length / 2)
                    .word8(data.length)
                    .put(data);
            }
            else if (data instanceof Array) {
                if (data.length > 0x007b) {
                    reject(new Error('Length is too big'));
                    return;
                }
                const byteCount = Math.ceil(data.length * 2);
                pdu.word16be(data.length).word8(byteCount);
                for (let i = 0; i < data.length; i += 1) {
                    pdu.word16be(data[i]);
                }
            }
            else {
                reject(new Error('Invalid data'));
                return;
            }
            this.queueRequest(unitId, 16, pdu.buffer(), (err, resp) => {
                if (err) {
                    reject(requestError(err));
                }
                else {
                    resolve(resp);
                }
            });
        });
    };
}
exports.default = ModbusClientCore;
//# sourceMappingURL=modbus-client-core.js.map