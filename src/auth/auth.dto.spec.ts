import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { OAuthCallbackQueryDto } from './auth.dto';

describe('OAuthCallbackQueryDto', () => {
  it('accepts the HTTPS issuer returned by Google callbacks', async () => {
    const query = Object.assign(new OAuthCallbackQueryDto(), {
      code: 'authorization-code',
      state: 'a'.repeat(64),
      iss: 'https://accounts.google.com',
    });

    await expect(validate(query)).resolves.toEqual([]);
  });

  it('rejects a non-HTTPS callback issuer', async () => {
    const query = Object.assign(new OAuthCallbackQueryDto(), {
      code: 'authorization-code',
      state: 'a'.repeat(64),
      iss: 'http://accounts.google.com',
    });

    expect((await validate(query)).map(({ property }) => property)).toContain('iss');
  });
});
