# Jagalchi Closed Alpha 출시 상태

기준 시각: 2026-08-28 KST

현재 production Web 소스: `2f76c80a20128adac0ce3f3630e04d12bd722393`

현재 production API 소스: `ec82755385818f6e09b58f107b8bfc74aded7aae`

이 문서는 최대 5계정 closed alpha의 현재 출시 판정과 다음 실행 게이트만 관리한다. Web과 API는 별도 provider에서 배포되므로 위 SHA 두 개가 승인된 production 조합이다. 비밀값, 전체 데이터베이스 URL, 토큰, 인증번호, 개인 이메일은 기록하지 않는다. 상세 운영 증거의 정본은 GitHub Issue [#13](https://github.com/gajaedev/jagalchi-platform/issues/13)이다.

## 출시 판정

기능, 보안, 데이터 복구, rollback 검증은 완료됐다. 그러나 **현재 Cloudtype Free API는 매일 정지 후 사람 개입 없이 복구되지 않으므로 신규 alpha 초대를 열 수 없다.**

- 현재 production은 임시로 유지한다. `/`, `/login`, `/api/health`, `/api/health/ready`는 다시 `200`이다.
- Cloudtype를 끄거나 Supabase allowlist를 변경하는 cutover는 개인 서버가 검증된 뒤에만 수행한다.
- 다음 출시 게이트는 개인 서버의 Docker 배포, HTTPS ingress, 고정 outbound allowlist, 재시작 복구 실증이다.

## 현재 production

| Surface | Provider | 현재 상태 |
| --- | --- | --- |
| Web | Vercel | `https://jagalchi.justn.me`, production `READY` |
| API | Cloudtype Free | `jagalchi-api`, 단일 512 MB replica, Recreate, 현재 `1/1` |
| Database | Supabase Free | Seoul Nano, SSL 강제, CA·호스트 검증, Cloudtype outbound IPv4 세 개만 허용 |

Web → same-origin proxy → Nest API → PostgreSQL 경로가 정상이다. API는 `TRUST_PROXY_HOPS=1`, exact CORS allowlist, 64 KiB body limit, 단일-replica in-memory rate limit을 사용한다.

현재 기능 플래그는 다음과 같다.

```env
AI_FEATURES_ENABLED=false
UPLOADS_ENABLED=false
EVIDENCE_EXECUTION_ENABLED=true
PUBLIC_PROOF_PROFILE_ENABLED=false
NEXT_PUBLIC_AI_FEATURES_ENABLED=false
NEXT_PUBLIC_REALTIME_ENABLED=false
NEXT_PUBLIC_EVIDENCE_EXECUTION_ENABLED=true
NEXT_PUBLIC_PROOF_PROFILE_ENABLED=false
NEXT_PUBLIC_OAUTH_ENABLED=false
```

## 완료된 출시 게이트

### 계정과 Evidence

- Resend 기반 회원가입·비밀번호 재설정 메일의 실제 전달을 확인했다.
- owner와 별도 reviewer 계정으로 로그인, reviewer 역할 부여, 감사 이벤트를 확인했다.
- GitHub App을 private 테스트 저장소 하나에만 설치하고 claim했다.
- owner → mission → PR → machine verification → 별도 reviewer 승인 흐름을 완료했다.
- owner 자기 승인 `403`, 실제 `pull_request/synchronize` 후 기존 승인 무효화, 새 head 재검증·재승인을 확인했다.
- PR #18의 인증 bootstrap race 수정은 병합·배포됐고 해당 PR의 CI, Browser E2E, Compose, Django AI, Vercel 검사가 성공했다.

### 데이터와 복구

- Supabase PostgreSQL `17.6.1.165`에서 custom-format export를 생성하고 같은 버전의 로컬 PostgreSQL에 restore했다.
- dump는 `341,786 bytes`, SHA-256 `9e098e1939ecfb9b91326be60dc1e80c273ade7fe0c914701ff75edefcc27e59`로 원격·로컬이 일치했다.
- migration 9개와 핵심 테이블 13개의 row count가 production과 restore에서 일치했다.
- 로컬 migration runner가 exit `0`으로 완료됐고 migration count 9개를 유지했다.
- 임시 PAT, JIT role, operator CIDR, dump, restore container와 credential artifact를 모두 제거했다.
- Cloudtype rollback/forward 후 약 45초/35초에 readiness가 복구됐고 최종 baseline artifact로 돌아왔다.
- Vercel rollback/forward 후 `/`, `/login`, `/api/health`, `/api/health/ready`가 모두 `200`이었고 production alias를 baseline으로 복구했다.
- Cloudtype 수동 stop/start 후 약 46초에 readiness가 복구됐고 DB-backed 응답 hash가 전후 동일했다.

### 장애·보안 증거

- API focused contract 77개와 production invalid-signature `401`, oversized webhook `413`을 확인했다.
- live Cloudtype 로그에서 Bearer, JWT, PostgreSQL URL, private key, Resend key, GitHub token, named secret assignment 패턴이 0건이었다.
- GitHub `pull_request.synchronize` delivery `60ab2820-a202-11f1-90ca-cda50e026ae7` redelivery가 `204`였고 backend row는 한 개, state는 `LOCAL_APPLIED`를 유지했다.
- production 일회용 계정으로 이메일 인증, 가입 `201`, refresh `200`, 삭제 `204`를 완료했다. 삭제 후 refresh, login, 기존 access token 사용은 모두 `401`이었다.

## 확인된 availability 실패

Cloudtype [Free Tier의 일일 중지 정책](https://www.cloudtype.io/ko/pricing)에 따른 실제 정기 중지를 외부 probe로 관찰했다.

- 2026-08-28 05:01 KST에 direct/public readiness가 `404`로 바뀌었고 외부 control endpoint는 `200`을 유지했다.
- outage 307,715 ms 시점에 5분 무인 복구 SLO가 실패했다.
- 15분 20초 동안 자동 복구가 없었고 최종 관찰 outage는 920,390 ms였다.
- 같은 artifact를 사람이 다시 시작한 뒤 readiness는 `404 → 503 → 502 → 200`으로 바뀌며 18.7초에 복구됐다.
- 복구 후 `/`, `/login`, `/api/health`, `/api/health/ready`가 모두 `200`이었다.

따라서 수동 start 성공은 availability gate를 충족하지 않는다. Cloudtype Free는 개인 서버 cutover 전 임시 fallback일 뿐 출시 가능한 상시 API가 아니다.

## 대체 provider 실증 결과

### Northflank Developer Sandbox

- Free project `jagalchi-api-smoke`를 US Central에 만들고 `gajaedev/jagalchi-platform`만 GitHub App에 연결했다.
- 서비스 생성 전 결제수단 등록에서 하나카드 3DS의 macOS 보안프로그램 감지가 반복 실패했다.
- 결제수단과 실행 서비스는 생성되지 않았다. Northflank project와 GitHub integration은 후속 정리 대상이다.

### Google Cloud Run

- project `jagalchi-api-smoke-0828-90a263`, 서울 `asia-northeast3`, Artifact Registry image를 만들었다.
- source SHA `dda40d181fa994e9b5c72e235c9e05ab942ea895`의 `linux/amd64` image를 push했다.
- Secret Manager에는 DB URL/CA와 smoke 전용 secret을 저장했고 로컬 전달 파일은 삭제했다.
- Cloud Run outbound IPv4가 `34.96.43.26`, `34.96.43.24`, `34.96.43.146`으로 revision마다 바뀌어 Supabase `/32` allowlist를 안정적으로 통과하지 못했다.
- 임시로 추가한 Supabase `/32` 두 개는 제거했고 원래 Cloudtype IPv4 세 개만 남은 것을 확인했다.
- 성공 revision과 사용자 트래픽은 없다. Google Cloud project, image, secrets, 실패 revision은 후속 정리 또는 다른 runtime 재사용 대상이다.

Cloud Run은 [고정 outbound 구성을 위해 VPC egress와 Cloud NAT를 사용](https://docs.cloud.google.com/run/docs/configuring/static-outbound-ip)해야 하므로 이번 zero-cost runtime으로 사용하지 않는다.

## 다음 실행 게이트: 개인 서버

사용자가 SSH 접근을 제공하면 다음 순서로 진행한다.

1. 서버 OS, CPU architecture, RAM, disk, Docker, outbound public IP와 CGNAT 여부를 읽기 전용으로 확인한다. 이 결과를 기준으로 서버별 명령과 rollback runbook을 확정한다.
2. cutover 시점의 최신 reviewed/pushed `main` SHA와 image digest를 고정하고 `services/api/Dockerfile`을 root build context로 배포한다.
3. CGNAT이거나 공유기 포트를 열지 않을 때는 Cloudflare Tunnel, 고정 public ingress와 직접 인증서 운영이 가능할 때는 Caddy를 사용한다. 어느 경우에도 컨테이너 `8080`은 외부에 직접 노출하지 않는다.
4. 서버의 고정 outbound `/32` 또는 IPv6 CIDR만 Supabase에 추가한다.
5. migration runner 단일 실행, `/api/health`, `/api/health/ready`, same-origin proxy, exact CORS를 확인한다.
6. 재부팅·컨테이너 재시작 후 5분 안에 direct와 same-origin readiness가 10초 간격으로 세 번 연속 `200`인지 확인한다. `/api/roadmaps/public?page=1&size=10` 응답 hash로 DB-backed 불변성을 확인한다.
7. 로그 redaction, resource ceiling, backup/export 경로를 기록한다.
8. 새 API가 검증된 뒤 Vercel `API_ORIGIN`을 바꾸고 Cloudtype를 rollback fallback으로 유지한다. 실패하면 이전 Cloudtype origin으로 즉시 복구한다.

다음 조건이 모두 충족되기 전에는 alpha 초대를 열지 않는다.

- 개인 서버 readiness가 세 번 연속 `200`
- 재부팅 또는 process restart 후 5분 안에 사람 개입 없이 복구
- Supabase allowlist에 승인된 서버 CIDR와 기존 fallback CIDR만 존재
- Web same-origin proxy와 실제 계정/Evidence smoke 성공
- 기존 Cloudtype로 되돌리는 rollback 절차 확인

## 남아 있는 외부 리소스

후속 정리 전에 실제 대상과 의존성을 다시 확인한다. 자동 삭제하지 않는다.

- Northflank team/project `jagalchi-api-smoke`와 `gajaedev/jagalchi-platform` GitHub integration
- Google Cloud project `jagalchi-api-smoke-0828-90a263`의 Artifact Registry, Secret Manager, 실패한 Cloud Run service/revisions
- 현재 production Cloudtype service와 Supabase의 원래 Cloudtype outbound IPv4 세 개

## 비밀 없는 증거

- [Production disposable account lifecycle](https://github.com/gajaedev/jagalchi-platform/issues/13#issuecomment-5440503148)
- [Provider와 recovery 확인](https://github.com/gajaedev/jagalchi-platform/issues/13#issuecomment-5440770744)
- [Supabase export/local restore](https://github.com/gajaedev/jagalchi-platform/issues/13#issuecomment-5441214484)
- [GitHub App redelivery](https://github.com/gajaedev/jagalchi-platform/issues/13#issuecomment-5441532169)
