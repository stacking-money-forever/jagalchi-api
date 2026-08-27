# Jagalchi NestJS API

This package is the canonical NestJS backend for Jagalchi. The temporary zero-cost alpha deployment runs one API container on Cloudtype Free and stores durable state only in Supabase Free PostgreSQL. Django AI, uploads, GitHub Evidence Execution, and public Proof are disabled.

## Local verification

From the monorepo root:

```sh
pnpm --filter @jagalchi/api lint
pnpm --filter @jagalchi/api test
pnpm --filter @jagalchi/api build
pnpm --filter @jagalchi/api migration:run
```

The production image must be built with the repository root as context:

```sh
docker build -f services/api/Dockerfile -t jagalchi-api:local .
```

The container runs as the non-root `node` user. Startup runs every pending migration and starts Nest only after migrations succeed. Migration failure exits nonzero. `GET /api/health` is process liveness; `GET /api/health/ready` performs a bounded `SELECT 1` and is the Cloudtype Healthz target.

## Zero-cost provider gates

Only these providers are approved for this run:

- Cloudtype **Free**, exactly one NestJS service.
- Supabase **Free**, exactly one dedicated PostgreSQL project/database.

Stop before provisioning or deployment when either provider requires a new card, payment, automatic overage, paid resource, expanded terms, or an alternate provider. Do not upgrade automatically. Supabase must expose a TLS PostgreSQL connection usable by migrations and runtime within its Free connection/storage limits. Use the direct connection when the runtime supports IPv6; use the Free Session Pooler only when the runtime is IPv4-only. Certificate and hostname verification must remain enabled.

Cloudtype Free is temporary alpha infrastructure: one replica, Recreate updates, daily stop, cold starts, temporary local disk, preview hostname, and current Free traffic/build/image/runtime ceilings. Recheck the signed-in dashboard immediately before deployment and record stricter current limits.

## Cloudtype service contract

| Setting | Required value |
|---|---|
| Repository | public `gajaedev/jagalchi-platform` |
| Build context | repository root |
| Dockerfile | `services/api/Dockerfile` |
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
TRUST_PROXY_HOPS=0
CORS_ORIGINS=https://jagalchi.justn.me
WEB_APP_URL=https://jagalchi.justn.me
PUBLIC_API_URL=<generated Cloudtype HTTPS origin>
AI_FEATURES_ENABLED=false
UPLOADS_ENABLED=false
EVIDENCE_EXECUTION_ENABLED=false
PUBLIC_PROOF_PROFILE_ENABLED=false
```

Do not install dummy AI, object-storage, GitHub App, email, OAuth, or IAP credentials while the corresponding feature is disabled. Invalid/missing production flags, non-TLS database settings, synchronization, wildcard/localhost/path origins, or unsafe proxy hops must fail startup.

## Disabled feature contract

- `POST /api/ai/jobs` returns 503 `AI_FEATURES_DISABLED` before payload normalization, ticket reservation, token creation, URL construction, or network access.
- Every upload create/complete/download/delete operation returns 503 `UPLOADS_DISABLED` before roadmap, repository, metadata, S3, or presigner access.
- Evidence Execution and public Proof controllers remain unavailable because their flags are explicitly false.

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

Before `SYNTHETIC_CLOSED_ALPHA`, verify migrations on fresh/existing schemas, TLS failure behavior, readiness loss/recovery, exact CORS, auth/authorization, disabled 503 side effects, malformed/oversized bodies, threshold+1 429s, pool bounds, logs, stop/resume persistence, and previous-SHA rollback. The initial synthetic cohort is at most five accounts.

Real users remain blocked until a zero-cost export and restore drill succeeds with disposable data. Until then the database is synthetic/disposable and has no RPO/RTO claim. After proof, real closed alpha remains capped at five accounts for this run.

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
| Evidence date/time | pending |
| Reviewed source SHA | pending |
| Cloudtype deployment/image IDs | pending |
| Cloudtype plan/limit review and ₩0 confirmation | pending |
| Supabase plan/limit review and ₩0 confirmation | pending |
| Secret names installed | pending |
| Public API origin / web origin | pending / `https://jagalchi.justn.me` |
| Migration versions/result | pending |
| Baseline/final proxy trust values and sanitized hop shape | pending |
| Healthz/Recreate/single-runner proof | pending |
| Build cost `B`, image size, reserve | pending |
| CORS/auth/disabled/rate/body/pool smoke | pending |
| Stop/resume persistence | pending |
| Export/restore drill | pending |
| Previous-SHA rollback | pending |
| Remaining blockers | pending |
