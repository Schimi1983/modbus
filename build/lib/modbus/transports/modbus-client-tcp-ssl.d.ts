import ModbusClientCore from '../modbus-client-core';
export default class ModbusClientTcpSsl extends ModbusClientCore {
    #private;
    private reqId;
    private currentRequestId;
    protected checkUnitId: boolean;
    private readonly ignoreTransactionId;
    private closedOnPurpose;
    private buffer;
    private socket;
    private tcp;
    private ssl;
    private unitId;
    constructor(options: {
        tcp: {
            host: string;
            port: number;
            protocolVersion?: number;
            autoReconnect?: boolean;
            reconnectTimeout?: number;
        };
        ssl: {
            rejectUnauthorized?: boolean;
            key: string;
            cert: string;
            ca?: string;
        };
        unitId?: number;
        /** Accept a response with any transaction ID, for devices that do not echo it (issue #829) */
        ignoreTransactionId?: boolean;
        /** A timeout fails only its request, the connection stays open (issue #832) */
        keepConnectionOnTimeout?: boolean;
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
