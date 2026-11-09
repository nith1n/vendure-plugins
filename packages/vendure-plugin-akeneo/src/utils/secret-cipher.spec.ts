import { describe, expect, it } from 'vitest';

import { SecretCipher } from './secret-cipher';

describe('SecretCipher', () => {
    it('decrypts what it encrypted, with a new IV each time', () => {
        const cipher = new SecretCipher('a key');
        const first = cipher.encrypt('s3cret');
        const second = cipher.encrypt('s3cret');
        expect(first).not.toBe(second);
        expect(first).not.toContain('s3cret');
        expect(cipher.decrypt(first)).toBe('s3cret');
    });

    it('cannot decrypt with another key', () => {
        const payload = new SecretCipher('a key').encrypt('s3cret');
        expect(() => new SecretCipher('another key').decrypt(payload)).toThrow();
    });

    it('rejects a tampered payload', () => {
        const cipher = new SecretCipher('a key');
        const [version, iv, tag, data] = cipher.encrypt('s3cret').split(':');
        const tampered = Buffer.from(data, 'base64');
        tampered[0] ^= 1;
        expect(() => cipher.decrypt([version, iv, tag, tampered.toString('base64')].join(':'))).toThrow();
        expect(() => cipher.decrypt('not-encrypted')).toThrow('Unrecognized encrypted credential format');
    });
});
