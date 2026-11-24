"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decrypt = decrypt;
exports.default = tsv2registers;
const tsv_json_1 = require("tsv-json");
const node_fs_1 = require("node:fs");
const node_crypto_1 = require("node:crypto");
const ALGO = 'aes-256-gcm';
const KEY_LEN = 32; // 256 Bit
const IV_LEN = 12; // GCM suggest 12 Byte
const coils = [
    { name: '_address' },
    { name: 'name' },
    { name: 'description' },
    { name: 'formula' },
    { name: 'role' },
    { name: 'room' },
    { name: 'poll', type: 'checkbox' },
    { name: 'wp', type: 'checkbox' },
    { name: 'cw', type: 'checkbox' },
    { name: 'isScale', type: 'checkbox' },
];
const disInputs = [
    { name: '_address' },
    { name: 'name' },
    { name: 'description' },
    { name: 'formula' },
    { name: 'role' },
    { name: 'room' },
    { name: 'cw', type: 'checkbox' },
    { name: 'isScale', type: 'checkbox' },
];
const holdingRegs = [
    { name: '_address' },
    { name: 'name' },
    { name: 'description' },
    { name: 'unit' },
    { name: 'type' },
    { name: 'len' },
    { name: 'factor' },
    { name: 'offset' },
    { name: 'formula' },
    { name: 'role' },
    { name: 'room' },
    { name: 'poll', type: 'checkbox' },
    { name: 'wp', type: 'checkbox' },
    { name: 'cw', type: 'checkbox' },
    { name: 'isScale', type: 'checkbox' },
];
const inputRegs = [
    { name: '_address' },
    { name: 'name' },
    { name: 'description' },
    { name: 'unit' },
    { name: 'type' },
    { name: 'len' },
    { name: 'factor' },
    { name: 'offset' },
    { name: 'formula' },
    { name: 'role' },
    { name: 'room' },
    { name: 'cw', type: 'checkbox' },
    { name: 'isScale', type: 'checkbox' },
];
const regTypes = {
    coils,
    disInputs,
    holdingRegs,
    inputRegs,
};
function decrypt(cipherTextB64, password) {
    const data = Buffer.from(cipherTextB64, 'base64');
    if (typeof password === 'string' && password.length !== 32) {
        password = Buffer.from(password, 'base64');
    }
    const salt = data.subarray(0, 16);
    const iv = data.subarray(16, 16 + IV_LEN);
    const authTag = data.subarray(16 + IV_LEN, 16 + IV_LEN + 16);
    const encrypted = data.subarray(16 + IV_LEN + 16);
    const key = (0, node_crypto_1.scryptSync)(password, salt, KEY_LEN);
    const decipher = (0, node_crypto_1.createDecipheriv)(ALGO, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
}
function tsv2registers(type, fileNameOrText, password) {
    if (fileNameOrText.toLowerCase().endsWith('.tsv')) {
        if ((0, node_fs_1.existsSync)(fileNameOrText)) {
            fileNameOrText = (0, node_fs_1.readFileSync)(fileNameOrText).toString();
        }
        else {
            throw new Error(`File name ${fileNameOrText} not found`);
        }
    }
    else if (fileNameOrText.toLowerCase().endsWith('.tsv.enc')) {
        if ((0, node_fs_1.existsSync)(fileNameOrText)) {
            fileNameOrText = (0, node_fs_1.readFileSync)(fileNameOrText).toString();
            fileNameOrText = decrypt(fileNameOrText, password || '');
        }
        else {
            throw new Error(`File name ${fileNameOrText} not found`);
        }
    }
    const propsFields = regTypes[type];
    if (!propsFields) {
        throw new Error('Unknown register type');
    }
    const data = (0, tsv_json_1.tsv2json)(fileNameOrText.endsWith('\n') ? fileNameOrText : `${fileNameOrText}\n`);
    const fields = data.shift();
    if (fields) {
        for (const field of fields) {
            if (!propsFields.find(it => it.name === field)) {
                throw new Error(`Unexpected field ${field}`);
            }
        }
    }
    else {
        throw new Error('No fields found');
    }
    return data.map(itemValues => {
        const item = {};
        for (let f = 0; f < itemValues.length; f++) {
            const field = fields[f];
            const prop = propsFields.find(it => it.name === field);
            if (!prop) {
                // cannot happen due to check before
                continue;
            }
            if (prop.type === 'checkbox') {
                itemValues[f] = itemValues[f] === 'true';
            }
            item[prop.name] = itemValues[f];
        }
        return item;
    });
}
//# sourceMappingURL=convert.js.map