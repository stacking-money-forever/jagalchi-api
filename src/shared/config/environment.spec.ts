import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { parseExactOrigins, validateEnvironment } from "./environment";

const githubPrivateKey = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
}).privateKey;

const productionEnvironment = (): Record<string, string> => ({
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://user:password@db.example.com:5432/jagalchi",
  DATABASE_SSL: "true",
  DATABASE_SYNCHRONIZE: "false",
  DATABASE_POOL_MAX: "5",
  DATABASE_CONNECTION_TIMEOUT_MS: "5000",
  DATABASE_QUERY_TIMEOUT_MS: "10000",
  DATABASE_STATEMENT_TIMEOUT_MS: "10000",
  JWT_ACCESS_SECRET: "a".repeat(32),
  VERIFICATION_CODE_SECRET: "b".repeat(32),
  RATE_LIMIT_HASH_SECRET: "c".repeat(32),
  RESEND_API_KEY: `re_${"d".repeat(24)}`,
  EMAIL_FROM: "Jagalchi <no-reply@mail.jagalchi.justn.me>",
  CORS_ORIGINS: "https://jagalchi.justn.me",
  PUBLIC_API_URL: "https://jagalchi-api.example.com",
  WEB_APP_URL: "https://jagalchi.justn.me",
  TRUST_PROXY_HOPS: "0",
  AI_FEATURES_ENABLED: "false",
  UPLOADS_ENABLED: "false",
  EVIDENCE_EXECUTION_ENABLED: "false",
  PUBLIC_PROOF_PROFILE_ENABLED: "false",
  OAUTH_ENABLED: "false",
  OAUTH_APPLE_ENABLED: "false",
  IAP_ENABLED: "false",
  EMAIL_ENABLED: "true",
  PROJECT_RUNS_ENABLED: "false",
});

const fullProductionEnvironment = (): Record<string, string> => ({
  ...productionEnvironment(),
  AI_FEATURES_ENABLED: "true",
  AI_PROVIDER: "deepseek",
  AI_SERVICE_URL: "https://ai.example.com",
  AI_AUTH_JWT_SECRET: "d".repeat(32),
  UPLOADS_ENABLED: "true",
  OBJECT_STORAGE_BUCKET: "uploads",
  OBJECT_STORAGE_REGION: "ap-northeast-2",
  OBJECT_STORAGE_ACCESS_KEY_ID: "key",
  OBJECT_STORAGE_SECRET_ACCESS_KEY: "secret",
  OBJECT_STORAGE_PUBLIC_BASE_URL: "https://cdn.example.com",
  OBJECT_STORAGE_PRESIGN_ENDPOINT: "https://storage.example.com",
  EVIDENCE_EXECUTION_ENABLED: "true",
  GITHUB_PROVIDER: "github",
  GITHUB_APP_ID: "123456",
  GITHUB_APP_PRIVATE_KEY: githubPrivateKey,
  GITHUB_APP_WEBHOOK_SECRET: "e".repeat(32),
  GITHUB_APP_SLUG: "jagalchi-app",
  GITHUB_APP_SETUP_URL:
    "https://github.com/apps/jagalchi-app/installations/new",
  PUBLIC_PROOF_PROFILE_ENABLED: "true",
  OAUTH_ENABLED: "true",
  OAUTH_APPLE_ENABLED: "true",
  OAUTH_GOOGLE_CLIENT_ID: "google-client-id",
  OAUTH_GOOGLE_CLIENT_SECRET: "google-client-secret",
  OAUTH_GITHUB_CLIENT_ID: "github-client-id",
  OAUTH_GITHUB_CLIENT_SECRET: "github-client-secret",
  OAUTH_APPLE_CLIENT_ID: "com.jagalchi.web",
  OAUTH_APPLE_TEAM_ID: "apple-team-id",
  OAUTH_APPLE_KEY_ID: "apple-key-id",
  OAUTH_APPLE_PRIVATE_KEY:
    "-----BEGIN PRIVATE KEY-----\\napple-private-key\\n-----END PRIVATE KEY-----",
});

