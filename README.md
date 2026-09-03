# Jagalchi NestJS API

This repository is the canonical NestJS product API for Jagalchi. The Django AI runtime lives in [`stacking-money-forever/jagalchi-ai`](https://github.com/stacking-money-forever/jagalchi-ai), and cross-service production deployment lives in [`stacking-money-forever/jagalchi-infra`](https://github.com/stacking-money-forever/jagalchi-infra).

Completed release evidence, the failed Cloudtype availability gate, and the personal-server cutover plan are tracked in [`CLOSED_ALPHA_REMAINING.md`](./CLOSED_ALPHA_REMAINING.md).

## Local verification

From this repository root:

```sh
pnpm lint
pnpm test
pnpm build
pnpm migration:run
pnpm contracts:check
pnpm openapi:check
```

For the standalone local harness, set `JAGALCHI_LOCAL_MODE`,
`LOCAL_SEED_EMAIL`, and `LOCAL_SEED_PASSWORD` in the private mode-600 env file,
then run `pnpm dev:seed -- --json`. The command is disabled in production and
prints one JSON result containing only schema, user, Project Run, and Roadmap IDs.
`local-real-source` uses live job intake and DeepSeek with fixture GitHub facts;
`local-real` remains the later real-GitHub mode.

The server-to-server AI v1 contract is published under `contracts/ai/v1/`. Its
`manifest.json` maps every request/response schema to a SHA-256 digest and
contains a deterministic `bundleSha256` for AI CI pinning. Regenerate it only
through `pnpm contracts:generate`; `pnpm contracts:check` fails on drift.
API CI also checks out `jagalchi-ai@main` and compares all eight schemas byte for
byte. Contract changes therefore land in two phases: merge the reviewed AI
consumer snapshot first, then merge the API producer change. Do not deploy the
consumer-only intermediate state; the deployment lock must advance both images
together.

The production image is built from this repository root:

```sh
docker build -t jagalchi-api:local .
```

The container runs as the non-root `node` user. API startup never runs migrations. Deployments must run the same image once with `pnpm start:migrate`, then start the API with the default command or the workflow worker with `pnpm worker:workflow`. The worker readiness probe is `pnpm workflow:health`; when Project Runs are enabled it requires both database access and a recent persisted worker heartbeat. Migration failure exits nonzero and must block API/worker rollout. `GET /api/health` is process liveness; `GET /api/health/ready` performs the same database and conditional worker-heartbeat checks and is the API Healthz target.

## Zero-cost provider gates

Only these providers are approved for this run:

- Cloudtype **Free**, exactly one NestJS service.
- Supabase **Free**, exactly one dedicated PostgreSQL project/database.

Stop before provisioning or deployment when either provider requires a new card, payment, automatic overage, paid resource, expanded terms, or an alternate provider. Do not upgrade automatically. Supabase must expose a TLS PostgreSQL connection usable by migrations and runtime within its Free connection/storage limits. Use the direct connection when the runtime supports IPv6; use the Free Session Pooler only when the runtime is IPv4-only. Certificate and hostname verification must remain enabled.

Cloudtype Free is temporary fallback infrastructure: one replica, Recreate updates, daily stop, cold starts, temporary local disk, preview hostname, and current Free traffic/build/image/runtime ceilings. The observed daily stop did not recover automatically within 15 minutes 20 seconds, so this provider fails the unattended availability gate. Recheck the signed-in dashboard immediately before deployment and record stricter current limits.

## Cloudtype service contract

| Setting | Required value |
|---|---|
| Repository | public `stacking-money-forever/jagalchi-api` |
| Build context | repository root |
| Dockerfile | `Dockerfile` |
| Branch/SHA | exact reviewed and pushed SHA |
| Service count | 1 |
| Replica/update | 1 replica, Recreate |
| Port | `8080` |
| Docker health | `/api/health` process liveness |
| Cloudtype Healthz | `/api/health/ready` database readiness |
| Autoscaling/paid fallback | disabled |
| Durable local files | prohibited |

Cloudtype must never overlap migration runners during deploy, restart, or rollback. If Recreate or Healthz behavior produces overlapping starts or a restart loop, stop the service.

## Production environment

Set secret values only in Cloudtype/Supabase secret controls. Never commit or copy them into this document.

```text
NODE_ENV=production
PORT=8080
DATABASE_URL=<Supabase direct or Free Session Pooler PostgreSQL URL>
DATABASE_SSL=true
DATABASE_SSL_CA=<Supabase root CA PEM; literal \n escapes are accepted>
DATABASE_SYNCHRONIZE=false
DATABASE_POOL_MAX=5
DATABASE_CONNECTION_TIMEOUT_MS=5000
DATABASE_QUERY_TIMEOUT_MS=10000
DATABASE_STATEMENT_TIMEOUT_MS=10000
JWT_ACCESS_SECRET=<32+ random characters>
VERIFICATION_CODE_SECRET=<32+ random characters>
RATE_LIMIT_HASH_SECRET=<different 32+ random characters>
TRUST_PROXY_HOPS=1
CORS_ORIGINS=https://jagalchi.justn.me
WEB_APP_URL=https://jagalchi.justn.me
PUBLIC_API_URL=<generated Cloudtype HTTPS origin>
AI_FEATURES_ENABLED=false
AI_PROVIDER=deepseek
AI_TIMEOUT_MS=65000
WORKFLOW_LEASE_MS=120000
WORKFLOW_HEARTBEAT_MS=30000
WORKFLOW_POLL_MS=1000
WORKFLOW_RETRY_BASE_MS=1000
WORKFLOW_RETRY_MAX_MS=30000
WORKFLOW_HEALTH_MAX_AGE_MS=90000
OBJECT_STORAGE_PRESIGN_ENDPOINT=https://storage.example.com
UPLOADS_ENABLED=false
EVIDENCE_EXECUTION_ENABLED=true
GITHUB_PROVIDER=github
JOB_SOURCE_PROVIDER=live
PUBLIC_PROOF_PROFILE_ENABLED=false
PROJECT_RUNS_ENABLED=false
GITHUB_APP_ID=<numeric app id>
GITHUB_APP_PRIVATE_KEY=<PEM private key>
GITHUB_APP_WEBHOOK_SECRET=<32+ random characters>
GITHUB_APP_SLUG=<app slug>
GITHUB_APP_SETUP_URL=<exact github.com HTTPS URL>
RESEND_API_KEY=<send-only Resend API key>
EMAIL_FROM=Jagalchi <no-reply@mail.jagalchi.justn.me>
```

Do not install dummy AI, object-storage, GitHub App, email, OAuth, or IAP credentials while the corresponding feature is disabled. Invalid/missing production flags, non-TLS database settings, synchronization, wildcard/localhost/path origins, or unsafe proxy hops must fail startup.

`GITHUB_PROVIDER`, `JOB_SOURCE_PROVIDER`, and `AI_PROVIDER` may use `fixture` only outside production. `GITHUB_PROVIDER=fixture` permits local evidence execution without live GitHub App secrets; production requires `GITHUB_PROVIDER=github` and the complete live GitHub App credential set.

Workflow timing is fail-closed: `AI_TIMEOUT_MS` must be lower than
`WORKFLOW_LEASE_MS`, and `WORKFLOW_HEARTBEAT_MS` must be lower than half the
lease. The API and worker both consume these validated values; polling uses
`WORKFLOW_POLL_MS`. Retryable failures use bounded exponential backoff between
`WORKFLOW_RETRY_BASE_MS` and `WORKFLOW_RETRY_MAX_MS`. Readiness rejects a stale
worker heartbeat after `WORKFLOW_HEALTH_MAX_AGE_MS`; when omitted, the threshold
is three heartbeat intervals with a 15-second floor. `WORKFLOW_HOLD_AFTER_CLAIM_MS`
is a development/test-only restart-test hook and production rejects a nonzero value.

Project Run list cursors use descending `(updatedAt, id)` keyset ordering. Pagination
is weakly consistent: a run updated between page requests may move across the cursor
and therefore appear again or be skipped. Clients should refresh from the first page
when they need a current complete view; the cursor does not provide snapshot isolation.

## Disabled feature contract

- `POST /api/ai/jobs` returns 503 `AI_FEATURES_DISABLED` before payload normalization, ticket reservation, token creation, URL construction, or network access.
- Every upload create/complete/download/delete operation returns 503 `UPLOADS_DISABLED` before roadmap, repository, metadata, S3, or presigner access.
- Public Proof remains unavailable because its flag is false. Evidence Execution is enabled only with the verified GitHub App installation, repository scope, webhook signature, and separate-reviewer controls.

Never report fake provider success or grant tickets without verified server fulfillment.

## Two-phase proxy trust

One reviewed source SHA must contain both validated modes.

1. Deploy an unexposed baseline with `TRUST_PROXY_HOPS=0`. It trusts no forwarded headers and derives HTTP/Socket.IO identity from the direct socket peer. Allow only controlled operator Healthz, Recreate, and forwarding-header probes; no browser, alpha, or real-user traffic.
2. Prove Cloudtype overwrites forwarding headers and record the exact positive hop count. Direct-versus-ingress spoof probes must demonstrate that an attacker cannot choose the effective client address.
3. Set only that exact `TRUST_PROXY_HOPS` value on the same source artifact. Run the full spoof/threshold matrix before any alpha exposure.
4. Stop permanently if hop behavior is ambiguous, spoofable, changes unexpectedly, or requires heuristic trust.

If the configuration restart reuses the image, reserve measured build capacity `2B` before baseline: one deploy plus one rollback build. If configuration consumes a build, reserve `3B`: baseline, final configuration deployment, and rollback. The final `B` remains rollback-only.

## Rate and body safeguards

The API uses `@nestjs/throttler` in-memory storage and is valid only for one replica. State resets on process restart.

| Route class | Limit |
|---|---|
| `/api/health`, `/api/health/ready` | exempt |
| registration/login | 5/min/action/IP and 20/hour/account |
| verification/password-reset request | 3/hour/account and 10/hour/IP |
| verification/reset completion, refresh, OAuth | 10/min/IP and 20/hour/account/attempt where present |
| other public API | 60/min/IP |
| other authenticated API | 120/min/user and 60/min/IP ceiling |
| Socket.IO handshake | 20/min/IP and one connection/user |
| AI/uploads | capacity zero; feature guard remains authoritative |

Account identifiers are normalized and HMACed before tracker storage. Keys and logs must not contain plaintext email, tokens, or raw trackers. 429 responses include `Retry-After`. JSON bodies are limited to 64 KB, URL-encoded bodies to 32 KB/100 parameters, and Socket.IO messages to 128 KB.

## Verification and exposure state

Required order:

```text
LOCAL_VERIFIED
-> PROVIDER_GATES_PASSED
-> SYNTHETIC_DB_PROVEN
-> CONSERVATIVE_SERVICE_CREATED_UNEXPOSED
-> RUNTIME_PROXY_BEHAVIOR_PROVEN
-> FINAL_TRUST_CONFIGURATION_DEPLOYED
-> FINAL_LIMITER_CONFIGURATION_PROVEN
-> SYNTHETIC_CLOSED_ALPHA
```

Migrations, TLS, exact CORS, auth/authorization, disabled-feature side effects, malformed/oversized bodies, threshold+1 429s, pool bounds, logs, export/restore, stop/start persistence, and previous-SHA rollback have production or production-equivalent evidence. The initial cohort remains capped at five accounts.

Real users remain blocked because the Cloudtype Free daily stop did not recover without human intervention. The next gate is a personal-server deployment with stable Supabase allowlisting, HTTPS ingress, restart recovery, and rollback to the current Cloudtype artifact.

Freeze invitations at 80% of any current Free quota and stop at these documented ceilings unless the dashboard shows stricter values: 48 concurrent gateway connections, 48 requests/second, 480 requests/minute, 8 GB monthly traffic, 160 monthly build minutes, and 0.8 GB final image. Reserve rollback build capacity before baseline.

## Rollback and incidents

- Retain the previous schema-compatible SHA; never hotfix a running container.
- Prefer additive forward-fix migrations. Never automatically run destructive down migrations.
- On migration failure, remain unready and redeploy the previous compatible SHA.
- On database failure, stop admissions/writes. Never fall back to Cloudtype disk or plaintext PostgreSQL.
- On proxy ambiguity, unauthorized baseline traffic, disabled-feature side effects, quota/spend breach, or missing rollback capacity, stop the service rather than pay or weaken controls.
- On secret exposure, stop, rotate the affected credential, confirm redaction, then restart.

The user alone enters credentials and approves login/OAuth/private-repository prompts. Automation must not accept card registration, paid plans, automatic overage, or expanded terms.

## Non-secret release evidence

Record identifiers and results only. Never record secret values, full database URLs, tokens, private repository operands, or raw headers containing credentials.

| Field | Value |
|---|---|
| Evidence date | 2026-08-28 KST |
| Production source policy | Web: latest `READY` main deployment from Vercel metadata; API: `ec82755385818f6e09b58f107b8bfc74aded7aae` |
| Cloudtype service | `@justn-hyeok/beatyavibe:main/jagalchi-api` / `mtb19ap69e746959` |
| Cloudtype plan/limit review and ₩0 confirmation | Free, one 512 MB replica, 1/4 services, no new payment accepted |
| Supabase plan/limit review and ₩0 confirmation | Free, Seoul Nano, no paid IPv4 add-on accepted |
| Secret names installed | DB URL/CA, JWT, verification, rate-limit; values excluded |
| Public API origin / web origin | Cloudtype preview origin / `https://jagalchi.justn.me` |
| Migration versions/result | 10 additive migrations; dedicated migration job completed before API/worker rollout |
| Baseline/final proxy trust values | `0` insufficient behind ingress; `1` passed changing-XFF threshold proof |
| Healthz/Recreate/single-runner proof | `/api/health/ready`, Recreate, one running replica |
| Build/image | observed image `79,529,017` bytes; cached rebuild 8–9 seconds |
| CORS/auth/disabled/rate/body/pool smoke | CORS and 413 passed; rate request 61 returned 429; production account and Evidence flows completed |
| Stop/resume persistence | manual stop/start preserved DB-backed response; actual daily stop had no automatic recovery for 15m20s+ |
| Export/restore drill | 341,786-byte dump restored; migration 9 and 13 tracked row counts matched |
| Previous-SHA rollback | Cloudtype and Vercel rollback/forward completed; baseline restored |
| Remaining blockers | [`CLOSED_ALPHA_REMAINING.md`](./CLOSED_ALPHA_REMAINING.md) |
