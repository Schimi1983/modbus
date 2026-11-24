"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.tsv2registers = void 0;
const adapter_core_1 = require("@iobroker/adapter-core");
const node_path_1 = require("node:path");
const node_fs_1 = require("node:fs");
const convert_1 = __importDefault(require("./convert"));
exports.tsv2registers = convert_1.default;
const Master_1 = require("./lib/Master"); // Get common adapter utils
const Slave_1 = __importDefault(require("./lib/Slave")); // Get common adapter utils
const common_1 = require("./lib/common");
/** Characters that are forbidden in object IDs, the same as `FORBIDDEN_CHARS` of js-controller */
const FORBIDDEN_CHARS = /[^._\-/ :!#$%&()+=@^{}|~\p{Ll}\p{Lu}\p{Nd}]+/gu;
let serialPortList = null;
function sortByAddress(a, b) {
    const ad = parseFloat(a._address);
    const bd = parseFloat(b._address);
    return ad < bd ? -1 : ad > bd ? 1 : 0;
}
const defaultParams = {
    type: 'tcp',
    bind: '127.0.0.1',
    host: '127.0.0.1',
    port: 502,
    selectBy: 'port',
    comName: '',
    comDeviceId: '',
    baudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
    deviceId: 1,
    timeout: 5000,
    slave: 0,
    poll: 1000,
    recon: 60000,
    readRetryCount: 0,
    writeRetryCount: 0,
    retryInterval: 100,
    keepAliveInterval: 0,
    maxBlock: 100,
    maxBoolBlock: 128,
    maxGap: 10,
    multiDeviceId: false,
    pulseTime: 1000,
    waitTime: 50,
    disInputsOffset: 10001,
    coilsOffset: 1,
    inputRegsOffset: 30001,
    holdingRegsOffset: 40001,
    showAliases: true,
    directAddresses: false,
    doNotIncludeAdrInId: false,
    preserveDotsInId: false,
    round: 2,
    doNotRoundAddressToWord: false,
    doNotUseWriteMultipleRegisters: false,
    onlyUseWriteMultipleRegisters: false,
    writeInterval: 0,
    readInterval: 0,
    disableLogging: false,
    ignoreTransactionId: false,
    keepConnectionOnTimeout: false,
    sslEnabled: false,
    sslCertPath: '',
    sslKeyPath: '',
    sslCaPath: '',
    sslRejectUnauthorized: true,
};
// Extract from object the attribute by path
function getParam(obj, path) {
    const parts = path.split('/');
    for (let i = 0; i < parts.length; i++) {
        if (typeof obj[parts[i]] !== 'object') {
            return undefined;
        }
        obj = obj[parts[i]];
    }
    return obj;
}
/**
 * Modbus class
 *
 * @param adapterName Adapter name like "modbus-solaredge"
 * @param options Overload standard adapter options
 * @param params Connection and communications parameters
 * @param registersOrParameterName Configuration for registers or name of the attribute in the config with the TSV file name
 * @param adapterRootDirectory if registersOrParameterName is an attribute name, here is the adapter root directory
 */
class ModbusAdapter extends adapter_core_1.Adapter {
    infoRegExp;
    static _rmap = {
        0: 15,
        1: 14,
        2: 13,
        3: 12,
        4: 11,
        5: 10,
        6: 9,
        7: 8,
        8: 7,
        9: 6,
        10: 5,
        11: 4,
        12: 3,
        13: 2,
        14: 1,
        15: 0,
    };
    static _dmap = {
        0: 0,
        1: 1,
        2: 2,
        3: 3,
        4: 4,
        5: 5,
        6: 6,
        7: 7,
        8: 8,
        9: 9,
        10: 10,
        11: 11,
        12: 12,
        13: 13,
        14: 14,
        15: 15,
    };
    objects = {};
    enumObjs = {};
    static typeItemsLen = {
        uint8be: 1,
        uint8le: 1,
        int8be: 1,
        int8le: 1,
        signExtendedInt8be: 1,
        signExtendedInt8le: 1,
        uint16be: 1,
        uint16le: 1,
        int16be: 1,
        int16le: 1,
        int16be1: 1,
        int16le1: 1,
        uint32be: 2,
        uint32le: 2,
        uint32sw: 2,
        uint32sb: 2,
        int32be: 2,
        int32le: 2,
        int32sw: 2,
        int32sb: 2,
        uint64be: 4,
        uint64le: 4,
        int64be: 4,
        int64le: 4,
        int64bestr: 4,
        int64lestr: 4,
        uint64bestr: 4,
        uint64lestr: 4,
        floatbe: 2,
        floatle: 2,
        floatsw: 2,
        floatsb: 2,
        doublebe: 4,
        doublele: 4,
        string: 0,
        stringle: 0,
        string16: 0,
        string16le: 0,
        rawhex: 0,
    };
    modbus = null;
    /** In proxy mode the built-in TCP slave server runs alongside the master */
    proxySlave = null;
    constructor(adapterName, adapterOptions = {}, options) {
        super({
            ...adapterOptions,
            name: adapterName,
            ready: async () => {
                if (options?.onBeforeReady) {
                    const result = options.onBeforeReady(this);
                    if (result instanceof Promise) {
                        await result;
                    }
                }
                // Merge configuration
                this.config.params = {
                    ...defaultParams,
                    ...options?.params,
                    ...this.config.params,
                };
                this.config.coils ||= options?.coils || [];
                this.config.disInputs ||= options?.disInputs || [];
                this.config.inputRegs ||= options?.inputRegs || [];
                this.config.holdingRegs ||= options?.holdingRegs || [];
                // Read TSV from file
                if (typeof options?.parameterNameForFile === 'string') {
                    if (!options.adapterRootDirectory || typeof options.adapterRootDirectory !== 'string') {
                        throw new Error('adapterRootDirectory must be a directory');
                    }
                    // Try to read file
                    const fileName = getParam(this.config, options.parameterNameForFile);
                    if ((0, node_fs_1.existsSync)((0, node_path_1.join)(options.adapterRootDirectory, fileName))) {
                        // It is only one file, so apply to holdings register
                        const holdingRegs = (0, convert_1.default)('holdingRegs', (0, node_path_1.join)(options.adapterRootDirectory, fileName));
                        this.config.coils ||= [];
                        this.config.disInputs ||= [];
                        this.config.inputRegs ||= [];
                        this.config.holdingRegs = holdingRegs;
                    }
                    else if ((0, node_fs_1.existsSync)((0, node_path_1.join)(options.adapterRootDirectory, `${fileName}.tsv`))) {
                        // It is only one file, so apply to holdings register
                        const holdingRegs = (0, convert_1.default)('holdingRegs', (0, node_path_1.join)(options.adapterRootDirectory, `${fileName}.tsv`));
                        this.config.coils ||= [];
                        this.config.disInputs ||= [];
                        this.config.inputRegs ||= [];
                        this.config.holdingRegs = holdingRegs;
                    }
                    else if (options?.adapterRootDirectory) {
                        const [name, ext] = fileName.split('.');
                        if (ext &&
                            ['coils', 'disInputs', 'inputRegs', 'holdingRegs'].find(type => (0, node_fs_1.existsSync)((0, node_path_1.join)(options.adapterRootDirectory, `${name + type}.${ext}`)))) {
                            this.config.coils ||= [];
                            this.config.disInputs ||= [];
                            this.config.inputRegs ||= [];
                            this.config.holdingRegs ||= [];
                            // We have multiple definitions
                            ['coils', 'disInputs', 'inputRegs', 'holdingRegs'].forEach(type => {
                                if ((0, node_fs_1.existsSync)((0, node_path_1.join)(options.adapterRootDirectory, `${name + type}.${ext}`))) {
                                    this.config[type] ||=
                                        (0, convert_1.default)(type, (0, node_path_1.join)(options.adapterRootDirectory, `${name + type}.${ext}`));
                                }
                            });
                        }
                        else if (!ext &&
                            ['coils', 'disInputs', 'inputRegs', 'holdingRegs'].find(type => (0, node_fs_1.existsSync)((0, node_path_1.join)(options.adapterRootDirectory, `${name + type}.tsv`)))) {
                            this.config.coils ||= [];
                            this.config.disInputs ||= [];
                            this.config.inputRegs ||= [];
                            this.config.holdingRegs ||= [];
                            // We have multiple definitions
                            ['coils', 'disInputs', 'inputRegs', 'holdingRegs'].forEach(type => {
                                if ((0, node_fs_1.existsSync)((0, node_path_1.join)(options.adapterRootDirectory, `${name + type}.tsv`))) {
                                    this.config[type] ||=
                                        (0, convert_1.default)(type, (0, node_path_1.join)(options.adapterRootDirectory, `${name + type}.tsv`));
                                }
                            });
                        }
                        else {
                            throw new Error(`Cannot find TSV file from "${options.parameterNameForFile} => ${fileName}`);
                        }
                    }
                }
                this.main().catch(e => this.log.error(`Cannot start Modbus adapter: ${e}`));
            },
            message: (obj) => this.processMessage(obj),
            stateChange: async (id, state) => {
                if (state && !state.ack && id && !this.infoRegExp.test(id)) {
                    if (!this.modbus) {
                        this.log.warn('No connection');
                    }
                    else {
                        this.log.debug(`state Changed ack=false: ${id}: ${JSON.stringify(state)}`);
                        if (!this.objects[id]) {
                            const obj = await this.getObjectAsync(id);
                            if (obj) {
                                this.objects[id] = obj;
                            }
                        }
                        if (this.objects[id]) {
                            this.modbus?.write(id, state).catch(err => this.log.error(err));
                        }
                        else {
                            this.log.warn(`State ${id} not found`);
                        }
                    }
                }
            },
            unload: (callback) => this.stopAdapter(callback),
        });
        process.on('SIGINT', () => this.stopAdapter());
    }
    async processMessage(obj) {
        if (obj) {
            switch (obj.command) {
                case 'listUart':
                    if (obj.callback) {
                        if (!serialPortList) {
                            try {
                                const sModule = await import('serialport');
                                serialPortList = sModule.SerialPort.list;
                            }
                            catch (err) {
                                this.log.warn(`Serial is not available: ${err}`);
                            }
                        }
                        if (serialPortList) {
                            // read all found serial ports
                            serialPortList()
                                .then(ports => {
                                const result = this.listSerial(ports);
                                this.log.info(`List of port: ${JSON.stringify(result)}`);
                                this.sendTo(obj.from, obj.command, result, obj.callback);
                            })
                                .catch((err) => {
                                this.log.warn(`Can not get Serial port list: ${err}`);
                                this.sendTo(obj.from, obj.command, [{ label: 'Not available', value: 'Not available' }], obj.callback);
                            });
                        }
                        else {
                            this.log.warn('Module serialport is not available');
                            this.sendTo(obj.from, obj.command, [{ label: 'Not available', value: 'Not available' }], obj.callback);
                        }
                    }
                    break;
                case 'listUartDevices':
                    if (obj.callback) {
                        if (!serialPortList) {
                            try {
                                const sModule = await import('serialport');
                                serialPortList = sModule.SerialPort.list;
                            }
                            catch (err) {
                                this.log.warn(`Serial is not available: ${err}`);
                            }
                        }
                        if (serialPortList) {
                            // read all found serial ports and expose them by their stable USB ID
                            serialPortList()
                                .then(ports => {
                                const result = ModbusAdapter.listSerialDevices(ports);
                                this.log.info(`List of devices: ${JSON.stringify(result)}`);
                                this.sendTo(obj.from, obj.command, result, obj.callback);
                            })
                                .catch((err) => {
                                this.log.warn(`Can not get USB device list: ${err}`);
                                this.sendTo(obj.from, obj.command, [{ label: 'Not available', value: '' }], obj.callback);
                            });
                        }
                        else {
                            this.log.warn('Module serialport is not available');
                            this.sendTo(obj.from, obj.command, [{ label: 'Not available', value: '' }], obj.callback);
                        }
                    }
                    break;
            }
        }
    }
    stopAdapter(callback) {
        if (this.modbus) {
            this.modbus.close();
            this.modbus = null;
        }
        if (this.proxySlave) {
            this.proxySlave.close();
            this.proxySlave = null;
        }
        if (this.setState && this.config?.params) {
            void this.setState('info.connection', this.config.params.slave === '1' ? '' : false, true);
        }
        void this.getForeignStatesAsync(`${this.namespace}.info.clients.*`).then(async (allStates) => {
            for (const id in allStates) {
                if (allStates[id]?.val) {
                    await this.setStateAsync(id, false, true);
                }
            }
            if (typeof callback === 'function') {
                return void callback();
            }
            this.terminate ? this.terminate() : process.exit();
        });
    }
    static filterSerialPorts(path) {
        // get only serial port names
        if (!/(tty(S|ACM|ADM|USB|AMA|MFD|XR)|rfcomm)/.test(path)) {
            return false;
        }
        return (0, node_fs_1.statSync)(path).isCharacterDevice();
    }
    listSerial(ports) {
        ports ||= [];
        // Filter out the devices that aren't serial ports
        const devDirName = '/dev';
        let result;
        try {
            this.log.info(`Verify ${JSON.stringify(ports)}`);
            result = (0, node_fs_1.readdirSync)(devDirName)
                .map(file => (0, node_path_1.join)(devDirName, file))
                .filter(path => ModbusAdapter.filterSerialPorts(path))
                .map(port => {
                if (!ports.find(p => p.path === port)) {
                    ports.push({ path: port });
                }
                return { label: port, value: port };
            });
        }
        catch (e) {
            if (require('node:os').platform() !== 'win32') {
                this.log.error(`Cannot read "${devDirName}": ${e}`);
            }
            result = ports.map(port => ({ label: port.path, value: port.path }));
        }
        return result;
    }
    /**
     * Map each real serial device path (e.g. /dev/ttyUSB0) to its stable physical-USB-port name from
     * /dev/serial/by-path (Linux only). Unlike pnpId (derived from VID/PID, identical for identical
     * chips), by-path encodes the actual USB topology and differs per socket. Empty on other systems.
     */
    static getByPathMap() {
        const dir = '/dev/serial/by-path';
        const map = {};
        try {
            if (!(0, node_fs_1.existsSync)(dir)) {
                return map;
            }
            for (const name of (0, node_fs_1.readdirSync)(dir)) {
                try {
                    map[(0, node_fs_1.realpathSync)((0, node_path_1.join)(dir, name))] = name;
                }
                catch {
                    // ignore broken symlink
                }
            }
        }
        catch {
            // ignore (non-Linux or no permission)
        }
        return map;
    }
    /** Enrich serial ports with a stable physical-USB-port id (by-path) where available */
    static enrichPorts(ports) {
        const byPath = ModbusAdapter.getByPathMap();
        return (ports || []).map(port => ({ ...port, byPath: byPath[port.path] }));
    }
    /**
     * Build a stable, port-name-independent identifier for a USB serial device.
     * Prefers the programmed serial number (unique per chip, survives re-plugging into any port).
     * For identical chips without a unique serial number it falls back to the physical USB location:
     * on Linux pnpId comes from /dev/serial/by-id and is the SAME for identical chips, so by-path is
     * used there; on Windows pnpId encodes the physical port and is reliable. This binds to the USB
     * socket, so it stays stable only while the chip remains plugged into the same physical port.
     */
    static makeDeviceId(port) {
        const base = `${port.vendorId || ''}:${port.productId || ''}`;
        if (port.serialNumber) {
            return `${base}:${port.serialNumber}`;
        }
        const isPosix = port.path.startsWith('/dev/');
        const location = port.byPath || port.locationId || (isPosix ? port.path : port.pnpId) || port.path;
        return `${base}@${location}`;
    }
    /** Human-readable label for the USB device dropdown, including the physical USB location */
    static makeDeviceLabel(port) {
        const location = port.byPath || port.locationId || port.pnpId;
        return `${port.manufacturer || 'Unknown'} (VID:${port.vendorId || '-'} PID:${port.productId || '-'}${port.serialNumber ? ` SN:${port.serialNumber}` : ''}) [${port.path}]${location ? ` @ ${location}` : ''}`;
    }
    /**
     * Build the list of attached USB serial devices, addressed by their stable USB ID (serial number,
     * or the physical USB location for identical chips without one). Plain serial ports that are not USB
     * cannot be addressed this way and are skipped.
     */
    static listSerialDevices(ports) {
        const devices = ModbusAdapter.enrichPorts(ports)
            .filter(item => item.vendorId || item.pnpId?.toUpperCase().startsWith('USB'))
            .map(item => ({
            label: ModbusAdapter.makeDeviceLabel(item),
            value: ModbusAdapter.makeDeviceId(item),
        }));
        return devices.length ? devices : [{ label: 'No USB devices found', value: '' }];
    }
    /**
     * Resolve the configured USB device ID to the actual port path of the currently attached device,
     * so the OS may reassign the path (COMx / ttyUSBx) freely on reboot. Matches on the stable device
     * ID (serial number or physical USB location), and still understands legacy IDs that were stored
     * as `vendorId:productId:serialNumber`. Returns an empty string if no matching device is connected.
     */
    async resolveSerialPort(deviceId) {
        if (!deviceId) {
            return '';
        }
        if (!serialPortList) {
            try {
                const sModule = await import('serialport');
                serialPortList = sModule.SerialPort.list;
            }
            catch (err) {
                this.log.warn(`Serial is not available: ${err}`);
                return '';
            }
        }
        try {
            const ports = ModbusAdapter.enrichPorts(await serialPortList());
            // Preferred: exact match on the stable device ID (includes the physical USB location)
            let match = ports.find(item => ModbusAdapter.makeDeviceId(item) === deviceId);
            if (!match && !deviceId.includes('@')) {
                // Backward compatibility: legacy IDs stored as vendorId:productId:serialNumber
                const [vendorId, productId, serialNumber] = deviceId.split(':');
                match = ports.find(item => (item.vendorId || '').toLowerCase() === (vendorId || '').toLowerCase() &&
                    (item.productId || '').toLowerCase() === (productId || '').toLowerCase() &&
                    // serialNumber is not reported on every system; only match it when we have one
                    (!serialNumber || (item.serialNumber || '') === serialNumber));
            }
            if (match) {
                this.log.info(`Resolved USB device "${deviceId}" to port ${match.path}`);
                return match.path;
            }
            this.log.warn(`No connected serial port matches USB device "${deviceId}"`);
        }
        catch (err) {
            this.log.error(`Cannot list serial ports: ${err.message || err}`);
        }
        return '';
    }
    async addToEnum(enumName, id) {
        const obj = await this.getForeignObjectAsync(enumName);
        if (obj?.common?.members && !obj.common.members.includes(id)) {
            obj.common.members.push(id);
            obj.common.members.sort();
            await this.setForeignObjectAsync(obj._id, obj);
        }
    }
    async removeFromEnum(enumName, id) {
        const obj = await this.getForeignObjectAsync(enumName);
        if (obj?.common?.members) {
            const pos = obj.common.members.indexOf(id);
            if (pos !== -1) {
                obj.common.members.splice(pos, 1);
                await this.setForeignObjectAsync(obj._id, obj);
            }
        }
    }
    async syncEnums(enumGroup, id, newEnumName) {
        if (!this.enumObjs[enumGroup]) {
            const _enums = await this.getEnumAsync(enumGroup);
            if (_enums) {
                this.enumObjs[enumGroup] = _enums.result;
            }
            else {
                this.log.warn(`${enumGroup} does not exist`);
                return;
            }
        }
        // try to find this id in enums
        let found = false;
        for (const e in this.enumObjs[enumGroup]) {
            if (Object.prototype.hasOwnProperty.call(this.enumObjs[enumGroup], e) &&
                this.enumObjs[enumGroup][e].common?.members?.includes(id)) {
                if (this.enumObjs[enumGroup][e]._id !== newEnumName) {
                    await this.removeFromEnum(this.enumObjs[enumGroup][e]._id, id);
                }
                else {
                    found = true;
                }
            }
        }
        if (!found && newEnumName) {
            await this.addToEnum(newEnumName, id);
        }
    }
    static address2alias(id, address, isDirect, offset) {
        if (typeof address === 'string') {
            address = parseInt(address, 10);
        }
        if (id === 'disInputs' || id === 'coils') {
            address =
                ((address >> 4) << 4) +
                    (isDirect ? ModbusAdapter._dmap[address % 16] : ModbusAdapter._rmap[address % 16]);
            address += offset;
            return address;
        }
        return address + offset;
    }
    async createExtendObject(id, objData) {
        const oldObj = await this.getObjectAsync(id);
        if (oldObj) {
            await this.extendObjectAsync(id, objData);
        }
        else {
            await this.setObjectNotExistsAsync(id, objData);
        }
    }
    async processTasks(tasks) {
        if (!tasks?.length) {
            return;
        }
        for (const task of tasks) {
            try {
                if (task.name === 'add') {
                    await this.createExtendObject(task.id, task.obj);
                }
                else if (task.name === 'del') {
                    await this.delObjectAsync(task.id);
                }
                else if (task.name === 'syncEnums') {
                    await this.syncEnums('rooms', task.id, task.newName);
                }
                else {
                    this.log.error(`Unknown task: ${JSON.stringify(task)}`);
                }
            }
            catch (err) {
                this.log.info(`Can not execute task ${task.name} for ID ${task.id}: ${err.message}`);
            }
        }
    }
    async prepareConfig() {
        const params = this.config.params;
        const options = {
            config: {
                type: params.type || 'tcp',
                slave: params.slave === '1',
                alwaysUpdate: params.alwaysUpdate,
                round: parseInt(params.round, 10) || 0,
                timeout: parseInt(params.timeout, 10) || 5000,
                defaultDeviceId: params.deviceId === undefined || params.deviceId === null
                    ? 1
                    : parseInt(params.deviceId, 10) || 0,
                doNotIncludeAdrInId: params.doNotIncludeAdrInId === true || params.doNotIncludeAdrInId === 'true',
                preserveDotsInId: params.preserveDotsInId === true || params.preserveDotsInId === 'true',
                writeInterval: parseInt(params.writeInterval, 10) || 0,
                doNotUseWriteMultipleRegisters: params.doNotUseWriteMultipleRegisters === true || params.doNotUseWriteMultipleRegisters === 'true',
                onlyUseWriteMultipleRegisters: params.onlyUseWriteMultipleRegisters === true || params.onlyUseWriteMultipleRegisters === 'true',
            },
            devices: {},
            objects: this.objects,
        };
        options.config.round = Math.pow(10, options.config.round);
        if (!options.config.slave) {
            options.config.multiDeviceId = params.multiDeviceId === true || params.multiDeviceId === 'true';
            // Per-device settings (issue #605): { [deviceId]: { timeout?, waitTime? } }
            const rawTimeouts = this.config.deviceTimeouts;
            if (rawTimeouts && typeof rawTimeouts === 'object') {
                const map = {};
                for (const key of Object.keys(rawTimeouts)) {
                    const id = parseInt(key, 10);
                    if (isNaN(id)) {
                        continue;
                    }
                    const entry = rawTimeouts[key];
                    const timeout = parseInt(entry?.timeout, 10);
                    const waitTime = parseInt(entry?.waitTime, 10);
                    const parsed = {};
                    if (!isNaN(timeout) && timeout > 0) {
                        parsed.timeout = timeout;
                    }
                    if (!isNaN(waitTime) && waitTime >= 0) {
                        parsed.waitTime = waitTime;
                    }
                    if (parsed.timeout !== undefined || parsed.waitTime !== undefined) {
                        map[id] = parsed;
                    }
                }
                if (Object.keys(map).length) {
                    options.config.deviceTimeouts = map;
                }
            }
        }
        // Proxy mode: a master that additionally serves its polled data as a Modbus TCP slave
        options.config.proxy = !options.config.slave && (params.proxy === true || params.proxy === 'true');
        const deviceIds = [];
        this.checkDeviceIds(options, this.config.disInputs, deviceIds);
        this.checkDeviceIds(options, this.config.coils, deviceIds);
        this.checkDeviceIds(options, this.config.inputRegs, deviceIds);
        this.checkDeviceIds(options, this.config.holdingRegs, deviceIds);
        deviceIds.sort((a, b) => a - b);
        // settings for master
        if (!options.config.slave) {
            options.config.poll = parseInt(params.poll, 10) || 1000; // default is 1 second
            options.config.recon = parseInt(params.recon, 10) || 60000;
            if (options.config.recon < 1000) {
                this.log.info(`Slave Reconnect time set to 1000ms because was too small (${options.config.recon})`);
                options.config.recon = 1000;
            }
            // Number of times a failed block read / write is re-attempted before giving up. Clamped to 0..3 (the admin
            // allows 0..3): with the default 5 s timeout an unbounded count would stall the polling cycle for far too
            // long on a silent device (issue #432). Unset/invalid falls back to 0 (no retries - legacy behaviour).
            const readRetryCount = parseInt(params.readRetryCount, 10);
            options.config.readRetryCount = isNaN(readRetryCount) ? 0 : Math.max(0, Math.min(3, readRetryCount));
            const writeRetryCount = parseInt(params.writeRetryCount, 10);
            options.config.writeRetryCount = isNaN(writeRetryCount) ? 0 : Math.max(0, Math.min(3, writeRetryCount));
            // Delay before each retry resend (ms). Unset/invalid falls back to 100; clamped to >= 0.
            const retryInterval = parseInt(params.retryInterval, 10);
            options.config.retryInterval = isNaN(retryInterval) ? 100 : Math.max(0, retryInterval);
            options.config.maxBlock = parseInt(params.maxBlock, 10) || 100;
            options.config.maxBoolBlock = parseInt(params.maxBoolBlock, 10) || 128;
            // Max address gap (in registers/bits) that may be bridged when merging registers into one
            // read request. 0 = never bridge a gap (read only contiguous configured registers). Default 10.
            options.config.maxGap =
                params.maxGap === undefined || params.maxGap === null || params.maxGap === ''
                    ? 10
                    : parseInt(params.maxGap, 10);
            if (isNaN(options.config.maxGap) || options.config.maxGap < 0) {
                options.config.maxGap = 10;
            }
            options.config.pulseTime = parseInt(params.pulseTime) || 1000;
            options.config.waitTime = params.waitTime === undefined ? 50 : parseInt(params.waitTime, 10) || 0;
            options.config.readInterval = parseInt(params.readInterval, 10) || 0;
            options.config.keepAliveInterval = parseInt(params.keepAliveInterval, 10) || 0;
        }
        options.config.disableLogging = params.disableLogging;
        options.config.enableSanitization = !!params.enableSanitization;
        options.config.keepConnectionOnTimeout =
            params.keepConnectionOnTimeout === true || params.keepConnectionOnTimeout === 'true';
        options.config.ignoreTransactionId =
            params.ignoreTransactionId === true || params.ignoreTransactionId === 'true';
        if (options.config.slave) {
            options.config.notifyOnReadExpire = parseInt(params.notifyOnReadExpire, 10) || 0;
            options.config.notifyOnReadCoils = !!params.notifyOnReadCoils;
            options.config.notifyOnReadDisInputs = !!params.notifyOnReadDisInputs;
            options.config.notifyOnReadInputRegs = !!params.notifyOnReadInputRegs;
            options.config.notifyOnReadHoldingRegs = !!params.notifyOnReadHoldingRegs;
        }
        if (params.type === 'tcp' || params.type === 'udp' || params.type === 'tcprtu' || params.type === 'tcp-ssl') {
            options.config.tcp = {
                port: parseInt(params.port, 10) || 502,
                ip: params.slave === '1' ? params.bind : params.host,
            };
            // Add SSL configuration for tcp-ssl type
            if (params.type === 'tcp-ssl') {
                try {
                    const [certificates] = await this.getCertificatesAsync(this.config.params.certPublic, this.config.params.certPrivate, this.config.params.certChained);
                    options.config.ssl = {
                        rejectUnauthorized: !params.sslAllowSelfSigned,
                        key: certificates.key,
                        cert: certificates.cert,
                        ca: certificates.ca,
                    };
                }
                catch (err) {
                    this.log.error(`Cannot get certificates: ${err}`);
                }
            }
        }
        else {
            // When the device is selected by its stable USB ID, resolve it to the current port path
            const comName = params.selectBy === 'device' && params.comDeviceId
                ? await this.resolveSerialPort(params.comDeviceId)
                : params.comName;
            options.config.serial = {
                comName,
                baudRate: parseInt(params.baudRate, 10),
                dataBits: parseInt(params.dataBits, 10),
                stopBits: parseInt(params.stopBits, 10),
                parity: params.parity,
            };
        }
        // In proxy mode the built-in slave listens on its own TCP endpoint (independent of the master transport)
        if (options.config.proxy) {
            options.config.proxyTcp = {
                port: parseInt(params.proxyPort, 10) || 502,
                ip: params.proxyBind || '0.0.0.0',
            };
        }
        for (let d = 0; d < deviceIds.length; d++) {
            const deviceId = deviceIds[d];
            if (options.config.slave) {
                options.devices[deviceId] = {
                    disInputs: {
                        fullIds: [],
                        changed: true,
                        addressLow: 0,
                        addressHigh: 0,
                        length: 0,
                        config: [],
                        values: [],
                        mapping: {},
                        offset: parseInt(params.disInputsOffset, 10),
                    },
                    coils: {
                        fullIds: [],
                        changed: true,
                        addressLow: 0,
                        addressHigh: 0,
                        length: 0,
                        config: [],
                        values: [],
                        mapping: {},
                        offset: parseInt(params.coilsOffset, 10),
                    },
                    inputRegs: {
                        fullIds: [],
                        config: [],
                        changed: true,
                        addressLow: 0,
                        addressHigh: 0,
                        length: 0,
                        values: [],
                        mapping: {},
                        offset: parseInt(params.inputRegsOffset, 10),
                    },
                    holdingRegs: {
                        fullIds: [],
                        config: [],
                        changed: true,
                        addressLow: 0,
                        addressHigh: 0,
                        length: 0,
                        values: [],
                        mapping: {},
                        offset: parseInt(params.holdingRegsOffset, 10),
                    },
                };
            }
            else {
                options.devices[deviceId] = {
                    disInputs: {
                        fullIds: [],
                        deviceId,
                        addressLow: 0,
                        addressHigh: 0,
                        length: 0,
                        config: [],
                        blocks: [],
                        offset: parseInt(params.disInputsOffset, 10),
                    },
                    coils: {
                        fullIds: [],
                        deviceId,
                        addressLow: 0,
                        addressHigh: 0,
                        length: 0,
                        config: [],
                        blocks: [],
                        cyclicWrite: [], // only holdingRegs and coils
                        offset: parseInt(params.coilsOffset, 10),
                    },
                    inputRegs: {
                        fullIds: [],
                        deviceId,
                        addressLow: 0,
                        addressHigh: 0,
                        length: 0,
                        config: [],
                        blocks: [],
                        offset: parseInt(params.inputRegsOffset, 10),
                    },
                    holdingRegs: {
                        fullIds: [],
                        deviceId,
                        addressLow: 0,
                        addressHigh: 0,
                        length: 0,
                        config: [],
                        blocks: [],
                        cyclicWrite: [], // only holdingRegs and coils
                        offset: parseInt(params.holdingRegsOffset, 10),
                    },
                };
            }
            if (options.config.proxy) {
                // Proxy: augment the master-shaped device with the slave serving buffer (values/mapping/changed)
                const dev = options.devices[deviceId];
                ['disInputs', 'coils', 'inputRegs', 'holdingRegs'].forEach(rt => {
                    dev[rt].changed = true;
                    dev[rt].values = [];
                    dev[rt].mapping = {};
                });
            }
        }
        return options;
    }
    checkDeviceIds(options, config, deviceIds) {
        for (let i = config.length - 1; i >= 0; i--) {
            config[i].deviceId = !options.config.multiDeviceId
                ? options.config.defaultDeviceId
                : config[i].deviceId !== undefined
                    ? parseInt(config[i].deviceId, 10)
                    : options.config.defaultDeviceId;
            if (isNaN(config[i].deviceId)) {
                config[i].deviceId = options.config.defaultDeviceId;
            }
            if (!deviceIds.includes(config[i].deviceId)) {
                deviceIds.push(config[i].deviceId);
            }
        }
    }
    checkObjects(regType, regName, regFullName, tasks, newObjects, deviceId) {
        const regs = this.config[regType];
        this.log.debug(`Initialize Objects for ${regType}: ${JSON.stringify(regs)}`);
        for (let i = 0; regs.length > i; i++) {
            if (regs[i].deviceId !== deviceId) {
                continue;
            }
            const id = `${this.namespace}.${regs[i].id || i}`;
            regs[i].fullId = id;
            this.objects[id] = {
                _id: regs[i].id,
                type: 'state',
                common: {
                    name: regs[i].description || '',
                    role: regs[i].role || '',
                    type: regType === 'coils' || regType === 'disInputs'
                        ? 'boolean'
                        : common_1.stringRegisterTypes.includes(regs[i].type)
                            ? 'string'
                            : 'number',
                    read: true,
                    write: this.config.params.slave === '1' || regType === 'coils' || regType === 'holdingRegs',
                    def: regType === 'coils' || regType === 'disInputs'
                        ? false
                        : common_1.stringRegisterTypes.includes(regs[i].type)
                            ? ''
                            : 0,
                },
                native: {
                    regType: regType,
                    address: regs[i].address,
                    deviceId: regs[i].deviceId,
                },
            };
            if (this.objects[id]) {
                if (regType === 'coils') {
                    this.objects[id].native.poll = regs[i].poll;
                    this.objects[id].common.read = !!regs[i].poll;
                    this.objects[id].native.wp = !!regs[i].wp;
                }
                else if (regType === 'inputRegs' || regType === 'holdingRegs') {
                    this.objects[id].common.unit = regs[i].unit || '';
                    this.objects[id].native.type = regs[i].type;
                    this.objects[id].native.len = regs[i].len;
                    this.objects[id].native.offset = regs[i].offset;
                    this.objects[id].native.factor = regs[i].factor;
                    if (regType === 'holdingRegs') {
                        this.objects[id].native.poll = regs[i].poll;
                        this.objects[id].common.read = !!regs[i].poll;
                    }
                }
            }
            if (!regs[i].id) {
                this.log.error(`Invalid data ${regName}/${i}: ${JSON.stringify(regs[i])}`);
                this.log.error(`Invalid object: ${JSON.stringify(this.objects[id])}`);
            }
            tasks.push({
                id: regs[i].id,
                name: 'add',
                obj: this.objects[id],
            });
            tasks.push({
                id,
                name: 'syncEnums',
                newName: regs[i].room || '',
            });
            newObjects.push(id);
            this.log.debug(`Add ${regs[i].id}: ${JSON.stringify(this.objects[id])}`);
        }
        if (regs.length) {
            tasks.push({
                id: regName,
                name: 'add',
                obj: {
                    type: 'channel',
                    common: {
                        name: regFullName,
                    },
                    native: {},
                },
            });
        }
    }
    checkReadNotifyObjects(regType, regName, regFullName, tasks, newObjects, deviceId) {
        const regs = this.config[regType];
        let count = 0;
        for (const reg of regs) {
            if (reg.deviceId !== deviceId) {
                continue;
            }
            const notifyId = `readNotify.${reg.id}`;
            tasks.push({
                id: notifyId,
                name: 'add',
                obj: {
                    type: 'state',
                    common: {
                        name: reg.description || reg.id,
                        role: 'state',
                        type: 'number',
                        read: true,
                        write: false,
                        def: 0,
                    },
                    native: {},
                },
            });
            newObjects.push(`${this.namespace}.${notifyId}`);
            count++;
        }
        if (count) {
            tasks.push({
                id: `readNotify.${regName}`,
                name: 'add',
                obj: {
                    type: 'channel',
                    common: { name: `Read notify: ${regFullName}` },
                    native: {},
                },
            });
            newObjects.push(`${this.namespace}.readNotify.${regName}`);
        }
        return count > 0;
    }
    assignIds(deviceId, config, result, regName, regType, localOptions) {
        // A fixed width, as a Modbus address has at most 5 digits (65535). A width derived from the configured
        // registers would rename all IDs of a table - and delete the old objects - as soon as a longer address is added
        const addressInId = (address) => localOptions.padAddressInId ? String(address).padStart(5, '0') : address;
        for (let i = config.length - 1; i >= 0; i--) {
            if (config[i].deviceId !== deviceId) {
                continue;
            }
            // Characters that are forbidden in an object ID, e.g. the dash "–" of a copied data sheet: the
            // object was created under another ID than the state was written to (modbus-templates issue #58)
            const name = config[i].name ? config[i].name.replace(FORBIDDEN_CHARS, '_') : config[i].name;
            if (config[i].address === undefined && config[i]._address !== undefined) {
                if (localOptions.showAliases) {
                    if (config[i]._address >= result.offset) {
                        config[i].address = config[i]._address - result.offset;
                        if (localOptions.directAddresses && (regType === 'disInputs' || regType === 'coils')) {
                            const address = config[i].address;
                            config[i].address = ((address >> 4) << 4) + ModbusAdapter._dmap[address % 16];
                        }
                    }
                }
                else {
                    config[i].address = config[i]._address;
                }
            }
            config[i].address = parseInt(config[i].address, 10);
            const address = config[i].address;
            if (address < 0) {
                continue;
            }
            if (localOptions.registerTypeInName) {
                if (localOptions.registerTypeInName === true) {
                    if (localOptions.multiDeviceId) {
                        config[i].id = `${deviceId}.`;
                    }
                    else {
                        config[i].id = '';
                    }
                }
                else {
                    if (localOptions.multiDeviceId) {
                        config[i].id = `${localOptions.registerTypeInName}.${deviceId}.`;
                    }
                    else {
                        config[i].id = `${localOptions.registerTypeInName}.`;
                    }
                }
            }
            else {
                if (localOptions.multiDeviceId) {
                    config[i].id = `${regName}.${deviceId}.`;
                }
                else {
                    config[i].id = `${regName}.`;
                }
            }
            if (localOptions.showAliases) {
                config[i].id += addressInId(ModbusAdapter.address2alias(regType, address, localOptions.directAddresses, result.offset));
            }
            else if (!localOptions.doNotIncludeAdrInId || !config[i].name) {
                // add address if not disabled or name not empty
                config[i].id += addressInId(address);
                if (localOptions.preserveDotsInId) {
                    config[i].id += '_';
                }
            }
            if (localOptions.preserveDotsInId) {
                // preserve dots in name and add to ID
                config[i].id += name ? name.replace(/\s/g, '_') : '';
            }
            else {
                // replace dots by underlines and add to ID
                if (localOptions.doNotIncludeAdrInId) {
                    // It must be so, because of the bug https://github.com/ioBroker/ioBroker.modbus/issues/473
                    // config[i].id += name ? name.replace(/\./g, '_').replace(/\s/g, '_') : '';
                    // But because of breaking change
                    if (localOptions.removeUnderscorePrefix) {
                        config[i].id += name?.replace(/\./g, '_').replace(/\s/g, '_') || '';
                    }
                    else {
                        config[i].id += name ? `_${name.replace(/\./g, '_').replace(/\s/g, '_')}` : '';
                    }
                }
                else {
                    if (localOptions.removeUnderscorePrefix) {
                        config[i].id += name?.replace(/\./g, '_').replace(/\s/g, '_') || '';
                    }
                    else {
                        config[i].id += name ? `_${name.replace(/\./g, '_').replace(/\s/g, '_')}` : '';
                    }
                }
            }
            if (config[i].id.endsWith('.')) {
                config[i].id = config[i].id.substring(0, config[i].id.length - 1);
            }
        }
    }
    // localOptions = {
    //      multiDeviceId
    //      showAliases
    //      doNotRoundAddressToWord
    //      directAddresses
    //      isSlave
    //      maxBlock
    //      maxBoolBlock
    // };
    iterateAddresses(isBools, deviceId, result, regName, regType, localOptions) {
        const config = result.config;
        if (config?.length) {
            result.addressLow = 0xffffffff;
            result.addressHigh = 0;
            for (let i = config.length - 1; i >= 0; i--) {
                if (config[i].deviceId !== deviceId) {
                    continue;
                }
                config[i].address = parseInt(config[i].address, 10);
                const address = config[i].address;
                if (address < 0) {
                    this.log.error(`Invalid ${regName} address: ${address}`);
                    config.splice(i, 1);
                    continue;
                }
                if (!isBools) {
                    config[i].type ||= 'uint16be';
                    let offset = config[i].offset;
                    if (typeof offset === 'string') {
                        offset = offset.replace(',', '.');
                        config[i].offset = parseFloat(offset) || 0;
                    }
                    else if (typeof offset !== 'number') {
                        config[i].offset = 0;
                    }
                    else {
                        config[i].offset = offset || 0;
                    }
                    const factor = config[i].factor;
                    if (typeof factor === 'string') {
                        const factorStr = factor.replace(',', '.');
                        config[i].factor = parseFloat(factorStr) || 1;
                    }
                    else if (typeof factor !== 'number') {
                        config[i].factor = 1;
                    }
                    else {
                        config[i].factor = factor || 1;
                    }
                    // Only variable-length string types take a user-defined length; the fixed-length
                    // *str 64-bit types fall through to typeItemsLen (4 registers) like their numeric peers.
                    if (common_1.variableLengthStringTypes.includes(config[i].type)) {
                        config[i].len = parseInt(config[i].len, 10) || 1;
                    }
                    else {
                        config[i].len = ModbusAdapter.typeItemsLen[config[i].type];
                    }
                    config[i].len ||= 1;
                }
                else {
                    config[i].len = 1;
                }
                // collect cyclic write registers
                if (config[i].cw && Array.isArray(result.cyclicWrite)) {
                    result.cyclicWrite.push(`${this.namespace}.${config[i].id}`);
                }
                // Only include polled registers in address range and block calculations
                if (config[i].poll || regType === 'disInputs' || regType === 'inputRegs') {
                    if (address < result.addressLow) {
                        result.addressLow = address;
                    }
                    if (address + config[i].len > result.addressHigh) {
                        result.addressHigh = address + config[i].len;
                    }
                }
            }
            const maxBlock = isBools ? localOptions.maxBoolBlock : localOptions.maxBlock;
            // Max address gap (in registers/bits) that may be bridged when merging registers into one
            // read request. 0 = never bridge a gap, so only contiguous configured registers are combined.
            const maxGap = localOptions.maxGap ?? 10;
            let lastAddress = null;
            let startIndex = 0;
            let blockStart = 0;
            let lastPolledIndex = 0;
            let i;
            for (i = 0; i < config.length; i++) {
                if (config[i].deviceId !== deviceId ||
                    (!config[i].poll && (regType === 'coils' || regType === 'holdingRegs'))) {
                    continue;
                }
                if (lastAddress === null) {
                    startIndex = i;
                    blockStart = config[i].address;
                    lastAddress = blockStart + config[i].len;
                }
                // try to detect the next block
                if (result.blocks) {
                    const blocks = result.blocks;
                    const wouldExceedLimit = config[i].address + config[i].len - blockStart > maxBlock;
                    // Start a new block when the gap to the previous register exceeds maxGap - also before a
                    // long register (e.g. a string): bridging the gap would read registers that are not configured
                    // and may not exist on the device. With maxGap === 0 only contiguous registers are read
                    // together (issue #581).
                    const hasAddressGap = config[i].address - lastAddress > maxGap;
                    if (hasAddressGap || wouldExceedLimit) {
                        if (!blocks.map(obj => obj.start).includes(blockStart)) {
                            blocks.push({
                                start: blockStart,
                                count: lastAddress - blockStart,
                                startIndex: startIndex,
                                endIndex: lastPolledIndex + 1,
                            });
                        }
                        blockStart = config[i].address;
                        startIndex = i;
                    }
                }
                lastAddress = config[i].address + config[i].len;
                lastPolledIndex = i;
            }
            if (lastAddress &&
                lastAddress - blockStart &&
                result.blocks &&
                !result.blocks.map(obj => obj.start).includes(blockStart)) {
                result.blocks.push({
                    start: blockStart,
                    count: lastAddress - blockStart,
                    startIndex: startIndex,
                    endIndex: lastPolledIndex + 1,
                });
            }
            if (config.length) {
                result.length = result.addressHigh - result.addressLow;
                if (isBools && !localOptions.doNotRoundAddressToWord) {
                    const oldStart = result.addressLow;
                    // align addresses to 16 bit. E.g. 30 => 16, 31 => 16, 32 => 32
                    result.addressLow = (result.addressLow >> 4) << 4;
                    // increase the length on the alignment if any
                    result.length += oldStart - result.addressLow;
                    // If the length is not a multiple of 16
                    if (result.length % 16) {
                        // then round it up to the next multiple of 16
                        result.length = ((result.length >> 4) + 1) << 4;
                    }
                    if (result.blocks) {
                        const blocks = result.blocks;
                        for (let b = 0; b < blocks.length; b++) {
                            const _oldStart = blocks[b].start;
                            // align addresses to 16 bit. E.g 30 => 16, 31 => 16, 32 => 32
                            blocks[b].start = (blocks[b].start >> 4) << 4;
                            // increase the length on the alignment if any
                            blocks[b].count += _oldStart - blocks[b].start;
                            if (blocks[b].count % 16) {
                                blocks[b].count = ((blocks[b].count >> 4) + 1) << 4;
                            }
                        }
                    }
                }
            }
            else {
                result.length = 0;
            }
            if (result.mapping) {
                for (let i = 0; i < config.length; i++) {
                    this.log.debug(`Iterate ${regType} ${regName}: ${config[i].address - result.addressLow} = ${config[i].id}`);
                    result.mapping[config[i].address - result.addressLow] =
                        `${this.namespace}.${config[i].id}`;
                }
            }
        }
    }
    async parseConfig() {
        const options = await this.prepareConfig();
        const params = this.config.params;
        // not for master or slave
        const localOptions = {
            multiDeviceId: options.config.multiDeviceId,
            showAliases: params.showAliases === true || params.showAliases === 'true',
            doNotRoundAddressToWord: params.doNotRoundAddressToWord === true || params.doNotRoundAddressToWord === 'true',
            directAddresses: params.directAddresses === true || params.directAddresses === 'true',
            maxBlock: options.config.maxBlock,
            maxBoolBlock: options.config.maxBoolBlock,
            maxGap: options.config.maxGap,
            doNotIncludeAdrInId: params.doNotIncludeAdrInId === true || params.doNotIncludeAdrInId === 'true',
            preserveDotsInId: params.preserveDotsInId === true || params.preserveDotsInId === 'true',
            removeUnderscorePrefix: params.removeUnderscorePrefix === true || params.removeUnderscorePrefix === 'true',
            registerTypeInName: params.registerTypeInName === 'true' ? true : params.registerTypeInName || false,
            padAddressInId: params.padAddressInId === true || params.padAddressInId === 'true',
        };
        const oldObjects = await this.getForeignObjects(`${this.namespace}.*`);
        const newObjects = [];
        this.config.disInputs.sort(sortByAddress);
        this.config.coils.sort(sortByAddress);
        this.config.inputRegs.sort(sortByAddress);
        this.config.holdingRegs.sort(sortByAddress);
        const tasks = [];
        for (const _deviceId in options.devices) {
            if (!Object.prototype.hasOwnProperty.call(options.devices, _deviceId)) {
                continue;
            }
            const device = options.devices[_deviceId];
            const deviceId = parseInt(_deviceId, 10);
            // Discrete inputs
            this.assignIds(deviceId, this.config.disInputs, device.disInputs, 'discreteInputs', 'disInputs', localOptions);
            this.assignIds(deviceId, this.config.coils, device.coils, 'coils', 'coils', localOptions);
            this.assignIds(deviceId, this.config.inputRegs, device.inputRegs, 'inputRegisters', 'inputRegs', localOptions);
            this.assignIds(deviceId, this.config.holdingRegs, device.holdingRegs, 'holdingRegisters', 'holdingRegs', localOptions);
            device.disInputs.config = this.config.disInputs.filter(e => e.deviceId === deviceId);
            device.coils.config = this.config.coils.filter(e => e.poll && e.deviceId === deviceId);
            device.inputRegs.config = this.config.inputRegs.filter(e => e.deviceId === deviceId);
            device.holdingRegs.config = this.config.holdingRegs.filter(e => (e.poll || e.cw) && e.deviceId === deviceId);
            // ----------- remember poll values --------------------------
            if (!options.config.slave) {
                tasks.push({
                    id: 'info.pollTime',
                    name: 'add',
                    obj: {
                        type: 'state',
                        common: {
                            name: 'Poll time',
                            type: 'number',
                            role: '',
                            write: false,
                            read: true,
                            def: 0,
                            unit: 'ms',
                        },
                        native: {},
                    },
                });
                newObjects.push(`${this.namespace}.info.pollTime`);
            }
            // Discrete inputs
            this.iterateAddresses(true, deviceId, device.disInputs, 'discreteInputs', 'disInputs', localOptions);
            this.iterateAddresses(true, deviceId, device.coils, 'coils', 'coils', localOptions);
            this.iterateAddresses(false, deviceId, device.inputRegs, 'inputRegisters', 'inputRegs', localOptions);
            this.iterateAddresses(false, deviceId, device.holdingRegs, 'holdingRegisters', 'holdingRegs', localOptions);
            // ------------- create states and objects ----------------------------
            this.checkObjects('disInputs', 'discreteInputs', 'Discrete inputs', tasks, newObjects, deviceId);
            this.checkObjects('coils', 'coils', 'Coils', tasks, newObjects, deviceId);
            this.checkObjects('inputRegs', 'inputRegisters', 'Input registers', tasks, newObjects, deviceId);
            this.checkObjects('holdingRegs', 'holdingRegisters', 'Holding registers', tasks, newObjects, deviceId);
            if (options.config.slave || options.config.proxy) {
                device.disInputs.fullIds = this.config.disInputs
                    .filter(e => e.deviceId === deviceId)
                    .map(e => e.fullId);
                device.coils.fullIds = this.config.coils
                    .filter(e => e.deviceId === deviceId)
                    .map(e => e.fullId);
                device.inputRegs.fullIds = this.config.inputRegs
                    .filter(e => e.deviceId === deviceId)
                    .map(e => e.fullId);
                device.holdingRegs.fullIds = this.config.holdingRegs
                    .filter(e => e.deviceId === deviceId)
                    .map(e => e.fullId);
                let hasReadNotify = false;
                if (options.config.notifyOnReadDisInputs) {
                    hasReadNotify =
                        this.checkReadNotifyObjects('disInputs', 'discreteInputs', 'Discrete inputs', tasks, newObjects, deviceId) || hasReadNotify;
                }
                if (options.config.notifyOnReadCoils) {
                    hasReadNotify =
                        this.checkReadNotifyObjects('coils', 'coils', 'Coils', tasks, newObjects, deviceId) ||
                            hasReadNotify;
                }
                if (options.config.notifyOnReadInputRegs) {
                    hasReadNotify =
                        this.checkReadNotifyObjects('inputRegs', 'inputRegisters', 'Input registers', tasks, newObjects, deviceId) || hasReadNotify;
                }
                if (options.config.notifyOnReadHoldingRegs) {
                    hasReadNotify =
                        this.checkReadNotifyObjects('holdingRegs', 'holdingRegisters', 'Holding registers', tasks, newObjects, deviceId) || hasReadNotify;
                }
                if (hasReadNotify) {
                    tasks.push({
                        id: 'readNotify',
                        name: 'add',
                        obj: {
                            type: 'folder',
                            common: { name: 'Read notify' },
                            native: {},
                        },
                    });
                    newObjects.push(`${this.namespace}.readNotify`);
                }
            }
            if (!options.config.multiDeviceId) {
                break;
            }
        }
        tasks.push({
            id: 'info',
            name: 'add',
            obj: {
                type: 'channel',
                common: {
                    name: 'info',
                },
                native: {},
            },
        });
        // create/ update 'info.connection' object
        let obj = await this.getObjectAsync('info.connection');
        if (!obj) {
            obj = {
                type: 'state',
                common: {
                    name: options.config.slave ? 'IPs of connected partners' : 'If connected to slave',
                    role: 'indicator.connected',
                    write: false,
                    read: true,
                    type: options.config.slave ? 'string' : 'boolean',
                    def: options.config.slave ? '' : false,
                },
                native: {},
            };
            await this.setObjectAsync('info.connection', obj);
        }
        else if (options.config.slave && obj.common.type !== 'string') {
            obj.common.type = 'string';
            obj.common.name = 'Connected masters';
            obj.common.def = '';
            await this.setObjectAsync('info.connection', obj);
        }
        else if (!options.config.slave && obj.common.type !== 'boolean') {
            obj.common.type = 'boolean';
            obj.common.name = 'If connected to slave';
            obj.common.def = false;
            await this.setObjectAsync('info.connection', obj);
        }
        await this.setStateAsync('info.connection', this.config.params.slave === '1' ? '' : false, true);
        newObjects.push(`${this.namespace}.info.connection`);
        // In proxy mode create a separate connection state for the built-in slave server (list of connected masters)
        if (options.config.proxy) {
            const slaveConnObj = await this.getObjectAsync('info.connectionSlave');
            if (!slaveConnObj) {
                await this.setObjectAsync('info.connectionSlave', {
                    type: 'state',
                    common: {
                        name: 'Connected masters (proxy slave server)',
                        role: 'indicator.connected',
                        write: false,
                        read: true,
                        type: 'string',
                        def: '',
                    },
                    native: {},
                });
            }
            await this.setStateAsync('info.connectionSlave', '', true);
            newObjects.push(`${this.namespace}.info.connectionSlave`);
        }
        if (options.config.slave) {
            if (!(await this.getObjectAsync('info.adapterStarts'))) {
                await this.setObjectAsync('info.adapterStarts', {
                    type: 'state',
                    common: {
                        name: 'Adapter start count',
                        role: 'state',
                        type: 'number',
                        read: true,
                        write: true,
                        def: 0,
                    },
                    native: {},
                });
            }
            const startsState = await this.getStateAsync('info.adapterStarts');
            await this.setStateAsync('info.adapterStarts', (startsState?.val || 0) + 1, true);
            newObjects.push(`${this.namespace}.info.adapterStarts`);
        }
        // clear unused states
        for (const id_ in oldObjects) {
            if (Object.prototype.hasOwnProperty.call(oldObjects, id_) &&
                !newObjects.includes(id_) &&
                !id_.startsWith(`${this.namespace}.info.clients.`)) {
                this.log.debug(`Remove old object ${id_}`);
                tasks.push({
                    id: id_,
                    name: 'del',
                });
            }
        }
        await this.processTasks(tasks);
        this.subscribeStates('*');
        return options;
    }
    async main() {
        this.infoRegExp = new RegExp(`${this.namespace.replace('.', '\\.')}\\.info\\.`);
        const options = await this.parseConfig();
        if (options.config.proxy) {
            // Proxy: run the master (polls the device) and a built-in TCP slave (serves the data) together
            const master = new Master_1.Master(options, this);
            const slave = new Slave_1.default(options, this);
            // Bridge: every polled value is mirrored into the slave's served buffer
            master.onUpdate = (fullId, val) => {
                if (this.objects[fullId]) {
                    void slave.write(fullId, { val }).catch(err => this.log.error(`Proxy bridge: ${err}`));
                }
            };
            this.modbus = master;
            this.proxySlave = slave;
            master.start();
            slave.start();
        }
        else if (options.config.slave) {
            this.modbus = new Slave_1.default(options, this);
            this.modbus.start();
        }
        else {
            this.modbus = new Master_1.Master(options, this);
            this.modbus.start();
        }
    }
}
exports.default = ModbusAdapter;
//# sourceMappingURL=index.js.map