describe("validateEnvironment", () => {
  it("allows plaintext PostgreSQL on the private Compose database hostname", () => {
    const environment = productionEnvironment();
    environment.DATABASE_URL =
      "postgresql://jagalchi_api:password@api-db:5432/jagalchi_api";
    environment.DATABASE_SSL = "false";
    expect(() => validateEnvironment(environment)).not.toThrow();
  });
  it("accepts the zero-cost production contract with Resend delivery", () => {
    const environment = productionEnvironment();
    expect(validateEnvironment(environment)).toBe(environment);
  });

  it("accepts a full-feature production contract", () => {
    const environment = fullProductionEnvironment();
    expect(validateEnvironment(environment)).toBe(environment);
  });

  it('allows fixture providers without live GitHub secrets outside production', () => {
    const environment = {
      ...productionEnvironment(),
      NODE_ENV: 'development',
      EVIDENCE_EXECUTION_ENABLED: 'true',
      GITHUB_PROVIDER: 'fixture',
      JOB_SOURCE_PROVIDER: 'fixture',
      AI_PROVIDER: 'deepseek',
    };
    expect(validateEnvironment(environment)).toBe(environment);
  });

  it.each(['GITHUB_PROVIDER', 'JOB_SOURCE_PROVIDER', 'AI_PROVIDER'])(
    'rejects fixture mode for %s in production',
    (key) => {
      const environment = productionEnvironment();
      environment[key] = 'fixture';
      expect(() => validateEnvironment(environment)).toThrow(`${key}=fixture is not allowed in production`);
    },
  );

  it.each([
    "AI_FEATURES_ENABLED",
    "UPLOADS_ENABLED",
    "EVIDENCE_EXECUTION_ENABLED",
    "PUBLIC_PROOF_PROFILE_ENABLED",
    "OAUTH_ENABLED",
    "OAUTH_APPLE_ENABLED",
    "IAP_ENABLED",
    "PROJECT_RUNS_ENABLED",
  ])("requires explicit production flag %s", (key) => {
    const environment = productionEnvironment();
    delete environment[key];
    expect(() => validateEnvironment(environment)).toThrow(
      `${key} is required`,
    );
  });

  it("accepts an escaped PEM database certificate authority", () => {
    const environment = {
      ...productionEnvironment(),
      DATABASE_SSL_CA:
        "-----BEGIN CERTIFICATE-----\\ntest-certificate-body\\n-----END CERTIFICATE-----",
    };
    expect(validateEnvironment(environment)).toBe(environment);
  });

  it.each([
    "not-a-certificate",
    "-----BEGIN CERTIFICATE-----\\nmissing-end",
    `-----BEGIN CERTIFICATE-----\n${"a".repeat(16_384)}\n-----END CERTIFICATE-----`,
  ])("rejects invalid database certificate authority", (certificate) => {
    expect(() =>
      validateEnvironment({
        ...productionEnvironment(),
        DATABASE_SSL_CA: certificate,
      }),
    ).toThrow("DATABASE_SSL_CA must be a PEM certificate");
  });

  it.each([
    ["RESEND_API_KEY", "not-a-key", "RESEND_API_KEY must be a Resend API key"],
    [
      "EMAIL_FROM",
      "bad\nheader@example.com",
      "EMAIL_FROM must be an email address",
    ],
    [
      "EMAIL_FROM",
      "Missing bracket <sender@example.com",
      "EMAIL_FROM must be an email address",
    ],
  ])("rejects invalid email configuration %s", (key, value, message) => {
    expect(() =>
      validateEnvironment({ ...productionEnvironment(), [key]: value }),
    ).toThrow(message);
  });

  it("requires Resend credentials in production", () => {
    const withoutKey = productionEnvironment();
    delete withoutKey.RESEND_API_KEY;
    expect(() => validateEnvironment(withoutKey)).toThrow(
      "RESEND_API_KEY is required",
    );
    const withoutSender = productionEnvironment();
    delete withoutSender.EMAIL_FROM;
    expect(() => validateEnvironment(withoutSender)).toThrow(
      "EMAIL_FROM is required",
    );
  });

  it("requires AI credentials only when AI is enabled", () => {
    const environment = {
      ...productionEnvironment(),
      AI_FEATURES_ENABLED: "true",
      AI_PROVIDER: "deepseek",
    };
    expect(() => validateEnvironment(environment)).toThrow(
      "AI_SERVICE_URL is required",
    );
    Object.assign(environment, {
      AI_SERVICE_URL: "https://ai.example.com",
      AI_AUTH_JWT_SECRET: "d".repeat(32),
    });
    expect(validateEnvironment(environment)).toBe(environment);
  });

  it('accepts the production 65s AI / 120s lease timing budget', () => {
    const environment = productionEnvironment();
    Object.assign(environment, {
      AI_TIMEOUT_MS: '65000', WORKFLOW_LEASE_MS: '120000',
      WORKFLOW_HEARTBEAT_MS: '30000', WORKFLOW_POLL_MS: '1000',
    });
    expect(validateEnvironment(environment)).toBe(environment);
  });

  it('rejects an AI timeout that can outlive its workflow lease', () => {
    expect(() => validateEnvironment({
      ...productionEnvironment(), AI_TIMEOUT_MS: '90000', WORKFLOW_LEASE_MS: '80000',
    })).toThrow('AI_TIMEOUT_MS must be less than WORKFLOW_LEASE_MS');
  });

  it('rejects a heartbeat cadence that cannot safely renew the lease', () => {
    expect(() => validateEnvironment({
      ...productionEnvironment(), WORKFLOW_LEASE_MS: '120000', WORKFLOW_HEARTBEAT_MS: '60000',
    })).toThrow('WORKFLOW_HEARTBEAT_MS must be less than half of WORKFLOW_LEASE_MS');
  });

  it('rejects the deterministic hold-after-claim hook in production', () => {
    expect(() => validateEnvironment({
      ...productionEnvironment(), WORKFLOW_HOLD_AFTER_CLAIM_MS: '1',
    })).toThrow('WORKFLOW_HOLD_AFTER_CLAIM_MS is not allowed in production');
  });

  it("requires storage credentials only when uploads are enabled", () => {
    const environment = { ...productionEnvironment(), UPLOADS_ENABLED: "true" };
    expect(() => validateEnvironment(environment)).toThrow(
      "OBJECT_STORAGE_BUCKET is required",
    );
    Object.assign(environment, {
      OBJECT_STORAGE_BUCKET: "uploads",
      OBJECT_STORAGE_REGION: "ap-northeast-2",
      OBJECT_STORAGE_ACCESS_KEY_ID: "key",
      OBJECT_STORAGE_SECRET_ACCESS_KEY: "secret",
      OBJECT_STORAGE_PUBLIC_BASE_URL: "https://cdn.example.com",
      OBJECT_STORAGE_PRESIGN_ENDPOINT: "https://storage.example.com",
    });
    expect(validateEnvironment(environment)).toBe(environment);
  });

  it('allows loopback HTTP browser storage endpoints only outside production', () => {
    const development = {
      ...productionEnvironment(), NODE_ENV: 'development', UPLOADS_ENABLED: 'true',
      OBJECT_STORAGE_BUCKET: 'uploads', OBJECT_STORAGE_REGION: 'us-east-1',
      OBJECT_STORAGE_ACCESS_KEY_ID: 'key', OBJECT_STORAGE_SECRET_ACCESS_KEY: 'secret',
      OBJECT_STORAGE_PUBLIC_BASE_URL: 'http://127.0.0.1:9000/public/',
      OBJECT_STORAGE_PRESIGN_ENDPOINT: 'http://localhost:9000',
    };
    expect(validateEnvironment(development)).toBe(development);
    expect(() => validateEnvironment({
      ...development, OBJECT_STORAGE_PRESIGN_ENDPOINT: 'http://minio:9000',
    })).toThrow('OBJECT_STORAGE_PRESIGN_ENDPOINT');
    expect(() => validateEnvironment({
      ...development, OBJECT_STORAGE_PUBLIC_BASE_URL: 'http://storage.internal/public/',
    })).toThrow('OBJECT_STORAGE_PUBLIC_BASE_URL');
    expect(() => validateEnvironment({
      ...development, NODE_ENV: 'production',
      OBJECT_STORAGE_PUBLIC_BASE_URL: 'https://cdn.example.com/public/',
      OBJECT_STORAGE_PRESIGN_ENDPOINT: 'http://127.0.0.1:9000',
    })).toThrow('OBJECT_STORAGE_PRESIGN_ENDPOINT');
  });

  it('accepts the Phase 1 local-real-source provider matrix', () => {
    const environment = {
      ...fullProductionEnvironment(), NODE_ENV: 'development',
      JAGALCHI_LOCAL_MODE: 'local-real-source', JOB_SOURCE_PROVIDER: 'live',
      GITHUB_PROVIDER: 'fixture', AI_PROVIDER: 'deepseek',
    };
    expect(validateEnvironment(environment)).toBe(environment);
  });

  it('accepts real source capture with deterministic AI and GitHub', () => {
    const environment = {
      ...fullProductionEnvironment(), NODE_ENV: 'development',
      JAGALCHI_LOCAL_MODE: 'ci-real-source', JOB_SOURCE_PROVIDER: 'live',
      GITHUB_PROVIDER: 'fixture', AI_PROVIDER: 'fixture',
    };
    expect(validateEnvironment(environment)).toBe(environment);
  });

  it.each([
    "OAUTH_GOOGLE_CLIENT_ID",
    "OAUTH_GOOGLE_CLIENT_SECRET",
    "OAUTH_GITHUB_CLIENT_ID",
    "OAUTH_GITHUB_CLIENT_SECRET",
  ])("requires web OAuth credential %s when OAuth is enabled", (key) => {
    const environment = fullProductionEnvironment();
    environment.OAUTH_APPLE_ENABLED = "false";
    delete environment[key];
    expect(() => validateEnvironment(environment)).toThrow(
      `${key} is required`,
    );
  });

  it.each([
    "OAUTH_APPLE_CLIENT_ID",
    "OAUTH_APPLE_TEAM_ID",
    "OAUTH_APPLE_KEY_ID",
    "OAUTH_APPLE_PRIVATE_KEY",
  ])("requires Apple OAuth credential %s only when Apple OAuth is enabled", (key) => {
    const environment = fullProductionEnvironment();
    delete environment[key];
    expect(() => validateEnvironment(environment)).toThrow(
      `${key} is required`,
    );
  });

  it("accepts web OAuth without Apple credentials when Apple OAuth is disabled", () => {
    const environment = fullProductionEnvironment();
    environment.OAUTH_APPLE_ENABLED = "false";
    delete environment.OAUTH_APPLE_CLIENT_ID;
    delete environment.OAUTH_APPLE_TEAM_ID;
    delete environment.OAUTH_APPLE_KEY_ID;
    delete environment.OAUTH_APPLE_PRIVATE_KEY;
    expect(validateEnvironment(environment)).toBe(environment);
  });

  it("requires a dedicated binding secret only when IAP is enabled", () => {
    const disabled = productionEnvironment();
    expect(validateEnvironment(disabled)).toBe(disabled);

    const enabled = { ...disabled, IAP_ENABLED: "true" };
    expect(() => validateEnvironment(enabled)).toThrow(
      "IAP_ACCOUNT_BINDING_SECRET is required",
    );
    enabled.IAP_ACCOUNT_BINDING_SECRET = "i".repeat(32);
    expect(validateEnvironment(enabled)).toBe(enabled);
  });

  it("rejects an Apple private key that normalizes to empty", () => {
    expect(() =>
      validateEnvironment({
        ...fullProductionEnvironment(),
        OAUTH_APPLE_PRIVATE_KEY: "\\n\\n",
      }),
    ).toThrow("OAUTH_APPLE_PRIVATE_KEY must contain a non-empty private key");
  });

  it.each([
    ["DATABASE_SSL", "false", "DATABASE_SSL must be true in production"],
    [
      "DATABASE_SYNCHRONIZE",
      "true",
      "DATABASE_SYNCHRONIZE must be false in production",
    ],
    [
      "DATABASE_POOL_MAX",
      "6",
      "DATABASE_POOL_MAX must be an integer between 1 and 5",
    ],
    [
      "TRUST_PROXY_HOPS",
      "6",
      "TRUST_PROXY_HOPS must be an integer between 0 and 5",
    ],
  ])("rejects unsafe production %s", (key, value, message) => {
    expect(() =>
      validateEnvironment({ ...productionEnvironment(), [key]: value }),
    ).toThrow(message);
  });

  it.each([
    "http://jagalchi.justn.me",
    "https://jagalchi.justn.me/",
    "https://jagalchi.justn.me/path",
    "https://*.justn.me",
    "null",
    "https://localhost:3000",
  ])("rejects unsafe production CORS origin %s", (origin) => {
    expect(() =>
      validateEnvironment({ ...productionEnvironment(), CORS_ORIGINS: origin }),
    ).toThrow();
  });
});

describe("parseExactOrigins", () => {
  it("normalizes a unique development origin list", () => {
    expect(
      parseExactOrigins(
        "http://localhost:3000,https://preview.example.com",
        false,
      ),
    ).toEqual(["http://localhost:3000", "https://preview.example.com"]);
  });

  it("rejects duplicate and empty origins", () => {
    expect(() =>
      parseExactOrigins("https://example.com,https://example.com", true),
    ).toThrow("CORS_ORIGINS must not contain duplicates");
    expect(() => parseExactOrigins("https://example.com,", true)).toThrow(
      "CORS_ORIGINS must contain non-empty origins",
    );
  });
});
