import { EventEmitter } from 'node:events';
/**
 * One line description of a request for log messages, e.g.
 * `FC16 write multiple registers, address 6609, quantity 1, unit 1`.
 *
 * Without it a timeout or a device exception only says THAT something failed, but not for which
 * register, function code or device - the first question of every analysis (issue #811).
 */
export declare function describeRequest(request: {
    fc: number;
    unitId: number;
    pdu: Buffer;
}): string;
/** Payload of the `trashCurrentRequest` event: why the pending request was dropped */
export interface TrashedRequestInfo {
    /** Reason, e.g. `timeout after 5000 ms` */
    reason: string;
    /** Request description, see {@link describeRequest} */
    request: string;
    fc: number;
    unitId: number;
    /** The expired request timeout in ms */
    timeout?: number;
    /**
     * Only with `keepConnectionOnTimeout`: the units that did not answer since the last response of any
     * unit, this one included. If every polled unit is in it, the connection itself is probably gone.
     */
    silentUnits?: number[];
}
export type ModbusReadResultBinary = {
    unitId: number;
    fc: number;
    byteCount: number;
    payload: Buffer;
    data: boolean[];
};
type ModbusReadResultNumber = {
    unitId: number;
    fc: number;
    byteCount: number;
    payload: Buffer;
    register: number[];
};
type ModbusWriteResultMultiple = {
    unitId: number;
    fc: number;
    startAddress: number;
    quantity: number;
};
type ModbusWriteResultSingleCoil = {
    unitId: number;
    fc: number;
    outputAddress: number;
    outputValue?: boolean;
};
type ModbusWriteResultSingleRegister = {
    unitId: number;
    fc: number;
    registerAddress: number;
    registerValue: number;
    registerAddressRaw: Buffer;
    registerValueRaw: Buffer;
};
type ModbusFcHandler = (error: {
    message: string;
    timeout?: number;
    errorCode?: number;
    exceptionCode?: number;
    /** Request description, see {@link describeRequest} */
    request?: string;
    /** The device returned less data than requested */
    incomplete?: boolean;
} | null, response?: ModbusReadResultBinary | ModbusReadResultNumber | ModbusWriteResultMultiple | ModbusWriteResultSingleCoil | ModbusWriteResultSingleRegister) => void;
/** Options of a single read request */
export interface ModbusRequestOptions {
    /** Timeout of this request in ms instead of the configured one */
    timeout?: number;
    /**
     * A probe, e.g. of the device detection, that may hit an address the device does not answer: a timeout fails
     * only this request. The connection stays open, no `requestTimeout` or `trashCurrentRequest` is emitted and
     * the unit is not counted as silent.
     */
    probe?: boolean;
}
type ModbusRequest = {
    timeout?: NodeJS.Timeout;
    cb: ModbusFcHandler;
    unitId: number;
    fc: number;
    pdu: Buffer;
    options?: ModbusRequestOptions;
};
type ModbusFcState = 'waiting' | 'init' | 'error' | 'ready' | 'connect' | 'closed';
export default abstract class ModbusClientCore extends EventEmitter {
    #private;
    protected readonly log: ioBroker.Logger;
    private readonly responseHandler;
    private currentRequest;
    private reqFifo;
    private readonly timeout;
    /** Optional per-device settings, keyed by unitId. `timeout` overrides `timeout` for that device (issue #605) */
    private readonly deviceTimeouts?;
    private currentState;
    /**
     * Drop responses from another unit. The MBAP transports (TCP, SSL, UDP) match the transaction ID
     * instead, as some TCP devices do not echo the unit ID.
     */
    protected checkUnitId: boolean;
    /**
     * A timeout fails only its request, the connection stays open (issue #832). Only safe where the
     * transaction ID drops a late answer to the timed out request (TCP, SSL, UDP).
     */
    private readonly keepConnectionOnTimeout;
    /** Units that timed out since the last response, see `TrashedRequestInfo.silentUnits` */
    private readonly silentUnits;
    protected constructor(options: {
        logger: ioBroker.Logger;
        timeout?: number;
        deviceTimeouts?: {
            [unitId: number]: {
                timeout?: number;
                waitTime?: number;
            };
        };
        /** A timeout fails only its request, the connection stays open. Only for TCP, SSL and UDP (issue #832) */
        keepConnectionOnTimeout?: boolean;
    });
    inState(state: ModbusFcState): boolean;
    getState(): ModbusFcState;
    setState(newState: ModbusFcState): void;
    flush: () => void;
    onClosed(): void;
    handleErrorPDU(pdu: Buffer, request: ModbusRequest): boolean;
    /**
     *  Handle the incoming data, cut out the packet and send the pdu to the listener
     */
    onData: (pdu: Buffer, unitId: number) => void;
    queueRequest: (unitId: number, fc: number, pdu: Buffer, cb: ModbusFcHandler, options?: ModbusRequestOptions) => void;
    abstract connect(): void;
    abstract reconnect(): void;
    abstract close(): void;
    readCoils: (unitId: number, start: number, quantity: number) => Promise<ModbusReadResultBinary>;
    readDiscreteInputs: (unitId: number, start: number, quantity: number) => Promise<ModbusReadResultBinary>;
    readHoldingRegisters: (unitId: number, start: number, quantity: number, options?: ModbusRequestOptions) => Promise<ModbusReadResultNumber>;
    readInputRegisters: (unitId: number, start: number, quantity: number, options?: ModbusRequestOptions) => Promise<ModbusReadResultNumber>;
    writeSingleCoil: (unitId: number, address: number, value: boolean | Buffer) => Promise<ModbusWriteResultSingleCoil>;
    writeSingleRegister: (unitId: number, address: number, value: Buffer | number) => Promise<ModbusWriteResultSingleRegister>;
    writeMultipleCoils: (unitId: number, startAddress: number, data: Buffer | number[], N?: number) => Promise<ModbusWriteResultMultiple>;
    writeMultipleRegisters: (unitId: number, startAddress: number, data: Buffer | number[]) => Promise<ModbusWriteResultMultiple>;
}
export {};
