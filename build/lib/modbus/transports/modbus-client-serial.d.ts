import ModbusClientCore from '../modbus-client-core';
export default class ModbusClientSerial extends ModbusClientCore {
    #private;
    private buffer;
    private serialPort;
    private readonly unitId;
    private ready;
    private readonly serial;
    constructor(options: {
        serial: {
            portName: string;
            baudRate?: number;
            dataBits?: 5 | 6 | 7 | 8;
            stopBits?: 1 | 1.5 | 2;
            parity?: 'none' | 'even' | 'mark' | 'odd' | 'space';
        };
        unitId?: number;
        logger: ioBroker.Logger;
        timeout?: number;
        deviceTimeouts?: {
            [unitId: number]: {
                timeout?: number;
                waitTime?: number;
            };
        };
    });
    connect(): void;
    reconnect(): void;
    close(): void;
}
