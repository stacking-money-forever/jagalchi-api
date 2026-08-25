type Environment = Record<string, string | undefined>;

const required = (environment: Environment, key: string): string => {
  const value = environment[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
};

export const validateEnvironment = (environment: Environment): Environment => {
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

  if (environment.DATABASE_SSL === 'true') {
    const databaseUrl = new URL(environment.DATABASE_URL as string);
    if (databaseUrl.protocol !== 'postgres:' && databaseUrl.protocol !== 'postgresql:') {
      throw new Error('DATABASE_URL must use PostgreSQL');
    }
  }

  return environment;
};
