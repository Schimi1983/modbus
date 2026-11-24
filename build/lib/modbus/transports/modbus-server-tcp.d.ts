import ModbusServerCore, { type ModbusServerCoreOptions } from '../modbus-server-core';
export default class ModbusServerTcp extends ModbusServerCore {
    #private;
    private server;
    private socketCount;
    private fifo;
    private clients;
    private buffers;
    private tcp;
    constructor(options: ModbusServerCoreOptions & {
        tcp: {
            port?: number;
            hostname?: string;
        };
    });
    close(cb?: () => void): void;
    getClients(): string[];
}
