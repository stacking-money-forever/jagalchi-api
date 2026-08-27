import { describe, expect, it } from 'vitest';
import { postgresSsl } from './postgres-options';

const certificate = [
  '-----BEGIN CERTIFICATE-----',
  'test-certificate-body',
  '-----END CERTIFICATE-----',
].join('\n');

describe('postgresSsl', () => {
  it('disables TLS explicitly', () => {
    expect(postgresSsl(false, certificate)).toBe(false);
  });

  it('uses system certificate authorities by default', () => {
    expect(postgresSsl(true)).toEqual({ rejectUnauthorized: true });
  });

  it('normalizes an escaped custom certificate authority', () => {
    expect(postgresSsl(true, certificate.replace(/\n/g, '\\n'))).toEqual({
      rejectUnauthorized: true,
      ca: certificate,
    });
  });
});
