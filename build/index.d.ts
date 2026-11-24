import { Adapter, type AdapterOptions } from '@iobroker/adapter-core';
import type * as Modbus from './types';
import type { PortInfo } from '@serialport/bindings-interface';
import tsv2registers from './convert';
import { Master } from './lib/Master';
import Slave from './lib/Slave';
/** A serial PortInfo enriched with a stable physical-USB-port identifier (from /dev/serial/by-path, Linux only) */
type PortInfoExt = PortInfo & {
    byPath?: string;
};
export { tsv2registers, type Modbus };
/**
 * Modbus class
 *
 * @param adapterName Adapter name like "modbus-solaredge"
 * @param options Overload standard adapter options
 * @param params Connection and communications parameters
 * @param registersOrParameterName Configuration for registers or name of the attribute in the config with the TSV file name
 * @param adapterRootDirectory if registersOrParameterName is an attribute name, here is the adapter root directory
 */
export default class ModbusAdapter extends Adapter {
    config: Modbus.ModbusAdapterConfig;
    private infoRegExp;
    static readonly _rmap: {
        [bit: number]: number;
    };
    static readonly _dmap: {
        [bit: number]: number;
    };
    private objects;
    private enumObjs;
    static readonly typeItemsLen: {
        [type: string]: number;
    };
    modbus: Master | Slave | null;
    /** In proxy mode the built-in TCP slave server runs alongside the master */
    private proxySlave;
    constructor(adapterName: string, adapterOptions?: Partial<AdapterOptions>, options?: {
        params?: Modbus.ModbusParameters;
        disInputs?: Modbus.Register[];
        coils?: Modbus.Register[];
        inputRegs?: Modbus.Register[];
        holdingRegs?: Modbus.Register[];
        parameterNameForFile?: string;
        adapterRootDirectory?: string;
        onBeforeReady?: (adapter: ModbusAdapter) => Promise<void> | void;
    });
    processMessage(obj: ioBroker.Message): Promise<void>;
    stopAdapter(callback?: () => void): void;
    static filterSerialPorts(path: string): boolean;
    listSerial(ports: PortInfo[]): {
        label: string;
        value: string;
    }[] | undefined;
    /**
     * Map each real serial device path (e.g. /dev/ttyUSB0) to its stable physical-USB-port name from
     * /dev/serial/by-path (Linux only). Unlike pnpId (derived from VID/PID, identical for identical
     * chips), by-path encodes the actual USB topology and differs per socket. Empty on other systems.
     */
    static getByPathMap(): Record<string, string>;
    /** Enrich serial ports with a stable physical-USB-port id (by-path) where available */
    static enrichPorts(ports: PortInfo[]): PortInfoExt[];
    /**
     * Build a stable, port-name-independent identifier for a USB serial device.
     * Prefers the programmed serial number (unique per chip, survives re-plugging into any port).
     * For identical chips without a unique serial number it falls back to the physical USB location:
     * on Linux pnpId comes from /dev/serial/by-id and is the SAME for identical chips, so by-path is
     * used there; on Windows pnpId encodes the physical port and is reliable. This binds to the USB
     * socket, so it stays stable only while the chip remains plugged into the same physical port.
     */
    static makeDeviceId(port: PortInfoExt): string;
    /** Human-readable label for the USB device dropdown, including the physical USB location */
    static makeDeviceLabel(port: PortInfoExt): string;
    /**
     * Build the list of attached USB serial devices, addressed by their stable USB ID (serial number,
     * or the physical USB location for identical chips without one). Plain serial ports that are not USB
     * cannot be addressed this way and are skipped.
     */
    static listSerialDevices(ports: PortInfo[]): {
        label: string;
        value: string;
    }[];
    /**
     * Resolve the configured USB device ID to the actual port path of the currently attached device,
     * so the OS may reassign the path (COMx / ttyUSBx) freely on reboot. Matches on the stable device
     * ID (serial number or physical USB location), and still understands legacy IDs that were stored
     * as `vendorId:productId:serialNumber`. Returns an empty string if no matching device is connected.
     */
    resolveSerialPort(deviceId: string): Promise<string>;
    addToEnum(enumName: string, id: string): Promise<void>;
    removeFromEnum(enumName: string, id: string): Promise<void>;
    syncEnums(enumGroup: 'rooms', id: string, newEnumName: string): Promise<void>;
    static address2alias(id: Modbus.RegisterType, address: number | string, isDirect: boolean, offset: number): number;
    createExtendObject(id: string, objData: ioBroker.StateObject | ioBroker.ChannelObject | ioBroker.FolderObject): Promise<void>;
    processTasks(tasks: ({
        name: 'add';
        id: string;
        obj: ioBroker.StateObject | ioBroker.ChannelObject | ioBroker.FolderObject;
    } | {
        name: 'del';
        id: string;
    } | {
        name: 'syncEnums';
        id: string;
        newName: string;
    })[]): Promise<void>;
    prepareConfig(): Promise<Modbus.Options>;
    checkDeviceIds(options: Modbus.Options, config: Modbus.Register[], deviceIds: number[]): void;
    checkObjects(regType: Modbus.RegisterType, regName: string, regFullName: string, tasks: ({
        name: 'add';
        id: string;
        obj: ioBroker.StateObject | ioBroker.ChannelObject | ioBroker.FolderObject;
    } | {
        name: 'del';
        id: string;
    } | {
        name: 'syncEnums';
        id: string;
        newName: string;
    })[], newObjects: string[], deviceId: number): void;
    checkReadNotifyObjects(regType: Modbus.RegisterType, regName: string, regFullName: string, tasks: ({
        name: 'add';
        id: string;
        obj: ioBroker.StateObject | ioBroker.ChannelObject | ioBroker.FolderObject;
    } | {
        name: 'del';
        id: string;
    } | {
        name: 'syncEnums';
        id: string;
        newName: string;
    })[], newObjects: string[], deviceId: number): boolean;
    assignIds(deviceId: number, config: Modbus.RegisterInternal[], result: Modbus.DeviceSlaveOption | Modbus.DeviceMasterOption, regName: string, regType: Modbus.RegisterType, localOptions: {
        multiDeviceId?: boolean;
        showAliases: boolean;
        doNotRoundAddressToWord: boolean;
        directAddresses: boolean;
        maxBlock?: number;
        maxBoolBlock?: number;
        doNotIncludeAdrInId: boolean;
        removeUnderscorePrefix: boolean;
        preserveDotsInId: boolean;
        registerTypeInName: boolean | string;
        padAddressInId?: boolean;
    }): void;
    iterateAddresses(isBools: boolean, deviceId: number, result: Modbus.DeviceSlaveOption | Modbus.DeviceMasterOption, regName: string, regType: Modbus.RegisterType, localOptions: {
        multiDeviceId?: boolean;
        showAliases: boolean;
        doNotRoundAddressToWord: boolean;
        directAddresses: boolean;
        maxBlock?: number;
        maxBoolBlock?: number;
        maxGap?: number;
        doNotIncludeAdrInId: boolean;
        preserveDotsInId: boolean;
    }): void;
    parseConfig(): Promise<Modbus.Options>;
    main(): Promise<void>;
}
