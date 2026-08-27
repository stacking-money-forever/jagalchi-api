import { describe, expect, it } from 'vitest';
import { parseExactOrigins, validateEnvironment } from './environment';

const productionEnvironment = (): Record<string, string> => ({
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:password@db.example.com:5432/jagalchi',
  DATABASE_SSL: 'true',
  DATABASE_SYNCHRONIZE: 'false',
  DATABASE_POOL_MAX: '5',
  DATABASE_CONNECTION_TIMEOUT_MS: '5000',
  DATABASE_QUERY_TIMEOUT_MS: '10000',
  DATABASE_STATEMENT_TIMEOUT_MS: '10000',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  VERIFICATION_CODE_SECRET: 'b'.repeat(32),
  RATE_LIMIT_HASH_SECRET: 'c'.repeat(32),
  CORS_ORIGINS: 'https://jagalchi.justn.me',
  PUBLIC_API_URL: 'https://jagalchi-api.example.com',
  WEB_APP_URL: 'https://jagalchi.justn.me',
  TRUST_PROXY_HOPS: '0',
  AI_FEATURES_ENABLED: 'false',
  UPLOADS_ENABLED: 'false',
  EVIDENCE_EXECUTION_ENABLED: 'false',
  PUBLIC_PROOF_PROFILE_ENABLED: 'false',
});

describe('validateEnvironment', () => {
  it('accepts the zero-cost production contract without provider credentials', () => {
    const environment = productionEnvironment();
    expect(validateEnvironment(environment)).toBe(environment);
  });

  it.each([
    'AI_FEATURES_ENABLED',
    'UPLOADS_ENABLED',
    'EVIDENCE_EXECUTION_ENABLED',
    'PUBLIC_PROOF_PROFILE_ENABLED',
  ])('requires explicit production flag %s', (key) => {
    const environment = productionEnvironment();
    delete environment[key];
    expect(() => validateEnvironment(environment)).toThrow(`${key} is required`);
  });

  it('accepts an escaped PEM database certificate authority', () => {
    const environment = {
      ...productionEnvironment(),
      DATABASE_SSL_CA:
        '-----BEGIN CERTIFICATE-----\\ntest-certificate-body\\n-----END CERTIFICATE-----',
    };
    expect(validateEnvironment(environment)).toBe(environment);
  });

  it.each([
    'not-a-certificate',
    '-----BEGIN CERTIFICATE-----\\nmissing-end',
    `-----BEGIN CERTIFICATE-----\n${'a'.repeat(16_384)}\n-----END CERTIFICATE-----`,
  ])('rejects invalid database certificate authority', (certificate) => {
    expect(() =>
      validateEnvironment({ ...productionEnvironment(), DATABASE_SSL_CA: certificate }),
    ).toThrow('DATABASE_SSL_CA must be a PEM certificate');
  });

  it('requires AI credentials only when AI is enabled', () => {
    const environment = { ...productionEnvironment(), AI_FEATURES_ENABLED: 'true' };
    expect(() => validateEnvironment(environment)).toThrow('AI_SERVICE_URL is required');
    Object.assign(environment, {
      AI_SERVICE_URL: 'https://ai.example.com',
      AI_AUTH_JWT_SECRET: 'd'.repeat(32),
    });
    expect(validateEnvironment(environment)).toBe(environment);
  });

  it('requires storage credentials only when uploads are enabled', () => {
    const environment = { ...productionEnvironment(), UPLOADS_ENABLED: 'true' };
    expect(() => validateEnvironment(environment)).toThrow('OBJECT_STORAGE_BUCKET is required');
    Object.assign(environment, {
      OBJECT_STORAGE_BUCKET: 'uploads',
      OBJECT_STORAGE_REGION: 'ap-northeast-2',
      OBJECT_STORAGE_ACCESS_KEY_ID: 'key',
      OBJECT_STORAGE_SECRET_ACCESS_KEY: 'secret',
      OBJECT_STORAGE_PUBLIC_BASE_URL: 'https://cdn.example.com',
    });
    expect(validateEnvironment(environment)).toBe(environment);
  });

  it.each([
    ['DATABASE_SSL', 'false', 'DATABASE_SSL must be true in production'],
    ['DATABASE_SYNCHRONIZE', 'true', 'DATABASE_SYNCHRONIZE must be false in production'],
    ['DATABASE_POOL_MAX', '6', 'DATABASE_POOL_MAX must be an integer between 1 and 5'],
    ['TRUST_PROXY_HOPS', '6', 'TRUST_PROXY_HOPS must be an integer between 0 and 5'],
  ])('rejects unsafe production %s', (key, value, message) => {
    expect(() => validateEnvironment({ ...productionEnvironment(), [key]: value })).toThrow(message);
  });

  it.each([
    'http://jagalchi.justn.me',
    'https://jagalchi.justn.me/',
    'https://jagalchi.justn.me/path',
    'https://*.justn.me',
    'null',
    'https://localhost:3000',
  ])('rejects unsafe production CORS origin %s', (origin) => {
    expect(() => validateEnvironment({ ...productionEnvironment(), CORS_ORIGINS: origin })).toThrow();
  });
});

describe('parseExactOrigins', () => {
  it('normalizes a unique development origin list', () => {
    expect(parseExactOrigins('http://localhost:3000,https://preview.example.com', false)).toEqual([
      'http://localhost:3000',
      'https://preview.example.com',
    ]);
  });

  it('rejects duplicate and empty origins', () => {
    expect(() => parseExactOrigins('https://example.com,https://example.com', true)).toThrow(
      'CORS_ORIGINS must not contain duplicates',
    );
    expect(() => parseExactOrigins('https://example.com,', true)).toThrow(
      'CORS_ORIGINS must contain non-empty origins',
    );
  });
});
