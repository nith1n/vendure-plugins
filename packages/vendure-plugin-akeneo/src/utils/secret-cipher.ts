import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const IV_LENGTH = 12;

/**
 * Symmetric AES-256-GCM encryption for credentials stored in the database.
 * Output format: `v1:<iv b64>:<auth tag b64>:<ciphertext b64>`.
 */
export class SecretCipher {
    private readonly key: Buffer;

    constructor(rawKey: string) {
        // Derive a fixed-length 256-bit key from the configured key material.
        this.key = createHash('sha256').update(rawKey, 'utf8').digest();
    }

    encrypt(plainText: string): string {
        const iv = randomBytes(IV_LENGTH);
        const cipher = createCipheriv(ALGORITHM, this.key, iv);
        const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        return [VERSION, iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(
            ':',
        );
    }

    decrypt(payload: string): string {
        const [version, iv, tag, data] = payload.split(':');
        if (version !== VERSION || !iv || !tag || data === undefined) {
            throw new Error('Unrecognized encrypted credential format');
        }
        const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(iv, 'base64'));
        decipher.setAuthTag(Buffer.from(tag, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString(
            'utf8',
        );
    }
}
