import type { Register, RegisterType } from './types';
import { type BinaryLike } from 'node:crypto';
export declare function decrypt(cipherTextB64: string, password: BinaryLike): string;
export default function tsv2registers(type: RegisterType, fileNameOrText: string, password?: string): Register[];
