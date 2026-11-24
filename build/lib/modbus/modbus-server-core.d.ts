import { EventEmitter } from 'node:events';
type ModbusFcState = 'init' | 'ready' | 'processing';
/** Register buffers of one Modbus unit (= slave/device ID) */
export interface ModbusUnitBuffers {
    coils?: Buffer;
    holding?: Buffer;
    input?: Buffer;
    discrete?: Buffer;
}
export interface ModbusServerCoreOptions extends ModbusUnitBuffers {
    logger: ioBroker.Logger;
    timeout?: number;
    responseDelay?: number;
    /**
     * Register buffers per unit ID (issue #813). Takes precedence over the flat
     * `coils`/`holding`/`input`/`discrete` options, which serve one single unit.
     */
    units?: {
        [unitId: number]: ModbusUnitBuffers;
    };
    /** Unit served for requests with a neutral unit ID (0 or 255). Default: the lowest configured one */
    defaultUnitId?: number;
}
export default class ModbusServerCore extends EventEmitter {
    #private;
    readonly log: ioBroker.Logger;
    /** Register buffers per unit ID: a slave/proxy may serve several device IDs at once (issue #813) */
    private readonly data;
    private readonly unitIds;
    private readonly defaultUnitId;
    private readonly handler;
    private currentState;
    constructor(options: ModbusServerCoreOptions);
    inState(state: ModbusFcState): boolean;
    getState(): ModbusFcState;
    setState(newState: ModbusFcState): void;
    onData: (pdu: Buffer, callback: (response: Buffer) => void, unitId?: number) => void;
    /**
     * Map the unit ID of an incoming request to a served one.
     *
     * A server with only one unit answers every unit ID, because many Modbus TCP clients send 0 or 255
     * instead of the real one. As soon as several units are served, the request is routed by its unit ID;
     * 0 (broadcast) and 255 ("unused") then fall back to the default unit. `undefined` means: not served.
     */
    resolveUnitId: (unitId?: number) => number | undefined;
    /** Unit IDs served by this server */
    getUnitIds: () => number[];
    getCoils: (unitId?: number) => Buffer;
    getInput: (unitId?: number) => Buffer;
    getHolding: (unitId?: number) => Buffer;
    getDiscrete: (unitId?: number) => Buffer;
    onReadCoils: (pdu: Buffer, cb: (pdu: Buffer, response?: (result: Buffer) => void) => void, unitId?: number) => void;
    onReadDiscreteInputs: (pdu: Buffer, cb: (pdu: Buffer, response?: (result: Buffer) => void) => void, unitId?: number) => void;
    onReadHoldingRegisters: (pdu: Buffer, cb: (pdu: Buffer, response?: (result: Buffer) => void) => void, unitId?: number) => void;
    onReadInputRegisters: (pdu: Buffer, cb: (pdu: Buffer, response?: (result: Buffer) => void) => void, unitId?: number) => void;
    onWriteSingleCoil: (pdu: Buffer, cb: (pdu: Buffer, response?: (result: Buffer) => void) => void, unitId?: number) => void;
    onWriteSingleRegister: (pdu: Buffer, cb: (pdu: Buffer, response?: (result: Buffer) => void) => void, unitId?: number) => void;
    onWriteMultipleCoils: (pdu: Buffer, cb: (pdu: Buffer, response?: (result: Buffer) => void) => void, unitId?: number) => void;
    onWriteMultipleRegisters: (pdu: Buffer, cb: (pdu: Buffer, response?: (result: Buffer) => void) => void, unitId?: number) => void;
}
export {};
