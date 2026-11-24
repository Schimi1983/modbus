/** A serial port occupied by an instance */
export interface UsedSerialPort {
    /** Path or name of the port as it is opened, e.g. `/dev/ttyUSB0`, a `/dev/serial/by-id/...` link or `COM3` */
    port: string;
    /** Baud rate the port is opened with */
    baudRate?: number;
}
/** A TCP port occupied by an instance */
export interface UsedTcpPort {
    /** TCP port number */
    port: number;
    /** Address the socket is bound to, `0.0.0.0` or `::` for every interface */
    bind?: string;
    /** Address family, only reported for a concrete bind address */
    family?: 4 | 6;
}
/** The resource types this library can occupy, with the payload the registry wants for each */
interface UsedResourceDataMap {
    serialPort: UsedSerialPort;
    tcpPort: UsedTcpPort;
}
/** Kind of an exclusive resource */
export type UsedResourceType = keyof UsedResourceDataMap;
/** One entry of the registry, as `checkUsedResource` returns it */
export interface RegisteredResource<T extends UsedResourceType = UsedResourceType> {
    /** Instance that occupies the resource, e.g. `modbus.1` */
    instance: string;
    /** Whether that instance is running and really holds it now */
    isBlocked: boolean;
    /** What it holds */
    data: UsedResourceDataMap[T];
}
/**
 * Report a resource as occupied by this instance.
 *
 * Registering is additive, one call per resource - a proxy that serves TCP while it talks to a
 * serial device reports both. The host drops what this instance registered before whenever it
 * starts, so a stale registration of a previous configuration cannot survive a restart.
 *
 * @param adapter the ioBroker adapter
 * @param type the kind of resource
 * @param data what is occupied
 * @returns whether the host accepted the registration
 */
export declare function registerUsedResource<T extends UsedResourceType>(adapter: ioBroker.Adapter, type: T, data: UsedResourceDataMap[T]): Promise<boolean>;
/**
 * Take previously reported resources back.
 *
 * `data` is a filter and not the exact payload: every field it names has to match, fields it leaves
 * out are ignored - so omitting it frees every resource of that type. Freeing on shutdown is not
 * needed, the host marks the entries of a stopped instance as no longer held by itself.
 *
 * @param adapter the ioBroker adapter
 * @param type the kind of resource
 * @param data the fields identifying what to free; everything of this type without it
 * @returns whether the host accepted the request
 */
export declare function freeUsedResource<T extends UsedResourceType>(adapter: ioBroker.Adapter, type: T, data?: Partial<UsedResourceDataMap[T]>): Promise<boolean>;
/**
 * Say in the log which other instance holds a resource this adapter is about to open.
 *
 * Asked before opening it: afterwards the operating system has already decided the conflict, and all
 * this could do is improve the wording of the error. The answer is a hint and not a permission - the
 * registry knows what adapters declare, so an empty result does not promise the resource is free,
 * and a program outside ioBroker holding it is not in the registry at all.
 *
 * @param adapter the ioBroker adapter
 * @param type the kind of resource
 * @param data what is about to be opened
 * @param what which part of the adapter wants it, for the log line
 */
export declare function reportResourceConflict<T extends UsedResourceType>(adapter: ioBroker.Adapter, type: T, data: Partial<UsedResourceDataMap[T]>, what: string): Promise<RegisteredResource<T>[]>;
/**
 * What a listening server occupies, as the registry wants it.
 *
 * @param address what `server.address()` returned
 */
export declare function listeningPort(address: unknown): UsedTcpPort | undefined;
export {};
