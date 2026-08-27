import { describe, expect, it } from 'vitest';
import { hashPassword, validatePassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('uses a bounded scrypt password format accepted by login', async () => {
    validatePassword('long-password');
    expect(() => validatePassword('short')).toThrow('10-128');

    const encoded = await hashPassword('long-password');

    expect(encoded).toMatch(/^scrypt\$[^$]+\$[^$]+$/);
    await expect(verifyPassword('long-password', encoded)).resolves.toBe(true);
    await expect(verifyPassword('wrong-password', encoded)).resolves.toBe(false);
  });
});
