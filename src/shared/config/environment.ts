import { createPrivateKey } from "node:crypto";

type Environment = Record<string, string | undefined>;

const FEATURE_FLAGS = [
  "AI_FEATURES_ENABLED",
  "UPLOADS_ENABLED",
  "EVIDENCE_EXECUTION_ENABLED",
  "PUBLIC_PROOF_PROFILE_ENABLED",
  "OAUTH_ENABLED",
  "OAUTH_APPLE_ENABLED",
  "IAP_ENABLED",
  "EMAIL_ENABLED",
] as const;

const required = (environment: Environment, key: string): string => {
  const value = environment[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
};

const requiredBoolean = (environment: Environment, key: string): boolean => {
  const value = required(environment, key);
  if (value !== "true" && value !== "false")
    throw new Error(`${key} must be true or false`);
  return value === "true";
};

const optionalInteger = (
  environment: Environment,
  key: string,
  { min, max }: { min: number; max: number },
): void => {
  const value = environment[key];
  if (value === undefined) return;
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}`);
  }
};

export const parseExactOrigins = (
  value: string,
  requireHttps: boolean,
): string[] => {
  const origins = value.split(",").map((origin) => origin.trim());
  if (origins.length === 0 || origins.some((origin) => !origin)) {
    throw new Error("CORS_ORIGINS must contain non-empty origins");
  }
  const normalized = origins.map((origin) => {
    if (origin === "null" || origin.includes("*")) {
      throw new Error("CORS_ORIGINS must not contain null or wildcards");
    }
    const url = new URL(origin);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("CORS_ORIGINS must use HTTP or HTTPS");
    }
    if (requireHttps && url.protocol !== "https:") {
      throw new Error("CORS_ORIGINS must use HTTPS in production");
    }
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      origin !== url.origin
    ) {
      throw new Error(
        "CORS_ORIGINS entries must be exact origins without paths",
      );
    }
    if (
      requireHttps &&
      ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
    ) {
      throw new Error("CORS_ORIGINS must not contain localhost in production");
    }
    return url.origin;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("CORS_ORIGINS must not contain duplicates");
  }
  return normalized;
};

const validateExactUrl = (
  environment: Environment,
  key: string,
  requireHttps: boolean,
): void => {
  const value = required(environment, key);
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error(`${key} must use HTTP or HTTPS`);
  if (requireHttps && url.protocol !== "https:")
    throw new Error(`${key} must use HTTPS in production`);
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    value !== url.origin
  ) {
    throw new Error(
      `${key} must be an exact origin without credentials or paths`,
    );
  }
};

export const validateEnvironment = (environment: Environment): Environment => {
  const production = environment.NODE_ENV === "production";
  for (const key of FEATURE_FLAGS) {
    if (production) requiredBoolean(environment, key);
    else if (
      environment[key] !== undefined &&
      !["true", "false"].includes(environment[key])
    ) {
      throw new Error(`${key} must be true or false`);
    }
  }

  const jwtSecret = required(environment, "JWT_ACCESS_SECRET");
  if (jwtSecret.length < 32)
    throw new Error("JWT_ACCESS_SECRET must contain at least 32 characters");
  const verificationSecret = required(environment, "VERIFICATION_CODE_SECRET");
  if (verificationSecret.length < 32) {
    throw new Error(
      "VERIFICATION_CODE_SECRET must contain at least 32 characters",
    );
  }
  const rateLimitSecret = required(environment, "RATE_LIMIT_HASH_SECRET");
  if (rateLimitSecret.length < 32) {
    throw new Error(
      "RATE_LIMIT_HASH_SECRET must contain at least 32 characters",
    );
  }

  if (production && environment.EMAIL_ENABLED === "true") {
    const resendApiKey = required(environment, "RESEND_API_KEY");
    if (!/^re_[A-Za-z0-9_-]{16,}$/.test(resendApiKey)) {
      throw new Error("RESEND_API_KEY must be a Resend API key");
    }
    const emailFrom = required(environment, "EMAIL_FROM");
    const namedAddress = /^[^<>\r\n]{1,60} <([^<>\s]+)>$/.exec(emailFrom);
    if (
      ((emailFrom.includes("<") || emailFrom.includes(">")) && !namedAddress) ||
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(namedAddress?.[1] ?? emailFrom)
    ) {
      throw new Error(
        "EMAIL_FROM must be an email address with an optional display name",
      );
    }
  }

  const databaseUrl = new URL(required(environment, "DATABASE_URL"));
  if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol)) {
    throw new Error("DATABASE_URL must use PostgreSQL");
  }
  if (production) {
    const databaseSsl = requiredBoolean(environment, "DATABASE_SSL");
    const trustedLocalDatabase = ["api-db", "localhost", "127.0.0.1"].includes(
      databaseUrl.hostname,
    );
    if (!databaseSsl && !trustedLocalDatabase)
      throw new Error("DATABASE_SSL must be true in production");
    if (environment.DATABASE_SSL_CA?.trim()) {
      const certificate = environment.DATABASE_SSL_CA.replace(
        /\\n/g,
        "\n",
      ).trim();
      if (
        certificate.length > 16_384 ||
        !certificate.startsWith("-----BEGIN CERTIFICATE-----\n") ||
        !certificate.endsWith("\n-----END CERTIFICATE-----")
      ) {
        throw new Error("DATABASE_SSL_CA must be a PEM certificate");
      }
    }
    if (requiredBoolean(environment, "DATABASE_SYNCHRONIZE")) {
      throw new Error("DATABASE_SYNCHRONIZE must be false in production");
    }
    required(environment, "TRUST_PROXY_HOPS");
  }

  optionalInteger(environment, "DATABASE_POOL_MAX", { min: 1, max: 5 });
  optionalInteger(environment, "DATABASE_CONNECTION_TIMEOUT_MS", {
    min: 1_000,
    max: 30_000,
  });
  optionalInteger(environment, "DATABASE_QUERY_TIMEOUT_MS", {
    min: 1_000,
    max: 30_000,
  });
  optionalInteger(environment, "DATABASE_STATEMENT_TIMEOUT_MS", {
    min: 1_000,
    max: 30_000,
  });
  optionalInteger(environment, "TRUST_PROXY_HOPS", { min: 0, max: 5 });

  parseExactOrigins(required(environment, "CORS_ORIGINS"), production);
  validateExactUrl(environment, "PUBLIC_API_URL", production);
  validateExactUrl(environment, "WEB_APP_URL", production);

  if (environment.AI_FEATURES_ENABLED !== "false") {
    required(environment, "AI_SERVICE_URL");
    const aiSecret = required(environment, "AI_AUTH_JWT_SECRET");
    if (aiSecret.length < 32)
      throw new Error("AI_AUTH_JWT_SECRET must contain at least 32 characters");
  }

  if (environment.UPLOADS_ENABLED !== "false") {
    required(environment, "OBJECT_STORAGE_BUCKET");
    required(environment, "OBJECT_STORAGE_REGION");
    required(environment, "OBJECT_STORAGE_ACCESS_KEY_ID");
    required(environment, "OBJECT_STORAGE_SECRET_ACCESS_KEY");
    const publicBaseUrl = new URL(
      required(environment, "OBJECT_STORAGE_PUBLIC_BASE_URL"),
    );
    if (production && publicBaseUrl.protocol !== "https:") {
      throw new Error(
        "OBJECT_STORAGE_PUBLIC_BASE_URL must use HTTPS in production",
      );
    }
  }

  if (environment.EVIDENCE_EXECUTION_ENABLED === "true") {
    const appId = required(environment, "GITHUB_APP_ID");
    if (!/^\d+$/.test(appId)) throw new Error("GITHUB_APP_ID must be numeric");
    const privateKey = required(environment, "GITHUB_APP_PRIVATE_KEY")
      .replace(/\\n/g, "\n")
      .trim();
    try {
      createPrivateKey(privateKey);
    } catch {
      throw new Error("GITHUB_APP_PRIVATE_KEY must be a valid private key");
    }
    const webhookSecret = required(environment, "GITHUB_APP_WEBHOOK_SECRET");
    if (webhookSecret.length < 32) {
      throw new Error(
        "GITHUB_APP_WEBHOOK_SECRET must contain at least 32 characters",
      );
    }
    const slug = required(environment, "GITHUB_APP_SLUG");
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) {
      throw new Error("GITHUB_APP_SLUG must be a GitHub App slug");
    }
    const setupUrl = new URL(required(environment, "GITHUB_APP_SETUP_URL"));
    if (setupUrl.protocol !== "https:" || setupUrl.hostname !== "github.com") {
      throw new Error("GITHUB_APP_SETUP_URL must be an HTTPS github.com URL");
    }
  }

  if (environment.OAUTH_ENABLED === "true") {
    required(environment, "OAUTH_GOOGLE_CLIENT_ID");
    required(environment, "OAUTH_GOOGLE_CLIENT_SECRET");
    required(environment, "OAUTH_GITHUB_CLIENT_ID");
    required(environment, "OAUTH_GITHUB_CLIENT_SECRET");
  }

  if (environment.OAUTH_APPLE_ENABLED === "true") {
    if (environment.OAUTH_ENABLED !== "true") {
      throw new Error("OAUTH_ENABLED must be true when OAUTH_APPLE_ENABLED is true");
    }
    required(environment, "OAUTH_APPLE_CLIENT_ID");
    required(environment, "OAUTH_APPLE_TEAM_ID");
    required(environment, "OAUTH_APPLE_KEY_ID");
    const applePrivateKey = required(environment, "OAUTH_APPLE_PRIVATE_KEY")
      .replace(/\\n/g, "\n")
      .trim();
    if (!applePrivateKey) {
      throw new Error(
        "OAUTH_APPLE_PRIVATE_KEY must contain a non-empty private key",
      );
    }
  }

  if (environment.IAP_ENABLED === "true") {
    const bindingSecret = required(environment, "IAP_ACCOUNT_BINDING_SECRET");
    if (bindingSecret.length < 32) {
      throw new Error(
        "IAP_ACCOUNT_BINDING_SECRET must contain at least 32 characters",
      );
    }
  }

  return environment;
};
