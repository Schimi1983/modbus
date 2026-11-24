import ModbusClientCore from '../modbus-client-core';
/**
 * Modbus/UDP master transport.
 *
 * Modbus/UDP uses the same MBAP header + PDU framing as Modbus/TCP (transaction id, protocol id,
 * length, unit id), but each request/response is carried in a single UDP datagram instead of a TCP
 * stream. That makes framing simpler (one datagram = one complete frame, no reassembly), but UDP is
 * connectionless and unreliable: a request to an offline device usually produces no socket error,
 * it just times out (handled by ModbusClientCore's per-request timeout).
 *
 * The class mirrors `ModbusClientTCP` so it plugs into the same core state machine: the socket
 * `close` event drives the state back to `closed`, and reconnection is left to the caller (Master).
 */
export default class ModbusClientUDP extends ModbusClientCore {
    #private;
    private reqId;
    private currentRequestId;
    protected checkUnitId: boolean;
    private readonly ignoreTransactionId;
    private closedOnPurpose;
    private socket;
    private udp;
    private unitId;
    constructor(options: {
        udp: {
            host?: string;
            port?: number;
            protocolVersion?: number;
            autoReconnect?: boolean;
            reconnectTimeout?: number;
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
