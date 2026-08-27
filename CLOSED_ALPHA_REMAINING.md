# Jagalchi Closed Alpha 남은 작업

기준 시각: 2026-08-27 14:34 KST  
기준 소스: `7ec4a8af0a59fe1e55f17c6c4df96634d9f65161`

이 문서는 인프라 생성 이후 실제 alpha 사용자를 받기 전에 남은 출시 게이트만 관리한다. 비밀값, 전체 데이터베이스 URL, 토큰, 개인 계정 정보는 기록하지 않는다. 상세 운영 증거는 GitHub Issue [#13](https://github.com/gajaedev/jagalchi-platform/issues/13)을 정본으로 사용한다.

## 현재 완료 상태

- Web: `https://jagalchi.justn.me`
- API: Cloudtype Free의 `jagalchi-api`
- Database: Supabase Free PostgreSQL, Seoul, Nano
- Web → Next same-origin proxy → Nest API → PostgreSQL 경로 정상
- `/api/health`, `/api/health/ready`, Web same-origin proxy 모두 `200`
- Supabase SSL enforcement 활성화
- Supabase root CA를 사용한 인증서·호스트 검증 활성화
- DB 네트워크를 Cloudtype outbound IPv4 세 개로 제한
- Cloudtype 단일 512 MB Free replica, Recreate, readiness Healthz 구성
- `TRUST_PROXY_HOPS=1` 검증 완료
- CORS, 64 KiB body limit, rate limit 검증 완료
- 저장소 Public 전환, GitHub secret scanning 및 push protection 활성화
- AI, Uploads, Evidence, Public Proof, Realtime, OAuth 비활성화

## 출시 차단 게이트

### 1. 계정 및 이메일 전달 방식 확정

현재 회원가입 검증 메일을 보낼 `EMAIL_DELIVERY_URL`과 `EMAIL_DELIVERY_TOKEN`이 없다. 아래 두 방식 중 하나를 확정해야 한다.

#### 방식 A — Free 이메일 전달 어댑터

- 무료 플랜에서 카드·자동 초과 과금이 없는 이메일 공급자 선택
- 기존 API 계약을 받는 전달 어댑터 구성:
  - 요청: Bearer 인증 `POST`
  - body: `{ to, template, variables: { code } }`
- 발신 도메인 DNS 검증
- Cloudtype에 `EMAIL_DELIVERY_URL`, `EMAIL_DELIVERY_TOKEN` 설치
- 정상 전달, 공급자 오류, timeout, 재시도 없는 fail-closed 동작 검증

#### 방식 B — 수동 alpha 계정 프로비저닝

- 공개 admin API를 만들지 않는다.
- 비밀번호와 역할을 안전하게 생성하는 운영 CLI를 추가하거나 검증한다.
- 비밀번호를 명령행 인자, shell history, 로그, Issue, 채팅에 남기지 않는다.
- owner와 reviewer가 첫 로그인 후 비밀번호를 교체할 수 있는 절차를 제공한다.

#### 필요한 사용자 입력

- owner 이메일 1개
- reviewer 이메일 1개
- 최대 5계정의 나머지 초대 이메일
- 방식 A 또는 B 선택

완료 기준:

- owner와 reviewer가 서로 다른 계정으로 로그인한다.
- reviewer는 아래 운영 CLI 또는 동등하게 감사 가능한 절차로 승격된다.

```bash
pnpm --filter @jagalchi/api user-role:manage -- \
  --operator <운영자-ID> grant REVIEWER <리뷰어-이메일>
```

### 2. GitHub App 운영 설정

기존 `Jagalchi Evidence Staging` GitHub App의 보호된 설정은 사용자 passkey/sudo 승인이 필요하다.

사용자 전용 단계:

- GitHub Developer Settings에서 passkey/sudo 승인
- App ID 확인
- 새 private key 생성 및 안전한 전달
- webhook secret 생성
- callback/setup URL과 webhook URL 저장
- 테스트 저장소에 App 설치 승인

자동화 단계:

- Cloudtype secret controls에 GitHub App 값 설치
- webhook URL을 새 API origin으로 설정
- 필요한 최소 repository permissions와 events만 유지
- generic throttle 예외와 256 KiB raw-body 제한 검증
- 잘못된 signature, replay delivery, oversized payload 거부 검증

완료 기준:

- owner가 GitHub App을 테스트 저장소 하나에만 설치한다.
- 설치 claim과 repository 선택이 다른 계정 또는 다른 저장소로 확장되지 않는다.

### 3. Closed Alpha 핵심 E2E

아래 순서를 실제 owner/reviewer 계정과 테스트 저장소에서 한 번 완주한다.

1. owner 로그인
2. GitHub App 설치 및 저장소 연결
3. mission 생성
4. PR 연결
5. webhook 자동 검증 수신
6. 별도 reviewer 승인
7. 승인 상태와 허용된 전환 확인
8. PR head 변경
9. 기존 승인 자동 무효화 확인
10. reviewer 재승인
11. owner와 reviewer의 권한 경계 확인

실패 조건:

- owner가 자기 작업을 reviewer로 승인할 수 있음
- PR 변경 후 기존 승인이 유지됨
- 다른 설치 또는 저장소의 webhook이 수락됨
- 비활성 기능이 DB write 또는 외부 호출을 수행함

### 4. 복구 및 rollback 증거

#### Supabase export/restore

- 운영 DB export 생성
- 별도 임시 PostgreSQL에 restore
- migration table과 핵심 row count 비교
- export 파일의 저장 위치, 보존 기간, 삭제 절차 기록
- 작업 중 임시로 허용한 operator IP가 있다면 즉시 제거

#### Cloudtype rollback

- 현재 정상 배포 ID 기록
- 이전 호환 artifact 또는 명시적 rollback artifact 준비
- Recreate 방식으로 rollback
- migration runner가 동시에 두 개 실행되지 않았음을 확인
- health/readiness와 DB row 보존 확인
- 정상 SHA로 forward recovery

#### Vercel rollback

- 현재 production deployment ID 기록
- 이전 배포로 rollback 또는 promote
- `/login`과 same-origin `/api/health` 확인
- 현재 정상 배포로 다시 promote
- DNS와 custom domain alias가 유지되는지 확인

#### Free Tier 일일 중지/재시작

- Cloudtype 일일 정지 또는 수동 stop/start 수행
- Supabase 데이터가 유지되는지 확인
- cold start 후 readiness 복구 시간 기록

완료 기준:

- export/restore, API rollback, Web rollback, stop/start 네 항목에 비밀 없는 관찰 결과가 Issue #13에 남는다.

## 사용자 초대 전 운영 점검

- [ ] Cloudtype와 Supabase 모두 ₩0이며 카드·자동 초과 과금이 없음
- [ ] Vercel Hobby 사용량과 custom domain 정상
- [ ] Cloudtype build/runtime/traffic 잔여 한도 확인
- [ ] Supabase 500 MB DB 한도와 연결 수 확인
- [ ] GitHub secret-scanning open alert 0건
- [ ] API liveness/readiness `200`
- [ ] Web `/login`과 same-origin proxy `200`
- [ ] exact CORS allowlist 유지
- [ ] `TRUST_PROXY_HOPS=1` 유지
- [ ] DB SSL enforcement와 CA 검증 유지
- [ ] DB 네트워크 제한에 Cloudtype outbound IP만 존재
- [ ] Recreate와 단일 replica 유지
- [ ] 이메일 또는 수동 계정 절차 검증
- [ ] GitHub App E2E 검증
- [ ] export/restore 및 rollback 검증

## 기능 활성화 순서

첫 사용자 초대 전까지 아래 값은 유지한다.

```env
AI_FEATURES_ENABLED=false
UPLOADS_ENABLED=false
EVIDENCE_EXECUTION_ENABLED=false
PUBLIC_PROOF_PROFILE_ENABLED=false
NEXT_PUBLIC_AI_FEATURES_ENABLED=false
NEXT_PUBLIC_REALTIME_ENABLED=false
NEXT_PUBLIC_EVIDENCE_EXECUTION_ENABLED=false
NEXT_PUBLIC_PROOF_PROFILE_ENABLED=false
NEXT_PUBLIC_OAUTH_ENABLED=false
```

핵심 E2E에 필요한 GitHub App 설정과 계정 경계가 검증된 뒤에만 Evidence Execution을 Web/API에서 동시에 활성화한다. Public Proof, AI, Uploads, Realtime, OAuth는 이번 closed alpha 범위에서 활성화하지 않는다.

## 최종 출시 조건

다음 조건을 모두 충족해야 최대 5계정을 초대한다.

- owner 1명과 별도 reviewer 1명이 로그인 가능
- GitHub App 테스트 저장소 1개 연결
- mission → PR → webhook → reviewer → 승인 무효화 E2E 성공
- export/restore 성공
- Cloudtype와 Vercel rollback 및 forward recovery 성공
- Issue #13의 해당 `pending`이 실제 식별자와 관찰 결과로 교체됨
- 유료 플랜, 카드 요구, 자동 초과 과금이 없음
