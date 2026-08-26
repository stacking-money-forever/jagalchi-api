import { createPrivateKey } from 'node:crypto';

type Environment = Record<string, string | undefined>;

const required = (environment: Environment, key: string): string => {
  const value = environment[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
};

export const validateEnvironment = (environment: Environment): Environment => {
  if (
    environment.EVIDENCE_EXECUTION_ENABLED !== undefined &&
    !['true', 'false'].includes(environment.EVIDENCE_EXECUTION_ENABLED)
  ) {
    throw new Error('EVIDENCE_EXECUTION_ENABLED must be true or false');
  }

  const jwtSecret = required(environment, 'JWT_ACCESS_SECRET');
  if (jwtSecret.length < 32) {
    throw new Error('JWT_ACCESS_SECRET must contain at least 32 characters');
  }

  required(environment, 'DATABASE_URL');
  required(environment, 'CORS_ORIGINS');
  required(environment, 'AI_SERVICE_URL');
  for (const key of ['PUBLIC_API_URL', 'WEB_APP_URL'] as const) {
    const url = new URL(required(environment, key));
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error(`${key} must use HTTP or HTTPS`);
    }
  }
  const aiSecret = required(environment, 'AI_AUTH_JWT_SECRET');
  if (aiSecret.length < 32) {
    throw new Error('AI_AUTH_JWT_SECRET must contain at least 32 characters');
  }
  const verificationSecret = required(environment, 'VERIFICATION_CODE_SECRET');
  if (verificationSecret.length < 32) {
    throw new Error('VERIFICATION_CODE_SECRET must contain at least 32 characters');
  }
  required(environment, 'OBJECT_STORAGE_BUCKET');
  required(environment, 'OBJECT_STORAGE_REGION');
  required(environment, 'OBJECT_STORAGE_ACCESS_KEY_ID');
  required(environment, 'OBJECT_STORAGE_SECRET_ACCESS_KEY');
  required(environment, 'OBJECT_STORAGE_PUBLIC_BASE_URL');

  if (environment.EVIDENCE_EXECUTION_ENABLED === 'true') {
    const appId = required(environment, 'GITHUB_APP_ID');
    if (!/^[1-9]\d*$/.test(appId)) {
      throw new Error('GITHUB_APP_ID must be a positive decimal identifier');
    }

    const appSlug = required(environment, 'GITHUB_APP_SLUG');
    if (!/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/.test(appSlug)) {
      throw new Error('GITHUB_APP_SLUG has an invalid format');
    }

    const webhookSecret = required(environment, 'GITHUB_APP_WEBHOOK_SECRET');
    if (webhookSecret.length < 32 || webhookSecret.length > 512) {
      throw new Error('GITHUB_APP_WEBHOOK_SECRET must contain between 32 and 512 characters');
    }

    const configuredPrivateKey = required(environment, 'GITHUB_APP_PRIVATE_KEY');
    const privateKey = configuredPrivateKey.replace(/\\n/g, '\n');
    if (
      privateKey.length < 256 ||
      privateKey.length > 16_384 ||
      !/^-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]+-----END (?:RSA )?PRIVATE KEY-----$/.test(
        privateKey,
      )
    ) {
      throw new Error('GITHUB_APP_PRIVATE_KEY must be a valid PEM private key');
    }
    try {
      const parsedKey = createPrivateKey(privateKey);
      if (parsedKey.asymmetricKeyType !== 'rsa') {
        throw new Error('not RSA');
      }
    } catch {
      throw new Error('GITHUB_APP_PRIVATE_KEY must be a valid RSA PEM private key');
    }

    let setupUrl: URL;
    try {
      setupUrl = new URL(required(environment, 'GITHUB_APP_SETUP_URL'));
    } catch {
      throw new Error('GITHUB_APP_SETUP_URL must be a valid URL');
    }
    if (
      setupUrl.protocol !== 'https:' ||
      setupUrl.hostname !== 'github.com' ||
      setupUrl.username ||
      setupUrl.password ||
      setupUrl.search ||
      setupUrl.hash ||
      setupUrl.pathname !== `/apps/${appSlug}/installations/new`
    ) {
      throw new Error(
        'GITHUB_APP_SETUP_URL must be the HTTPS GitHub installation URL for GITHUB_APP_SLUG',
      );
    }
  }

  if (environment.DATABASE_SSL === 'true') {
    const databaseUrl = new URL(environment.DATABASE_URL as string);
    if (databaseUrl.protocol !== 'postgres:' && databaseUrl.protocol !== 'postgresql:') {
      throw new Error('DATABASE_URL must use PostgreSQL');
    }
  }

  return environment;
};
