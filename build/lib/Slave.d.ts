import type { Options } from '../types';
export default class Slave {
    #private;
    private readonly objects;
    /** All served devices, keyed by their Modbus unit/device ID (issue #813) */
    private readonly devices;
    private readonly deviceIds;
    /** Unit used for requests with a neutral unit ID (0/255) and for states without a device ID */
    private readonly defaultDeviceId;
    private delayStart;
    private modbusServer;
    private adapter;
    private options;
    private readonly connectionId;
    /**
     * ack flag for states written by connected TCP masters:
     * `true` in slave mode (the slave is authoritative), `false` in proxy mode
     * (a client write is a command that is forwarded to the real device via the master).
     */
    private readonly writeAck;
    private readonly readNotifyCounters;
    constructor(options: Options, adapter: ioBroker.Adapter);
    write(id: string, state: Partial<ioBroker.State>): Promise<void>;
    private emitReadNotify;
    start(): void;
    close(cb?: () => void): void;
    initValues(): Promise<void>;
}
