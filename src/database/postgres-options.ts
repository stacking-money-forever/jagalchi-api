type EnvironmentReader = {
  get(key: string): unknown;
};

const integer = (value: unknown, fallback: number): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return fallback;
};

export const postgresSsl = (enabled: boolean): false | { rejectUnauthorized: true } =>
  enabled ? { rejectUnauthorized: true } : false;

export const postgresExtra = (
  environment: EnvironmentReader,
  migration: boolean,
): {
  max: number;
  connectionTimeoutMillis: number;
  query_timeout: number;
  statement_timeout: number;
} => ({
  max: migration ? 1 : integer(environment.get('DATABASE_POOL_MAX'), 5),
  connectionTimeoutMillis: integer(environment.get('DATABASE_CONNECTION_TIMEOUT_MS'), 5_000),
  query_timeout: integer(environment.get('DATABASE_QUERY_TIMEOUT_MS'), 10_000),
  statement_timeout: integer(environment.get('DATABASE_STATEMENT_TIMEOUT_MS'), 10_000),
});
