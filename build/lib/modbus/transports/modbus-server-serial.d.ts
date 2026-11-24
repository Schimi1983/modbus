import ModbusServerCore, { type ModbusServerCoreOptions } from '../modbus-server-core';
export default class ModbusServerSerial extends ModbusServerCore {
    #private;
    private buffer;
    private fifo;
    private serialPort;
    private readonly deviceId;
    /** All addresses this server answers to (issue #813); defaults to `[deviceId]` */
    private readonly deviceIds;
    private serial;
    constructor(options: ModbusServerCoreOptions & {
        serial: {
            portName: string;
            baudRate?: number;
            dataBits?: 5 | 6 | 7 | 8;
            stopBits?: 1 | 2;
            parity?: 'none' | 'even' | 'mark' | 'odd' | 'space';
        };
        deviceId?: number;
        deviceIds?: number[];
    });
    getExpectedFrameLength: (functionCode: number, buffer: Buffer) => number;
    close(cb?: (err?: Error | null) => void): void;
    getClients(): string[];
}
