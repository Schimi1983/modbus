import type { RegisterEntryType } from '../types';
/**
 * Register types whose value is carried as a text string at the ioBroker state boundary and is
 * therefore never scaled with factor/offset/round. Includes the variable-length string types and
 * the fixed-length 64-bit integer types rendered as decimal strings (int64*str/uint64*str), which
 * preserve the full 64-bit range beyond 2^53.
 */
export declare const stringRegisterTypes: RegisterEntryType[];
/**
 * Subset of {@link stringRegisterTypes} whose length is user-defined (variable). The *str types are
 * excluded here because they occupy a fixed 4 registers (8 bytes) like their numeric counterparts.
 */
export declare const variableLengthStringTypes: RegisterEntryType[];
/**
 * Readable one line form of the errors that travel through the Modbus stack.
 *
 * `JSON.stringify` was used for them, which prints `{}` for an `Error` instance and left the adapter
 * log with messages like `Error: undefined` (issue #811). Handles `Error`s, the plain objects of the
 * request callbacks (`message`/`exceptionCode`/`timeout`/`request`) and socket errors (`code`).
 */
export declare function formatError(err: unknown): string;
export declare function extractValue(type: RegisterEntryType, len: number, buffer: Buffer, offset: number): string | number;
export declare function writeValue(type: RegisterEntryType, value: number | string, len?: number): Buffer;
