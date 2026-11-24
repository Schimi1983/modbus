"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("./common");
const modbus_server_serial_1 = __importDefault(require("./modbus/transports/modbus-server-serial"));
const modbus_server_tcp_1 = __importDefault(require("./modbus/transports/modbus-server-tcp"));
const loggingUtils_1 = require("./loggingUtils");
const usedResources_1 = require("./usedResources");
// expected
// let options =  {
//     config: {
//          round: 1,
//          tcp: {
//              port: 502
//          }
//     },
//     objects: {
//     }
//     coils: {
//         config: ...
//         changed: true,
//         addressHigh: 0,
//         addressLow: 0,
//         values: [],
//         mapping: {}
//     },
//     inputRegs: ...,
//     disInputs: ...,
//     holdingRegs: ...
// };
class Slave {
    objects;
    /** All served devices, keyed by their Modbus unit/device ID (issue #813) */
    devices;
    deviceIds;
    /** Unit used for requests with a neutral unit ID (0/255) and for states without a device ID */
    defaultDeviceId;
    delayStart = true;
    modbusServer = null;
    adapter;
    options;
    connectionId;
    /**
     * ack flag for states written by connected TCP masters:
     * `true` in slave mode (the slave is authoritative), `false` in proxy mode
     * (a client write is a command that is forwarded to the real device via the master).
     */
    writeAck;
    readNotifyCounters = new Map();
    constructor(options, adapter) {
        this.objects = options.objects;
        this.devices = options.devices;
        this.deviceIds = Object.keys(options.devices)
            .map(id => parseInt(id, 10))
            .sort((a, b) => a - b);
        this.defaultDeviceId = this.devices[options.config.defaultDeviceId]
            ? options.config.defaultDeviceId
            : this.deviceIds[0];
        this.adapter = adapter;
        this.options = options;
        // In proxy mode the master owns info.connection (device link); the slave server reports its clients separately
        this.connectionId = options.config.proxy ? 'info.connectionSlave' : 'info.connection';
        // In proxy mode a client write must reach the real device: set ack=false so stateChange -> master.write() runs
        this.writeAck = !options.config.proxy;
        void adapter.setState(this.connectionId, '', true);
        // read all other states and set alive to false
        void adapter.getForeignStatesAsync(`${adapter.namespace}.info.clients.*`).then(async (allStates) => {
            for (const id in allStates) {
                if (allStates[id]?.val) {
                    await adapter.setStateAsync(id, false, true);
                }
            }
        });
        void this.initValues().then(() => {
            this.delayStart = false;
            this.adapter.log.debug('Slave ready to start');
            this.start();
        });
    }
    /**
     * Device addressed by a request. The server core already mapped neutral/unknown unit IDs, so an
     * undefined unit ID simply means "the default device".
     */
    #deviceOf(unitId) {
        return this.devices[unitId !== undefined && this.devices[unitId] ? unitId : this.defaultDeviceId];
    }
    /**
     * Device a state belongs to. Without this every polled value would land in the buffers of the first
     * device, so identical registers of different device IDs overwrote each other (issue #813).
     */
    #deviceOfState(id) {
        return this.#deviceOf(this.objects[id]?.native?.deviceId);
    }
    write(id, state) {
        if (!this.objects[id] || !this.objects[id].native) {
            this.adapter.log.error(`Can not set state ${id}: unknown object`);
            return Promise.resolve();
        }
        if (this.objects[id].native.float === undefined) {
            this.objects[id].native.float =
                this.objects[id].native.type === 'floatle' ||
                    this.objects[id].native.type === 'floatbe' ||
                    this.objects[id].native.type === 'floatsw' ||
                    this.objects[id].native.type === 'doublele' ||
                    this.objects[id].native.type === 'doublebe' ||
                    this.objects[id].native.type === 'floatsb';
        }
        let val;
        let buffer;
        let b;
        const t = typeof state.val;
        const type = this.objects[id].native.regType;
        const device = this.#deviceOfState(id);
        if (!device?.[type]) {
            this.adapter.log.error(`Invalid type ${type}`);
            return Promise.resolve();
        }
        const regs = device[type];
        regs.changed = true;
        if (type === 'disInputs' || type === 'coils') {
            if (t === 'boolean' || t === 'number') {
                regs.values[this.objects[id].native.address - regs.addressLow] = state.val ? 1 : 0;
            }
            else {
                regs.values[this.objects[id].native.address - regs.addressLow] = parseInt(state.val, 10)
                    ? 1
                    : 0;
            }
        }
        else if (type === 'inputRegs' || type === 'holdingRegs') {
            if (!common_1.stringRegisterTypes.includes(this.objects[id].native.type)) {
                if (t === 'boolean') {
                    val = state.val ? 1 : 0;
                }
                else if (t === 'number') {
                    val = state.val;
                }
                else {
                    val = parseFloat(state.val);
                }
                val = (val - this.objects[id].native.offset) / this.objects[id].native.factor;
                if (!this.objects[id].native.float) {
                    val = Math.round(val);
                }
            }
            else {
                val = state.val;
            }
            try {
                buffer = (0, common_1.writeValue)(this.objects[id].native.type, val, this.objects[id].native.len);
                for (b = 0; b < buffer.length; b++) {
                    regs.values[(this.objects[id].native.address - regs.addressLow) * 2 + b] = buffer[b];
                }
            }
            catch (err) {
                this.adapter.log.warn(`Can not write value ${val}: ${err}`);
            }
        }
        else {
            this.adapter.log.error(`Unknown state "${id}" type: ${this.objects[id].native.regType}`);
        }
        return Promise.resolve();
    }
    emitReadNotify(valueStateId) {
        const shortId = valueStateId.slice(this.adapter.namespace.length + 1);
        const notifyId = `${this.adapter.namespace}.readNotify.${shortId}`;
        // Counter only: monotonic increment with ack:true. ack:true keeps this out of the
        // stateChange handler, so the adapter never processes its own writes (no feedback loop).
        const counter = (this.readNotifyCounters.get(notifyId) ?? 0) + 1;
        this.readNotifyCounters.set(notifyId, counter);
        const expire = this.options.config.notifyOnReadExpire;
        void this.adapter.setState(notifyId, expire ? { val: counter, ack: true, expire } : { val: counter, ack: true }, err => err && this.adapter.log.error(`readNotify setState error: ${err.message}`));
    }
    start() {
        if (this.deviceIds.length && !this.delayStart && !this.modbusServer) {
            const logWrapper = (0, loggingUtils_1.createLoggingWrapper)(this.adapter.log, this.options.config.disableLogging);
            // One register space per served device ID: the unit ID of a request selects the buffers,
            // instead of every unit ID reading the data of the first device (issue #813)
            const units = {};
            for (const deviceId of this.deviceIds) {
                const device = this.devices[deviceId];
                units[deviceId] = {
                    coils: Buffer.alloc((device.coils.addressHigh + 7) >> 3),
                    discrete: Buffer.alloc((device.disInputs.addressHigh + 7) >> 3),
                    input: Buffer.alloc(device.inputRegs.addressHigh * 2),
                    holding: Buffer.alloc(device.holdingRegs.addressHigh * 2),
                };
            }
            if (!this.options.config.proxy && this.options.config.type === 'serial') {
                if (!this.options.config.serial) {
                    throw new Error('Serial is required');
                }
                const serialResource = {
                    port: this.options.config.serial.comName,
                    baudRate: this.options.config.serial.baudRate || 9600,
                };
                // Who else declared this port? Asked before it is opened - afterwards the operating
                // system has decided it, and the error does not name the other instance
                void (0, usedResources_1.reportResourceConflict)(this.adapter, 'serialPort', serialResource, 'the slave');
                this.modbusServer = new modbus_server_serial_1.default({
                    logger: logWrapper,
                    serial: {
                        portName: this.options.config.serial.comName,
                        baudRate: this.options.config.serial.baudRate || 9600,
                        dataBits: this.options.config.serial.dataBits || 8,
                        stopBits: this.options.config.serial.stopBits || 1,
                        parity: this.options.config.serial.parity || 'none',
                    },
                    deviceId: this.defaultDeviceId,
                    deviceIds: this.deviceIds,
                    responseDelay: 100,
                    units,
                    defaultUnitId: this.defaultDeviceId,
                });
                // The serial server emits `connection` when the port is open, and only then is it
                // really occupied by this instance
                this.modbusServer.on('connection', () => {
                    void (0, usedResources_1.registerUsedResource)(this.adapter, 'serialPort', serialResource);
                });
                this.modbusServer.on('close', () => {
                    void (0, usedResources_1.freeUsedResource)(this.adapter, 'serialPort', { port: serialResource.port });
                });
            }
            else {
                // In proxy mode the built-in slave always serves over TCP on its own endpoint
                const serverTcp = this.options.config.proxy ? this.options.config.proxyTcp : this.options.config.tcp;
                if (!serverTcp) {
                    throw new Error('TCP options is required');
                }
                // Who else declared this port? Asked before it is opened, because an EADDRINUSE does
                // not say which instance is already listening
                void (0, usedResources_1.reportResourceConflict)(this.adapter, 'tcpPort', { port: serverTcp.port || 502, bind: serverTcp.ip || undefined }, this.options.config.proxy ? 'the proxy' : 'the slave');
                this.modbusServer = new modbus_server_tcp_1.default({
                    logger: logWrapper,
                    tcp: {
                        port: serverTcp.port || 502,
                        hostname: serverTcp.ip || '0.0.0.0',
                    },
                    // No artificial responseDelay for TCP: the delay is applied per request and, combined with the
                    // shared request queue, serializes all connections. With multiple masters this stacks into
                    // multi-second latencies (head-of-line blocking) and master timeouts. Omitting it lets the core
                    // use setImmediate, which yields cooperatively without an artificial per-request wall.
                    units,
                    defaultUnitId: this.defaultDeviceId,
                });
                // The address the socket really got, which is not necessarily the configured one
                this.modbusServer.on('listening', (address) => {
                    const data = (0, usedResources_1.listeningPort)(address);
                    if (data) {
                        void (0, usedResources_1.registerUsedResource)(this.adapter, 'tcpPort', data);
                    }
                });
            }
            this.modbusServer.on('readCoilsRequest', (start, quantity, unitId) => {
                const regs = this.#deviceOf(unitId)?.coils;
                if (!regs) {
                    return;
                }
                if (regs.changed ||
                    regs.lastEnd === undefined ||
                    regs.lastStart > start ||
                    regs.lastEnd < start + quantity) {
                    regs.lastStart = start;
                    regs.lastEnd = start + quantity;
                    regs.changed = false;
                    const data = this.modbusServer?.getCoils(unitId);
                    if (!data) {
                        return;
                    }
                    // `start` is a coil (bit) address, so the byte index is start >> 3, not start.
                    // Write each requested coil to its absolute bit position in the buffer.
                    for (let i = 0; i < quantity; i++) {
                        const coil = start + i;
                        if (coil >= regs.addressHigh) {
                            break;
                        }
                        const byteIndex = coil >> 3;
                        if (byteIndex >= data.length) {
                            break;
                        }
                        const a = coil - regs.addressLow;
                        const mask = 1 << (coil & 7);
                        let byte = data.readUInt8(byteIndex);
                        if (a >= 0 && regs.values[a]) {
                            byte |= mask;
                        }
                        else {
                            byte &= ~mask;
                        }
                        data.writeUInt8(byte, byteIndex);
                    }
                }
            });
            this.modbusServer.on('readCoilsRequest', (start, quantity, unitId) => {
                if (this.options.config.notifyOnReadCoils) {
                    const regs = this.#deviceOf(unitId)?.coils;
                    if (!regs) {
                        return;
                    }
                    for (let i = 0; i < quantity; i++) {
                        const a = start + i - regs.addressLow;
                        if (a >= 0 && regs.mapping[a]) {
                            this.emitReadNotify(regs.mapping[a]);
                        }
                    }
                }
            });
            this.modbusServer.on('readDiscreteInputsRequest', (start, quantity, unitId) => {
                const regs = this.#deviceOf(unitId)?.disInputs;
                if (!regs) {
                    return;
                }
                if (regs.changed ||
                    regs.lastEnd === undefined ||
                    regs.lastStart > start ||
                    regs.lastEnd < start + quantity) {
                    regs.lastStart = start;
                    regs.lastEnd = start + quantity;
                    regs.changed = false;
                    const data = this.modbusServer?.getDiscrete(unitId);
                    if (!data) {
                        return;
                    }
                    // `start` is a discrete-input (bit) address, so the byte index is start >> 3, not start.
                    // Write each requested input to its absolute bit position in the buffer.
                    for (let i = 0; i < quantity; i++) {
                        const input = start + i;
                        if (input >= regs.addressHigh) {
                            break;
                        }
                        const byteIndex = input >> 3;
                        if (byteIndex >= data.length) {
                            break;
                        }
                        const a = input - regs.addressLow;
                        const mask = 1 << (input & 7);
                        let byte = data.readUInt8(byteIndex);
                        if (a >= 0 && regs.values[a]) {
                            byte |= mask;
                        }
                        else {
                            byte &= ~mask;
                        }
                        data.writeUInt8(byte, byteIndex);
                    }
                }
                if (this.options.config.notifyOnReadDisInputs) {
                    for (let i = 0; i < quantity; i++) {
                        const a = start + i - regs.addressLow;
                        if (a >= 0 && regs.mapping[a]) {
                            this.emitReadNotify(regs.mapping[a]);
                        }
                    }
                }
            });
            // let "function" here and not use =>
            this.modbusServer.on('readInputRegistersRequest', (start, quantity, unitId) => {
                const regs = this.#deviceOf(unitId)?.inputRegs;
                if (!regs) {
                    return;
                }
                if (regs.changed ||
                    regs.lastEnd === undefined ||
                    regs.lastStart > start ||
                    regs.lastEnd < start + quantity) {
                    regs.lastStart = start;
                    regs.lastEnd = start + quantity;
                    regs.changed = false;
                    const data = this.modbusServer?.getInput(unitId);
                    if (!data) {
                        return;
                    }
                    const end = start + quantity * 2;
                    const low = regs.addressLow * 2;
                    const high = regs.addressHigh * 2;
                    for (let i = start; i < end; i++) {
                        if (i >= data.length) {
                            break;
                        }
                        if (i >= low && i < high) {
                            data.writeUInt8(regs.values[i - low], i);
                        }
                        else {
                            data.writeUInt8(0, i);
                        }
                    }
                }
                if (this.options.config.notifyOnReadInputRegs) {
                    const wordStart = start >> 1;
                    for (let i = 0; i < quantity; i++) {
                        const a = wordStart + i - regs.addressLow;
                        if (a >= 0 && regs.mapping[a]) {
                            this.emitReadNotify(regs.mapping[a]);
                        }
                    }
                }
            });
            // let "function" here and not use =>
            this.modbusServer.on('readHoldingRegistersRequest', (start, quantity, unitId) => {
                const regs = this.#deviceOf(unitId)?.holdingRegs;
                if (!regs) {
                    return;
                }
                if (regs.changed ||
                    regs.lastEnd === undefined ||
                    regs.lastStart > start ||
                    regs.lastEnd < start + quantity) {
                    regs.lastStart = start;
                    regs.lastEnd = start + quantity;
                    regs.changed = false;
                    const data = this.modbusServer?.getHolding(unitId);
                    if (!data) {
                        return;
                    }
                    const end = start + quantity * 2;
                    const low = regs.addressLow * 2;
                    const high = regs.addressHigh * 2;
                    for (let i = start; i < end; i++) {
                        if (i >= data.length) {
                            break;
                        }
                        if (i >= low && i < high) {
                            data.writeUInt8(regs.values[i - low], i);
                        }
                        else {
                            data.writeUInt8(0, i);
                        }
                    }
                }
                if (this.options.config.notifyOnReadHoldingRegs) {
                    const wordStart = start >> 1;
                    for (let i = 0; i < quantity; i++) {
                        const a = wordStart + i - regs.addressLow;
                        if (a >= 0 && regs.mapping[a]) {
                            this.emitReadNotify(regs.mapping[a]);
                        }
                    }
                }
            });
            this.modbusServer.on('postWriteSingleCoilRequest', (start, value, unitId) => {
                const regs = this.#deviceOf(unitId)?.coils;
                if (!regs) {
                    return;
                }
                const a = start - regs.addressLow;
                if (a >= 0 && regs.mapping[a]) {
                    void this.adapter.setState(regs.mapping[a], value, this.writeAck, err => 
                    // analyse if the state could be set (because of permissions)
                    err && this.adapter.log.error(`Can not set state: ${err.message}`));
                    regs.values[a] = value;
                }
            });
            const mPow2 = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80];
            this.modbusServer.on('postWriteMultipleCoilsRequest', (start, length, _byteCount, unitId) => {
                const regs = this.#deviceOf(unitId)?.coils;
                if (!regs) {
                    return;
                }
                let i = 0;
                const data = this.modbusServer?.getCoils(unitId);
                if (!data) {
                    return;
                }
                if (start < regs.addressLow) {
                    start = regs.addressLow;
                }
                while (i < length && i + start < regs.addressHigh) {
                    const a = i + start - regs.addressLow;
                    if (a >= 0 && regs.mapping[a]) {
                        let value = data.readUInt8((i + start) >> 3);
                        value = value & mPow2[(i + start) % 8];
                        void this.adapter.setState(regs.mapping[a], !!value, this.writeAck, err => 
                        // analyse if the state could be set (because of permissions)
                        err && this.adapter.log.error(`Can not set state: ${err.message}`));
                        regs.values[a] = !!value;
                    }
                    i++;
                }
            });
            this.modbusServer.on('postWriteSingleRegisterRequest', (start, value, unitId) => {
                const regs = this.#deviceOf(unitId)?.holdingRegs;
                if (!regs) {
                    return;
                }
                start = start >> 1;
                const a = start - regs.addressLow;
                if (a >= 0 && regs.mapping[a]) {
                    const native = this.options.objects[regs.mapping[a]]?.native;
                    if (!native) {
                        return;
                    }
                    const buf = Buffer.alloc(2);
                    buf.writeUInt16BE(value);
                    try {
                        let val = (0, common_1.extractValue)(native.type, native.len, buf, 0);
                        if (!common_1.stringRegisterTypes.includes(native.type)) {
                            val = val * native.factor + native.offset;
                            val =
                                Math.round(val * this.options.config.round) / this.options.config.round;
                        }
                        void this.adapter.setState(regs.mapping[a], val, this.writeAck, err => 
                        // analyse if the state could be set (because of permissions)
                        err && this.adapter.log.error(`Can not set state: ${err.message}`));
                    }
                    catch (err) {
                        this.adapter.log.error(`Can not set value: ${err.message}`);
                    }
                    // regs.values is byte-indexed (see write() and postWriteMultipleRegistersRequest),
                    // so a register index `a` must be scaled by 2. Without the *2 an fc6 write to
                    // register `a` corrupts the bytes of register floor(a/2) instead (e.g. a write to
                    // the control register clobbered the middle bytes of a neighbouring int32).
                    regs.values[a * 2] = buf[0];
                    regs.values[a * 2 + 1] = buf[1];
                }
            });
            this.modbusServer.on('postWriteMultipleRegistersRequest', (start, length, _byteCount, unitId) => {
                const regs = this.#deviceOf(unitId)?.holdingRegs;
                if (!regs) {
                    return;
                }
                const data = this.modbusServer?.getHolding(unitId);
                let i = 0;
                start = start >> 1;
                if (start < regs.addressLow) {
                    start = regs.addressLow;
                }
                while (data && i < length && i + start < regs.addressHigh) {
                    const a = i + start - regs.addressLow;
                    if (a >= 0 && regs.mapping[a]) {
                        const obj = this.options.objects[regs.mapping[a]];
                        if (!obj?.native) {
                            continue;
                        }
                        const native = obj.native;
                        try {
                            let val = (0, common_1.extractValue)(native.type, native.len, data, i + start);
                            if (!common_1.stringRegisterTypes.includes(native.type)) {
                                val = val * native.factor + native.offset;
                                val =
                                    Math.round(val * this.options.config.round) /
                                        this.options.config.round;
                            }
                            void this.adapter.setState(regs.mapping[a], val, this.writeAck, err => 
                            // analyze if the state could be set (because of permissions)
                            err && this.adapter.log.error(`Can not set state: ${err.message}`));
                        }
                        catch (err) {
                            this.adapter.log.error(`Can not set value: ${err.message}`);
                        }
                        // Source bytes live at the absolute register position i + start (same offset
                        // extractValue reads above), not at the block start. Using start * 2 copied the
                        // first register's bytes into every subsequent mapped register of a multi-register
                        // fc16 write, so their read-back returned the first register's value.
                        for (let k = 0; k < native.len * 2; k++) {
                            regs.values[a * 2 + k] = data.readUInt8((i + start) * 2 + k);
                        }
                        i += native.len;
                    }
                    else {
                        i++;
                    }
                }
            });
            this.modbusServer
                .on('connection', async () => {
                if (this.modbusServer) {
                    const list = this.modbusServer.getClients();
                    const clientIds = list.map(e => e.trim().replace(/\./g, '_'));
                    const allStates = await this.adapter.getStatesAsync('info.clients.*');
                    const ids = Object.keys(allStates).map(e => e.split('.').pop());
                    for (let i = 0; i < clientIds.length; i++) {
                        if (ids.includes(clientIds[i])) {
                            await this.adapter.setStateAsync(`info.clients.${clientIds[i]}`, true, true);
                        }
                        else {
                            await this.adapter.setObjectAsync(`info.clients.${clientIds[i]}`, {
                                type: 'state',
                                common: {
                                    name: clientIds[i].replace(/_/g, '.'),
                                    type: 'boolean',
                                    role: 'indicator.reachable',
                                    read: true,
                                    write: false,
                                },
                                native: {
                                    ip: clientIds[i].replace(/_/g, '.'),
                                },
                            });
                            await this.adapter.setStateAsync(`info.clients.${clientIds[i]}`, true, true);
                        }
                    }
                    this.adapter.log.debug(`+ Clients connected: ${list.join(', ')}`);
                    void this.adapter.setState(this.connectionId, list.join(','), true);
                }
                else {
                    void this.adapter.setState(this.connectionId, '', true);
                }
            })
                .on('close', async () => {
                const list = this.modbusServer?.getClients();
                if (list) {
                    this.adapter.log.debug(`- Client connected: ${list.join(', ')}`);
                }
                const clientIds = list?.map(e => e.trim().replace(/\./g, '_')) || [];
                // read all other states and set alive to false
                const allStates = await this.adapter.getStatesAsync('info.clients.*');
                const allIds = Object.keys(allStates);
                for (const id of allIds) {
                    if (!clientIds.includes(id.split('.').pop())) {
                        await this.adapter.setStateAsync(id, false, true);
                    }
                }
                void this.adapter.setState(this.connectionId, list ? list.join(',') : '', true);
            })
                .on('error', async (err) => {
                const list = this.modbusServer?.getClients();
                if (list) {
                    this.adapter.log.info(`- Clients connected: ${list.join(', ')}`);
                }
                const clientIds = list?.map(e => e.trim().replace(/\./g, '_')) || [];
                // read all other states and set alive to false
                const allStates = await this.adapter.getStatesAsync('info.clients.*');
                const allIds = Object.keys(allStates);
                for (const id of allIds) {
                    if (!clientIds.includes(id.split('.').pop())) {
                        await this.adapter.setStateAsync(id, false, true);
                    }
                }
                void this.adapter.setState(this.connectionId, list ? list.join(',') : '', true);
                this.adapter.log.warn(`Error on connection: ${JSON.stringify(err)}`);
            });
        }
    }
    close(cb) {
        // The host releases the entries of a stopped instance by itself; this is for the case where
        // the slave is thrown away while the adapter keeps running, e.g. on a reconfiguration
        void (0, usedResources_1.freeUsedResource)(this.adapter, 'serialPort');
        void (0, usedResources_1.freeUsedResource)(this.adapter, 'tcpPort');
        if (this.modbusServer) {
            try {
                this.modbusServer.close(cb);
            }
            catch {
                // empty
            }
            this.modbusServer = null;
        }
    }
    #initValues(states, regs) {
        if (!states) {
            return;
        }
        // build ready arrays
        for (let i = 0; regs.fullIds.length > i; i++) {
            const id = regs.fullIds[i];
            if (states[id]?.val !== undefined) {
                this.write(id, states[id]).catch(e => this.adapter.log.error(`Cannot write state ${id}: ${e.message}`));
            }
            else {
                void this.adapter.setState(id, 0, true, err => {
                    // analyse if the state could be set (because of permissions)
                    if (err) {
                        this.adapter.log.error(`Can not set state ${id}: ${err.message}`);
                    }
                });
            }
        }
        // fill with 0 empty values
        for (let i = 0; i < regs.values.length; i++) {
            if (regs.values[i] === undefined || regs.values[i] === null) {
                regs.values[i] = 0;
            }
            else if (typeof regs.values[i] === 'boolean') {
                regs.values[i] = regs.values[i] ? 1 : 0;
            }
            else if (typeof regs.values[i] !== 'number') {
                regs.values[i] = parseInt(regs.values[i], 10) ? 1 : 0;
            }
        }
    }
    async initValues() {
        if (!this.deviceIds.length) {
            return;
        }
        // read all states
        const states = await this.adapter.getStatesAsync('*');
        for (const deviceId of this.deviceIds) {
            const device = this.devices[deviceId];
            this.#initValues(states, device.disInputs);
            this.#initValues(states, device.coils);
            this.#initValues(states, device.inputRegs);
            this.#initValues(states, device.holdingRegs);
        }
    }
}
exports.default = Slave;
//# sourceMappingURL=Slave.js.map