import {
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CareerEvidence,
  CareerEvidenceStatus,
  CareerTarget,
  ProofCriterion,
  ProofCriterionType,
  ProofMission,
  ProofProfile,
  ProofProfileState,
  ProofReview,
  PublishedProof,
} from "../career/career.entities";
import {
  GithubInstallation,
  GithubInstallationClaimAttempt,
  GithubInstallationRepository,
  GithubWebhookDelivery,
} from "../github/github.entities";
import {
  OAuthIdentity,
  OAuthProvider,
  RefreshSession,
  User,
  UserStatus,
} from "./auth.entities";
import { AuthService } from "./auth.service";

describe("AuthService", () => {
  afterEach(() => vi.unstubAllGlobals());

  const createSubject = () => {
    let savedUser: Record<string, unknown> | null = null;
    const users = {
      exists: vi.fn().mockResolvedValue(false),
      create: vi.fn((value) => value),
      save: vi.fn(async (value) => {
        savedUser = { id: "user-1", ...value };
        return savedUser;
      }),
      findOne: vi.fn(async () => savedUser),
    };
    const sessions = {
      create: vi.fn((value) => ({ id: "session-1", ...value })),
      save: vi.fn(async (value) => value),
    };
    const attempts = {
      create: vi.fn((value) => value),
      save: vi.fn(async (value) => ({ id: "attempt-1", ...value })),
    };
    let verificationChallenge: Record<string, unknown> | null = null;
    const verificationChallenges = {
      create: vi.fn((value) => value),
      save: vi.fn(async (value) => {
        verificationChallenge = {
          id: "challenge-1",
          createdAt: new Date(),
          ...value,
        };
        return verificationChallenge;
      }),
      findOne: vi.fn(async () => verificationChallenge),
      delete: vi.fn(),
    };
    const configValues: Record<string, string> = {
      WEB_APP_URL: "https://jagalchi.dev",
      PUBLIC_API_URL: "https://api.jagalchi.dev",
      OAUTH_ENABLED: "true",
      OAUTH_GOOGLE_CLIENT_ID: "google-client",
      VERIFICATION_CODE_SECRET: "verification-code-secret-with-32-characters",
      RESEND_API_KEY: "re_test_delivery_key",
      EMAIL_FROM: "Jagalchi <no-reply@mail.jagalchi.justn.me>",
    };
    const config = {
      get: vi.fn((key: string) => configValues[key]),
      getOrThrow: vi.fn((key: string) => {
        const value = configValues[key];
        if (!value) throw new Error(`Missing ${key}`);
        return value;
      }),
    };
    const jwt = {
      signAsync: vi.fn().mockResolvedValue("access-token"),
      verifyAsync: vi.fn().mockResolvedValue({
        sub: "user@example.com",
        type: "registration-proof",
      }),
    };
    const tickets = { openAccount: vi.fn().mockResolvedValue({ balance: 30 }) };
    const dataSource = { transaction: vi.fn() };
    const service = new AuthService(
      config as never,
      jwt as never,
      dataSource as never,
      tickets as never,
      users as never,
      {} as never,
      sessions as never,
      attempts as never,
      {} as never,
      verificationChallenges as never,
    );
    return {
      attempts,
      config,
      configValues,
      dataSource,
      service,
      sessions,
      tickets,
      users,
      verificationChallenges,
    };
  };

  it("hashes a new password and opens the approved signup ticket account", async () => {
    const subject = createSubject();
    const result = await subject.service.register({
      email: " USER@Example.com ",
      name: "민지",
      password: "strong-password",
      registrationProof: "registration-proof-token-value-1234",
    });

    expect(result.accessToken).toBe("access-token");
    expect(result.refreshToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(subject.users.save).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "user@example.com",
        passwordHash: expect.stringMatching(/^scrypt\$/),
      }),
    );
    expect(subject.tickets.openAccount).toHaveBeenCalledWith("user-1");
    expect(subject.sessions.save).toHaveBeenCalledOnce();
  });

  it("does not accept a wrong password for an existing account", async () => {
    const subject = createSubject();
    await subject.service.register({
      email: "user@example.com",
      name: "민지",
      password: "strong-password",
      registrationProof: "registration-proof-token-value-1234",
    });
    await expect(
      subject.service.login({
        email: "user@example.com",
        password: "wrong-password",
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("creates a stateful PKCE Google authorization request", async () => {
    const subject = createSubject();
    const url = new URL(await subject.service.startOAuth(OAuthProvider.Google));

    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("client_id")).toBe("google-client");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://api.jagalchi.dev/api/users/auth/callback/google",
    );
    expect(subject.attempts.save).toHaveBeenCalledWith(
      expect.objectContaining({
        returnUrl: "https://jagalchi.dev/auth/callback",
        provider: OAuthProvider.Google,
      }),
    );
  });

  it("fails closed before creating an OAuth attempt when OAuth is disabled", async () => {
    const subject = createSubject();
    subject.configValues.OAUTH_ENABLED = "false";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      subject.service.startOAuth(OAuthProvider.Google),
    ).rejects.toMatchObject({
      response: {
        code: "OAUTH_DISABLED",
        message: "OAuth is unavailable",
      },
    });

    expect(subject.attempts.save).not.toHaveBeenCalled();
    expect(subject.dataSource.transaction).not.toHaveBeenCalled();
    expect(subject.config.getOrThrow).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["the flag is missing", undefined],
    ["the flag is malformed", "enabled"],
  ])("fails closed when %s", async (_description, value) => {
    const subject = createSubject();
    if (value === undefined) {
      delete subject.configValues.OAUTH_ENABLED;
    } else {
      subject.configValues.OAUTH_ENABLED = value;
    }

    await expect(
      subject.service.startOAuth(OAuthProvider.Google),
    ).rejects.toMatchObject({
      response: {
        code: "OAUTH_DISABLED",
        message: "OAuth is unavailable",
      },
    });

    expect(subject.attempts.save).not.toHaveBeenCalled();
    expect(subject.dataSource.transaction).not.toHaveBeenCalled();
  });

  it("fails closed before consuming OAuth state or fetching a provider profile when OAuth is disabled", async () => {
    const subject = createSubject();
    subject.configValues.OAUTH_ENABLED = "false";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      subject.service.completeOAuth(
        OAuthProvider.Google,
        "provider-code",
        "oauth-state",
      ),
    ).rejects.toMatchObject({
      response: {
        code: "OAUTH_DISABLED",
        message: "OAuth is unavailable",
      },
    });

    expect(subject.attempts.save).not.toHaveBeenCalled();
    expect(subject.dataSource.transaction).not.toHaveBeenCalled();
    expect(subject.config.getOrThrow).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed before consuming an OAuth grant when OAuth is disabled", async () => {
    const subject = createSubject();
    subject.configValues.OAUTH_ENABLED = "false";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      subject.service.exchangeOAuthGrant("oauth-grant"),
    ).rejects.toMatchObject({
      response: {
        code: "OAUTH_DISABLED",
        message: "OAuth is unavailable",
      },
    });

    expect(subject.dataSource.transaction).not.toHaveBeenCalled();
    expect(subject.config.getOrThrow).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends and verifies a one-time registration code without returning it to clients", async () => {
    const subject = createSubject();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );

    await subject.service.sendEmailVerification({ email: "USER@example.com" });
    const [url, request] = vi.mocked(fetch).mock.calls[0] ?? [];
    const delivery = JSON.parse(String(request?.body)) as {
      from: string;
      to: string[];
      subject: string;
      text: string;
      html: string;
    };
    const code = delivery.text.match(/\b(\d{6})\b/)?.[1];
    expect(url).toBe("https://api.resend.com/emails");
    expect(request?.headers).toEqual(
      expect.objectContaining({
        authorization: "Bearer re_test_delivery_key",
        "content-type": "application/json",
        "idempotency-key": "email-challenge-challenge-1",
      }),
    );
    expect(delivery).toEqual(
      expect.objectContaining({
        from: "Jagalchi <no-reply@mail.jagalchi.justn.me>",
        to: ["user@example.com"],
        subject: "[자갈치] 이메일 인증번호",
      }),
    );
    expect(code).toMatch(/^[0-9]{6}$/);
    expect(delivery.html).toContain(code);

    await expect(
      subject.service.verifyEmail({
        email: "user@example.com",
        code: code!,
      }),
    ).resolves.toEqual({ registrationProof: "access-token" });
    expect(subject.verificationChallenges.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ consumedAt: expect.any(Date) }),
    );
  });

  it("fails closed without making a request when development email delivery is unconfigured", async () => {
    const subject = createSubject();
    delete subject.configValues.RESEND_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      subject.service.sendEmailVerification({ email: "user@example.com" }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(subject.verificationChallenges.delete).toHaveBeenCalledWith({
      id: "challenge-1",
    });
  });

  it("fails closed and removes the challenge when Resend rejects delivery", async () => {
    const subject = createSubject();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 429 })),
    );

    await expect(
      subject.service.sendEmailVerification({ email: "user@example.com" }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(subject.verificationChallenges.delete).toHaveBeenCalledWith({
      id: "challenge-1",
    });
  });

  it("does not retry and removes the challenge when Resend times out", async () => {
    const subject = createSubject();
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new DOMException("Timed out", "TimeoutError"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      subject.service.sendEmailVerification({ email: "user@example.com" }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(subject.verificationChallenges.delete).toHaveBeenCalledWith({
      id: "challenge-1",
    });
  });

  it("sends a distinct password-reset message only for registered users", async () => {
    const subject = createSubject();
    subject.users.exists.mockResolvedValue(true);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
    );

    await subject.service.sendPasswordReset({ email: "user@example.com" });

    const request = vi.mocked(fetch).mock.calls[0]?.[1];
    const delivery = JSON.parse(String(request?.body)) as {
      subject: string;
      text: string;
    };
    expect(delivery.subject).toBe("[자갈치] 비밀번호 재설정 인증번호");
    expect(delivery.text).toMatch(/비밀번호 재설정 인증번호는 \d{6}입니다/);
  });

  it("redacts all authored Career data and disables the public profile on account deletion", async () => {
    const criteriaRows = [
      { type: ProofCriterionType.MergedPr, config: { private: "prose" } },
      {
        type: ProofCriterionType.BaseBranch,
        config: { branch: "private-branch" },
      },
      { type: ProofCriterionType.ChangedPath, config: { glob: "private/**" } },
      {
        type: ProofCriterionType.NamedCheck,
        config: { context: "Private check" },
      },
      {
        type: ProofCriterionType.HumanCheck,
        config: { label: "Private human label" },
      },
    ];
    const publicationRows = [
      {
        state: "ACTIVE",
        validUntil: new Date("2099-01-01"),
        snapshot: { title: "Private title", summary: "Private summary" },
      },
    ];
    const evidenceRows = [
      {
        userId: "user-1",
        title: "Private evidence",
        url: "https://private.example/evidence",
        description: "Private description",
        status: CareerEvidenceStatus.Verified,
        reviewerId: "reviewer-2",
        reviewNote: "Reviewer-authored private note",
      },
      {
        userId: "owner-2",
        title: "Retained evidence",
        url: "https://example.test/evidence",
        description: "Retained description",
        status: CareerEvidenceStatus.Verified,
        reviewerId: "user-1",
        reviewNote: "Deleted reviewer private note",
      },
    ];
    const reviewRows = [
      {
        missionId: "mission-1",
        ownerUserId: "user-1",
        reviewerId: "reviewer-2",
        decision: "APPROVED",
        note: "Private review of deleted owner",
      },
      {
        missionId: "mission-2",
        ownerUserId: "owner-2",
        reviewerId: "user-1",
        decision: "APPROVED",
        note: "Deleted reviewer private note",
      },
    ];
    const claimRows = [{ userId: "user-1", stateHash: "private-state-hash" }];
    const installationRows = [
      {
        id: "installation-record-id",
        ownerUserId: "user-1",
        githubInstallationId: "9007199254740995",
        githubAccountId: "9007199254740997",
      },
    ];
    const installationRepositoryRows = [
      {
        installationId: "installation-record-id",
        githubRepositoryId: "9007199254740993",
        fullName: "private/repository",
      },
    ];
    const deliveryRows = [
      {
        deliveryId: "5b239a61-b06a-4f54-bdc0-91c1dca91d0e",
        eventName: "pull_request",
        installationId: "installation-record-id",
        githubInstallationId: "9007199254740995",
        githubRepositoryId: "9007199254740993",
        pullNumber: 17,
        headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        state: "LOCAL_APPLIED",
        errorCode: "provider-private-error",
        receivedAt: new Date("2026-08-25T00:00:00Z"),
        reconciledAt: null,
      },
      {
        deliveryId: "9b8c52b0-e319-4cc8-9b19-128a3324d066",
        eventName: "installation",
        installationId: null,
        githubInstallationId: "9007199254740995",
        githubRepositoryId: null,
        pullNumber: null,
        headSha: null,
        state: "RECONCILED",
        errorCode: null,
        receivedAt: new Date("2026-08-25T00:01:00Z"),
        reconciledAt: new Date("2026-08-25T00:01:01Z"),
      },
    ];
    const repositories = new Map<
      unknown,
      Record<string, ReturnType<typeof vi.fn>>
    >();
    const repository = (
      entity: unknown,
      overrides: Record<string, ReturnType<typeof vi.fn>> = {},
    ) => {
      const value = {
        delete: vi.fn(),
        find: vi.fn().mockResolvedValue([]),
        findOne: vi.fn(),
        save: vi.fn(async (rows) => rows),
        update: vi.fn(),
        ...overrides,
      };
      repositories.set(entity, value);
      return value;
    };
    const users = repository(User, {
      findOne: vi.fn().mockResolvedValue({
        id: "user-1",
        email: "private@example.test",
        name: "Private Name",
        passwordHash: "private-password-hash",
        bio: "Private bio",
        profileImageUrl: "https://private.example/avatar",
        externalLinks: { portfolio: "https://private.example" },
      }),
    });
    repository(OAuthIdentity);
    repository(RefreshSession);
    const claims = repository(GithubInstallationClaimAttempt, {
      delete: vi.fn(async ({ userId }: { userId: string }) => {
        claimRows.splice(
          0,
          claimRows.length,
          ...claimRows.filter((row) => row.userId !== userId),
        );
      }),
    });
    repository(CareerTarget);
    const evidence = repository(CareerEvidence, {
      update: vi.fn(
        async (
          where: { userId?: string; reviewerId?: string },
          values: Record<string, unknown>,
        ) => {
          for (const row of evidenceRows) {
            if (where.userId && row.userId !== where.userId) continue;
            if (where.reviewerId && row.reviewerId !== where.reviewerId)
              continue;
            Object.assign(row, values);
          }
        },
      ),
    });
    const installations = repository(GithubInstallation, {
      find: vi.fn().mockResolvedValue(installationRows),
      delete: vi.fn(async ({ ownerUserId }: { ownerUserId: string }) => {
        installationRows.splice(
          0,
          installationRows.length,
          ...installationRows.filter((row) => row.ownerUserId !== ownerUserId),
        );
      }),
    });
    const installationRepositories = repository(GithubInstallationRepository, {
      find: vi.fn().mockResolvedValue(installationRepositoryRows),
      delete: vi.fn(async () => {
        installationRepositoryRows.splice(0);
      }),
    });
    const deliveries = repository(GithubWebhookDelivery, {
      find: vi.fn().mockResolvedValue(deliveryRows),
      update: vi.fn(async (_where, values) => {
        for (const row of deliveryRows) Object.assign(row, values);
      }),
    });
    const missions = repository(ProofMission, {
      find: vi.fn().mockResolvedValue([{ id: "mission-1" }]),
    });
    const criteria = repository(ProofCriterion, {
      find: vi.fn().mockResolvedValue(criteriaRows),
    });
    const publications = repository(PublishedProof, {
      find: vi.fn().mockResolvedValue(publicationRows),
    });
    const reviews = repository(ProofReview, {
      update: vi.fn(
        async (
          where: { missionId?: unknown; reviewerId?: string },
          values: Record<string, unknown>,
        ) => {
          for (const row of reviewRows) {
            if (where.missionId && row.missionId !== "mission-1") continue;
            if (where.reviewerId && row.reviewerId !== where.reviewerId)
              continue;
            Object.assign(row, values);
          }
        },
      ),
    });
    const profiles = repository(ProofProfile);
    const manager = {
      getRepository: vi.fn((entity: unknown) => repositories.get(entity)),
    };
    const dataSource = {
      transaction: vi.fn(
        async (work: (value: typeof manager) => Promise<void>) => work(manager),
      ),
    };
    const service = new AuthService(
      {} as never,
      {} as never,
      dataSource as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.deleteAccount("user-1");

    expect(users.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "user-1",
        status: UserStatus.Suspended,
        email: "user-1@deleted.invalid",
        name: "탈퇴한 사용자",
        passwordHash: null,
        bio: null,
        profileImageUrl: null,
        externalLinks: {},
      }),
    );
    expect(repositories.get(CareerTarget)?.update).toHaveBeenCalledWith(
      { userId: "user-1" },
      expect.objectContaining({
        company: "Archived",
        role: "Archived",
        postingUrl: null,
        requirements: "",
      }),
    );
    expect(evidence.update).toHaveBeenNthCalledWith(
      1,
      { userId: "user-1" },
      {
        title: "Archived evidence",
        url: "https://deleted.invalid/",
        description: "",
        reviewNote: null,
      },
    );
    expect(evidence.update).toHaveBeenNthCalledWith(
      2,
      { reviewerId: "user-1" },
      { reviewNote: null },
    );
    expect(criteria.save).toHaveBeenCalledWith([
      expect.objectContaining({ config: {} }),
      expect.objectContaining({ config: { branch: "redacted" } }),
      expect.objectContaining({ config: { glob: "redacted" } }),
      expect.objectContaining({ config: { context: "redacted" } }),
      expect.objectContaining({ config: { label: "Redacted criterion" } }),
    ]);
    expect(reviews.update).toHaveBeenCalledWith(
      expect.objectContaining({ missionId: expect.anything() }),
      { note: null },
    );
    expect(reviews.update).toHaveBeenCalledWith(
      { reviewerId: "user-1" },
      { note: null },
    );
    expect(publications.save).toHaveBeenCalledWith([
      expect.objectContaining({
        snapshot: { title: "Archived proof", summary: null },
      }),
    ]);
    expect(profiles.update).toHaveBeenCalledWith(
      { ownerUserId: "user-1" },
      {
        state: ProofProfileState.Disabled,
        displayName: "탈퇴한 사용자",
        summary: null,
      },
    );
    expect(claims.delete).toHaveBeenCalledWith({ userId: "user-1" });
    expect(deliveries.update).toHaveBeenCalledWith(
      { installationId: expect.anything() },
      {
        installationId: null,
        githubInstallationId: null,
        githubRepositoryId: null,
        pullNumber: null,
        headSha: null,
        errorCode: null,
      },
    );
    expect(deliveries.update).toHaveBeenCalledWith(
      { githubInstallationId: expect.anything() },
      expect.objectContaining({
        installationId: null,
        githubInstallationId: null,
        githubRepositoryId: null,
        pullNumber: null,
        headSha: null,
      }),
    );
    expect(installationRepositories.delete).toHaveBeenCalledWith({
      installationId: expect.anything(),
    });
    expect(installations.delete).toHaveBeenCalledWith({
      ownerUserId: "user-1",
    });
    expect(missions.update.mock.invocationCallOrder[0]).toBeLessThan(
      claims.delete.mock.invocationCallOrder[0],
    );
    expect(claimRows).toEqual([]);
    expect(installationRepositoryRows).toEqual([]);
    expect(installationRows).toEqual([]);
    expect(evidenceRows).toEqual([
      expect.objectContaining({
        userId: "user-1",
        title: "Archived evidence",
        url: "https://deleted.invalid/",
        description: "",
        reviewerId: "reviewer-2",
        reviewNote: null,
      }),
      expect.objectContaining({
        userId: "owner-2",
        reviewerId: "user-1",
        reviewNote: null,
      }),
    ]);
    expect(reviewRows).toEqual([
      expect.objectContaining({
        missionId: "mission-1",
        reviewerId: "reviewer-2",
        decision: "APPROVED",
        note: null,
      }),
      expect.objectContaining({
        missionId: "mission-2",
        reviewerId: "user-1",
        decision: "APPROVED",
        note: null,
      }),
    ]);
    expect(
      reviewRows
        .filter(({ decision }) => decision === "APPROVED")
        .every(({ ownerUserId, reviewerId }) => reviewerId !== ownerUserId),
    ).toBe(true);
    const redactedUser = users.save.mock.calls[0]?.[0];
    expect(evidenceRows[1]).toMatchObject({
      status: CareerEvidenceStatus.Verified,
      reviewerId: redactedUser.id,
    });
    expect(reviewRows[1]).toMatchObject({
      decision: "APPROVED",
      reviewerId: redactedUser.id,
    });
    const publicPayload = publicationRows.map(({ snapshot }) => snapshot);
    expect(JSON.stringify(publicPayload)).not.toContain("reviewerId");
    expect(JSON.stringify(publicPayload)).not.toContain(redactedUser.id);
    expect(
      JSON.stringify({
        user: redactedUser,
        evidenceRows,
        reviewRows,
      }),
    ).not.toContain("private@example.test");
    expect(
      JSON.stringify({
        user: redactedUser,
        evidenceRows,
        reviewRows,
      }),
    ).not.toContain("private note");
    expect(deliveryRows).toEqual([
      expect.objectContaining({
        deliveryId: "5b239a61-b06a-4f54-bdc0-91c1dca91d0e",
        eventName: "pull_request",
        installationId: null,
        githubInstallationId: null,
        githubRepositoryId: null,
        pullNumber: null,
        headSha: null,
        state: "LOCAL_APPLIED",
        errorCode: null,
        receivedAt: new Date("2026-08-25T00:00:00Z"),
        reconciledAt: null,
      }),
      expect.objectContaining({
        deliveryId: "9b8c52b0-e319-4cc8-9b19-128a3324d066",
        eventName: "installation",
        installationId: null,
        githubInstallationId: null,
        githubRepositoryId: null,
        pullNumber: null,
        headSha: null,
        state: "RECONCILED",
        errorCode: null,
        receivedAt: new Date("2026-08-25T00:01:00Z"),
        reconciledAt: new Date("2026-08-25T00:01:01Z"),
      }),
    ]);
  });

  it("propagates Career redaction failures from the account deletion transaction", async () => {
    const careerFailure = new Error("career redaction failed");
    const users = {
      findOne: vi.fn().mockResolvedValue({ id: "user-1" }),
      save: vi.fn(),
    };
    const evidence = {
      update: vi.fn().mockRejectedValue(careerFailure),
    };
    const generic = {
      delete: vi.fn(),
      update: vi.fn(),
    };
    const manager = {
      getRepository: vi.fn((entity: unknown) => {
        if (entity === User) return users;
        if (entity === CareerEvidence) return evidence;
        return generic;
      }),
    };
    const dataSource = {
      transaction: vi.fn(
        async (work: (value: typeof manager) => Promise<void>) => work(manager),
      ),
    };
    const service = new AuthService(
      {} as never,
      {} as never,
      dataSource as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.deleteAccount("user-1")).rejects.toBe(careerFailure);
    expect(dataSource.transaction).toHaveBeenCalledOnce();
    expect(manager.getRepository).not.toHaveBeenCalledWith(ProofProfile);
  });
});
