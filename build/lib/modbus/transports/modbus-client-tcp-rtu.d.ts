import ModbusClientCore from '../modbus-client-core';
export default class ModbusClientTcpRtu extends ModbusClientCore {
    #private;
    private closedOnPurpose;
    private buffer;
    private socket;
    private tcp;
    private readonly unitId;
    constructor(options: {
        tcp: {
            host?: string;
            port?: number;
            protocolVersion?: number;
            autoReconnect?: boolean;
            reconnectTimeout?: number;
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
