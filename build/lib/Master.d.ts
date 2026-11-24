import type { Options } from '../types';
export declare class Master {
    #private;
    private readonly modbusClient;
    private connected;
    private connectTimer;
    private nextPoll;
    private pollTime?;
    private errorCount;
    private readonly ackObjects;
    private readonly objects;
    private isStop;
    /**
     * Number of operations (block reads / writes) currently being retried. While > 0 the auto-poll that a retry
     * reconnect would otherwise start is suppressed, so only the operation(s) under retry are re-sent and no
     * competing polling cycle starts (avoids two overlapping cycles, cf. issue #595). A counter rather than a
     * boolean because reads and writes retry independently and can overlap: one finishing must not clear the flag
     * while another is still running.
     */
    private activeRetries;
    /**
     * True while the underlying connection is known to be dead (a disconnect/close/error event fired) and a
     * reconnect has not yet re-established it. Drives the "reconnect only when needed" decision in the retry
     * logic: a pure timeout leaves this false, so retries cheaply resend on the same socket; only an actually-
     * dropped session triggers a reconnect. Reset to false by the `connect` handler.
     */
    private sessionDead;
    /**
     * A reconnect was requested by an event handler (timeout, socket error, no device answers) while a retry
     * sequence was running. The retry reconnects before its next attempt; if no retry is left, the reconnect is
     * done when the last sequence ends. Without this, e.g. a serial client stays in the `error` state after a
     * timeout and every following request would wait in its queue forever.
     */
    private reconnectRequested;
    /**
     * With keepConnectionOnTimeout: no polled device answered during a retry sequence. The retry still resends on
     * the open socket, but if its last attempt fails too, the connection is re-established afterwards.
     */
    private silentDuringRetry;
    /** Number of running polling cycles, so a reconnect during a retry restarts the polling only if none runs */
    private pollsRunning;
    private pulseList;
    private sendBuffer;
    /** True while #send() works off the sendBuffer, so only one write is on the way at a time */
    private sending;
    /** When the last write was done, to keep "Write interval" also between writes that come one by one */
    private lastWrite;
    private readonly devices;
    private readonly deviceIds;
    private reconnectTimeout;
    private keepAliveTimeout;
    private readonly adapter;
    private readonly options;
    private scaleFactors;
    private lastValidValues;
    /**
     * The serial port this master holds while it is connected. Only serial occupies something on
     * this host - over TCP, UDP or SSL the endpoint belongs to the device on the other side.
     */
    private usedSerialPort;
    /**
     * A timeout fails only its request, the connection stays open (issue #832). Only over TCP, SSL and
     * UDP with the transaction ID checked: there a late answer to the timed out request is dropped.
     */
    private readonly keepConnectionOnTimeout;
    private readonly showDebug;
    /** Optional bridge callback (proxy mode): invoked after each polled value is written to its state */
    onUpdate?: (fullId: string, val: ioBroker.StateValue) => void;
    constructor(options: Options, adapter: ioBroker.Adapter);
    write(id: string, state: ioBroker.State): Promise<void>;
    start(): void;
    close(): void;
}
