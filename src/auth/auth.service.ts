import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { InjectRepository } from "@nestjs/typeorm";
import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  randomInt,
  sign as cryptoSign,
  timingSafeEqual,
  verify as cryptoVerify,
  type JsonWebKey,
} from "node:crypto";
import { DataSource, ILike, In, IsNull, MoreThan, Repository } from "typeorm";
import { TicketsService } from "../tickets/tickets.service";
import { Follow } from "../social/entities/social.entities";
import {
  CareerEvidence,
  CareerTarget,
  CareerTargetStatus,
  ProofCriterion,
  ProofCriterionType,
  ProofMission,
  ProofMissionState,
  ProofProfile,
  ProofProfileState,
  ProofReview,
  PublishedProof,
  PublishedProofState,
} from "../career/career.entities";
import {
  GithubInstallation,
  GithubInstallationClaimAttempt,
  GithubInstallationRepository,
  GithubWebhookDelivery,
} from "../github/github.entities";
import {
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  SendEmailVerificationDto,
  VerifyEmailDto,
  UpdateProfileDto,
} from "./auth.dto";
import { hashPassword, verifyPassword } from "./password";
import {
  OAuthAttempt,
  OAuthIdentity,
  OAuthLoginGrant,
  OAuthProvider,
  RefreshSession,
  User,
  UserStatus,
  EmailVerificationChallenge,
  EmailChallengePurpose,
} from "./auth.entities";

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_DAYS = 30;
const OAUTH_ATTEMPT_MINUTES = 10;
const OAUTH_GRANT_MINUTES = 2;
const RESEND_EMAIL_API_URL = "https://api.resend.com/emails";

type VerificationEmailTemplate =
  "jagalchi-registration-code" | "jagalchi-password-reset-code";

function verificationEmailContent(
  template: VerificationEmailTemplate,
  code: string,
) {
  const registration = template === "jagalchi-registration-code";
  const subject = registration
    ? "[자갈치] 이메일 인증번호"
    : "[자갈치] 비밀번호 재설정 인증번호";
  const purpose = registration ? "회원가입" : "비밀번호 재설정";
  return {
    subject,
    text: `${purpose} 인증번호는 ${code}입니다. 인증번호는 10분 후 만료됩니다.`,
    html: `<!doctype html><html lang="ko"><body><h1>${purpose} 인증번호</h1><p>아래 인증번호를 자갈치 화면에 입력해주세요.</p><p style="font-size:32px;font-weight:700;letter-spacing:0.2em">${code}</p><p>인증번호는 10분 후 만료됩니다. 본인이 요청하지 않았다면 이 메일을 무시해주세요.</p></body></html>`,
  };
}

interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: Pick<User, "id" | "email" | "name" | "roles">;
}

interface ProviderProfile {
  id: string;
  email: string;
  name: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly dataSource: DataSource,
    @Inject(forwardRef(() => TicketsService))
    private readonly tickets: TicketsService,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(OAuthIdentity)
    private readonly identities: Repository<OAuthIdentity>,
    @InjectRepository(RefreshSession)
    private readonly sessions: Repository<RefreshSession>,
    @InjectRepository(OAuthAttempt)
    private readonly attempts: Repository<OAuthAttempt>,
    @InjectRepository(OAuthLoginGrant)
    private readonly grants: Repository<OAuthLoginGrant>,
    @InjectRepository(EmailVerificationChallenge)
    private readonly verificationChallenges: Repository<EmailVerificationChallenge>,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const email = this.normalizeEmail(dto.email);
    let proof: { sub?: string; type?: string };
    try {
      proof = await this.jwt.verifyAsync<{ sub?: string; type?: string }>(
        dto.registrationProof,
      );
    } catch {
      throw new UnauthorizedException("Email verification proof is not valid");
    }
    if (proof.type !== "registration-proof" || proof.sub !== email) {
      throw new UnauthorizedException(
        "Email verification proof does not match",
      );
    }
    if (await this.users.exists({ where: { email } })) {
      throw new ConflictException("Email is already registered");
    }
    const user = await this.users.save(
      this.users.create({
        email,
        name: dto.name.trim(),
        passwordHash: await hashPassword(dto.password),
        roles: ["USER"],
        status: UserStatus.Active,
      }),
    );
    await this.tickets.openAccount(user.id);
    return this.issueSession(user);
  }

  async sendEmailVerification(dto: SendEmailVerificationDto): Promise<void> {
    await this.sendEmailChallenge(
      dto.email,
      EmailChallengePurpose.Registration,
      "jagalchi-registration-code",
    );
  }

  async verifyEmail(
    dto: VerifyEmailDto,
  ): Promise<{ registrationProof: string }> {
    const registrationProof = await this.verifyEmailChallenge(
      dto,
      EmailChallengePurpose.Registration,
      "registration-proof",
    );
    return { registrationProof };
  }

  async sendPasswordReset(dto: SendEmailVerificationDto): Promise<void> {
    const email = this.normalizeEmail(dto.email);
    if (!(await this.users.exists({ where: { email } }))) return;
    await this.sendEmailChallenge(
      email,
      EmailChallengePurpose.PasswordReset,
      "jagalchi-password-reset-code",
    );
  }

  async verifyPasswordReset(
    dto: VerifyEmailDto,
  ): Promise<{ resetProof: string }> {
    const resetProof = await this.verifyEmailChallenge(
      dto,
      EmailChallengePurpose.PasswordReset,
      "password-reset-proof",
    );
    return { resetProof };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const email = this.normalizeEmail(dto.email);
    let proof: { sub?: string; type?: string; jti?: string };
    try {
      proof = await this.jwt.verifyAsync<{
        sub?: string;
        type?: string;
        jti?: string;
      }>(dto.resetProof);
    } catch {
      throw new UnauthorizedException("Password reset proof is not valid");
    }
    if (
      proof.type !== "password-reset-proof" ||
      proof.sub !== email ||
      typeof proof.jti !== "string"
    ) {
      throw new UnauthorizedException("Password reset proof does not match");
    }
    await this.dataSource.transaction(async (manager) => {
      const challenges = manager.getRepository(EmailVerificationChallenge);
      const challenge = await challenges.findOne({
        where: {
          id: proof.jti,
          email,
          purpose: EmailChallengePurpose.PasswordReset,
          proofUsedAt: IsNull(),
        },
        lock: { mode: "pessimistic_write" },
      });
      if (!challenge?.consumedAt) {
        throw new UnauthorizedException(
          "Password reset proof was already used",
        );
      }
      const users = manager.getRepository(User);
      const user = await users.findOne({ where: { email } });
      if (!user)
        throw new UnauthorizedException("Password reset proof is not valid");
      user.passwordHash = await hashPassword(dto.newPassword);
      challenge.proofUsedAt = new Date();
      await users.save(user);
      await challenges.save(challenge);
      await manager
        .getRepository(RefreshSession)
        .update(
          { userId: user.id, revokedAt: IsNull() },
          { revokedAt: new Date() },
        );
    });
  }

  private async sendEmailChallenge(
    rawEmail: string,
    purpose: EmailChallengePurpose,
    template: VerificationEmailTemplate,
  ): Promise<void> {
    const email = this.normalizeEmail(rawEmail);
    const recent = await this.verificationChallenges.findOne({
      where: { email, purpose },
      order: { createdAt: "DESC" },
    });
    if (recent && recent.createdAt.getTime() > Date.now() - 60_000) {
      throw new HttpException(
        "Wait before requesting another code",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const challenge = await this.verificationChallenges.save(
      this.verificationChallenges.create({
        email,
        purpose,
        codeHash: this.hashVerificationCode(email, code),
        attempts: 0,
        expiresAt: new Date(Date.now() + 10 * 60_000),
        consumedAt: null,
        proofUsedAt: null,
      }),
    );
    try {
      const resendApiKey = this.config.get<string>("RESEND_API_KEY")?.trim();
      const emailFrom = this.config.get<string>("EMAIL_FROM")?.trim();
      if (!resendApiKey || !emailFrom) {
        throw new Error("Email delivery is not configured");
      }
      const content = verificationEmailContent(template, code);
      const response = await fetch(RESEND_EMAIL_API_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${resendApiKey}`,
          "content-type": "application/json",
          "idempotency-key": `email-challenge-${challenge.id}`,
        },
        body: JSON.stringify({
          from: emailFrom,
          to: [email],
          subject: content.subject,
          text: content.text,
          html: content.html,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok)
        throw new Error(`Email delivery returned ${response.status}`);
    } catch {
      await this.verificationChallenges.delete({ id: challenge.id });
      throw new ServiceUnavailableException(
        "Verification email could not be sent",
      );
    }
  }

  private async verifyEmailChallenge(
    dto: VerifyEmailDto,
    purpose: EmailChallengePurpose,
    proofType: "registration-proof" | "password-reset-proof",
  ): Promise<string> {
    const email = this.normalizeEmail(dto.email);
    const challenge = await this.verificationChallenges.findOne({
      where: {
        email,
        purpose,
        consumedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
      order: { createdAt: "DESC" },
    });
    if (!challenge || challenge.attempts >= 5) {
      throw new BadRequestException(
        "Verification code is expired or unavailable",
      );
    }
    challenge.attempts += 1;
    const expected = Buffer.from(challenge.codeHash, "hex");
    const actual = Buffer.from(
      this.hashVerificationCode(email, dto.code),
      "hex",
    );
    if (
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    ) {
      await this.verificationChallenges.save(challenge);
      throw new BadRequestException("Verification code is not correct");
    }
    challenge.consumedAt = new Date();
    await this.verificationChallenges.save(challenge);
    return this.jwt.signAsync(
      { sub: email, type: proofType, jti: challenge.id },
      { expiresIn: "15m" },
    );
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.users.findOne({
      where: { email: this.normalizeEmail(dto.email) },
    });
    if (
      !user ||
      !user.passwordHash ||
      user.status !== UserStatus.Active ||
      !(await verifyPassword(dto.password, user.passwordHash))
    ) {
      throw new UnauthorizedException("Invalid credentials");
    }
    return this.issueSession(user);
  }

  async getProfileByName(name: string) {
    const user = await this.users.findOne({
      where: { name, status: UserStatus.Active },
    });
    if (!user) throw new UnauthorizedException("User profile is not available");
    const follows = this.dataSource.getRepository(Follow);
    const [followersCount, followingCount] = await Promise.all([
      follows.count({ where: { followeeId: user.id } }),
      follows.count({ where: { followerId: user.id } }),
    ]);
    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        bio: user.bio,
        profileImageUrl: user.profileImageUrl,
        externalLinks: user.externalLinks,
        isFollowed: false,
        stats: { followersCount, followingCount },
      },
      streak: { currentStreak: 0, activities: [] },
    };
  }

  async searchUsers(query: string) {
    const users = await this.users.find({
      where: {
        name: ILike(`%${query.trim().replace(/[%_]/g, "\\$&")}%`),
        status: UserStatus.Active,
      },
      order: { name: "ASC" },
      take: 20,
    });
    return users.map((user) => ({
      id: user.id,
      name: user.name,
      bio: user.bio,
      profileImageUrl: user.profileImageUrl,
    }));
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.users.findOne({
      where: { id: userId, status: UserStatus.Active },
    });
    if (!user) throw new UnauthorizedException("User is not active");
    if (dto.name !== undefined) user.name = dto.name.trim();
    if (dto.bio !== undefined) user.bio = dto.bio.trim() || null;
    if (dto.profileImageUrl !== undefined) {
      user.profileImageUrl = dto.profileImageUrl || null;
    }
    if (dto.externalLinks !== undefined) {
      const entries = Object.entries(dto.externalLinks);
      if (entries.length > 5)
        throw new BadRequestException("At most five links are allowed");
      const links: Record<string, string> = {};
      for (const [label, rawUrl] of entries) {
        const normalizedLabel = label.trim();
        if (
          !normalizedLabel ||
          normalizedLabel.length > 40 ||
          typeof rawUrl !== "string"
        ) {
          throw new BadRequestException("Profile link is not valid");
        }
        let url: URL;
        try {
          url = new URL(rawUrl);
        } catch {
          throw new BadRequestException("Profile link is not valid");
        }
        if (!["http:", "https:"].includes(url.protocol)) {
          throw new BadRequestException("Profile links must use HTTP or HTTPS");
        }
        links[normalizedLabel] = url.toString();
      }
      user.externalLinks = links;
    }
    const saved = await this.users.save(user);
    return {
      id: saved.id,
      name: saved.name,
      bio: saved.bio,
      profileImageUrl: saved.profileImageUrl,
      externalLinks: saved.externalLinks,
    };
  }

  async deleteAccount(userId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const now = new Date();
      const users = manager.getRepository(User);
      const user = await users.findOne({
        where: { id: userId },
        lock: { mode: "pessimistic_write" },
      });
      if (!user) return;
      user.status = UserStatus.Suspended;
      user.email = `${user.id}@deleted.invalid`;
      user.name = "탈퇴한 사용자";
      user.passwordHash = null;
      user.bio = null;
      user.profileImageUrl = null;
      user.externalLinks = {};
      await users.save(user);
      await manager.getRepository(OAuthIdentity).delete({ userId });
      await manager
        .getRepository(RefreshSession)
        .update({ userId, revokedAt: IsNull() }, { revokedAt: now });
      await manager.getRepository(CareerTarget).update(
        { userId },
        {
          company: "Archived",
          role: "Archived",
          postingUrl: null,
          requirements: "",
          status: CareerTargetStatus.Archived,
        },
      );
      const evidence = manager.getRepository(CareerEvidence);
      await evidence.update(
        { userId },
        {
          title: "Archived evidence",
          url: "https://deleted.invalid/",
          description: "",
          reviewNote: null,
        },
      );
      await evidence.update({ reviewerId: userId }, { reviewNote: null });

      const missions = manager.getRepository(ProofMission);
      const ownedMissions = await missions.find({
        where: { ownerUserId: userId },
        select: { id: true },
      });
      const missionIds = ownedMissions.map(({ id }) => id);
      if (missionIds.length > 0) {
        const criteria = manager.getRepository(ProofCriterion);
        const ownedCriteria = await criteria.find({
          where: { missionId: In(missionIds) },
        });
        for (const criterion of ownedCriteria) {
          switch (criterion.type) {
            case ProofCriterionType.MergedPr:
              criterion.config = {};
              break;
            case ProofCriterionType.BaseBranch:
              criterion.config = { branch: "redacted" };
              break;
            case ProofCriterionType.ChangedPath:
              criterion.config = { glob: "redacted" };
              break;
            case ProofCriterionType.NamedCheck:
              criterion.config = { context: "redacted" };
              break;
            case ProofCriterionType.HumanCheck:
              criterion.config = { label: "Redacted criterion" };
              break;
          }
        }
        await criteria.save(ownedCriteria);

        const publications = manager.getRepository(PublishedProof);
        const ownedPublications = await publications.find({
          where: { missionId: In(missionIds) },
        });
        for (const publication of ownedPublications) {
          publication.state = PublishedProofState.Unpublished;
          publication.validUntil = now;
          publication.snapshot = {
            ...publication.snapshot,
            title: "Archived proof",
            summary: null,
          };
        }
        await publications.save(ownedPublications);
        await manager
          .getRepository(ProofReview)
          .update({ missionId: In(missionIds) }, { note: null });
        await missions.update(
          { ownerUserId: userId },
          {
            state: ProofMissionState.Archived,
            currentVerificationRunId: null,
            currentReviewId: null,
            title: "Archived proof mission",
            summary: null,
            installationId: null,
            githubRepositoryId: null,
            pullNumber: null,
            repositoryName: null,
            repositoryPrivate: null,
            pullTitle: null,
            pullUrl: null,
          },
        );
      }

      await manager
        .getRepository(GithubInstallationClaimAttempt)
        .delete({ userId });
      const installations = manager.getRepository(GithubInstallation);
      const ownedInstallations = await installations.find({
        where: { ownerUserId: userId },
        select: { id: true, githubInstallationId: true },
      });
      const installationIds = ownedInstallations.map(({ id }) => id);
      const githubInstallationIds = ownedInstallations.map(
        ({ githubInstallationId }) => githubInstallationId,
      );
      if (installationIds.length > 0) {
        const deliveries = manager.getRepository(GithubWebhookDelivery);
        const redactedDelivery = {
          installationId: null,
          githubInstallationId: null,
          githubRepositoryId: null,
          pullNumber: null,
          headSha: null,
          errorCode: null,
        };
        await deliveries.update(
          { installationId: In(installationIds) },
          redactedDelivery,
        );
        await deliveries.update(
          { githubInstallationId: In(githubInstallationIds) },
          redactedDelivery,
        );
        await manager.getRepository(GithubInstallationRepository).delete({
          installationId: In(installationIds),
        });
        await installations.delete({ ownerUserId: userId });
      }
      await manager
        .getRepository(ProofReview)
        .update({ reviewerId: userId }, { note: null });
      await manager.getRepository(ProofProfile).update(
        { ownerUserId: userId },
        {
          state: ProofProfileState.Disabled,
          displayName: "탈퇴한 사용자",
          summary: null,
        },
      );
    });
  }

  async refresh(rawToken: string): Promise<AuthResult> {
    const tokenHash = this.hashToken(rawToken);
    return this.dataSource.transaction(async (manager) => {
      const sessions = manager.getRepository(RefreshSession);
      const session = await sessions.findOne({
        where: {
          tokenHash,
          revokedAt: IsNull(),
          expiresAt: MoreThan(new Date()),
        },
        lock: { mode: "pessimistic_write" },
      });
      if (!session)
        throw new UnauthorizedException("Refresh session is not valid");
      const user = await manager.getRepository(User).findOne({
        where: { id: session.userId, status: UserStatus.Active },
      });
      if (!user) throw new UnauthorizedException("User is not active");

      session.revokedAt = new Date();
      const next = this.createRefreshSession(sessions, user.id);
      await sessions.save(next.session);
      session.replacedById = next.session.id;
      await sessions.save(session);
      return this.buildAuthResult(user, next.rawToken);
    });
  }

  async revoke(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    await this.sessions.update(
      { tokenHash: this.hashToken(rawToken), revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  async startOAuth(
    provider: OAuthProvider,
    requestedReturnUrl?: string,
  ): Promise<string> {
    this.assertOAuthEnabled(provider);
    const returnUrl = this.validateReturnUrl(requestedReturnUrl);
    const state = randomBytes(32).toString("hex");
    const nonce = randomBytes(24).toString("hex");
    const codeVerifier = randomBytes(48).toString("base64url");
    await this.attempts.save(
      this.attempts.create({
        state,
        nonce,
        codeVerifier,
        provider,
        returnUrl,
        expiresAt: new Date(Date.now() + OAUTH_ATTEMPT_MINUTES * 60_000),
        consumedAt: null,
      }),
    );

    const redirectUri = this.oauthCallbackUrl(provider);
    const challenge = createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");
    const clientId = this.providerClientId(provider);
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    if (provider === OAuthProvider.Google) {
      params.set("scope", "openid email profile");
      return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    }
    if (provider === OAuthProvider.Github) {
      params.delete("nonce");
      params.set("scope", "read:user user:email");
      return `https://github.com/login/oauth/authorize?${params}`;
    }
    params.set("scope", "name email");
    params.set("response_mode", "form_post");
    return `https://appleid.apple.com/auth/authorize?${params}`;
  }

  async completeOAuth(
    provider: OAuthProvider,
    code: string,
    state: string,
  ): Promise<string> {
    this.assertOAuthEnabled(provider);
    const attempt = await this.dataSource.transaction(async (manager) => {
      const attempts = manager.getRepository(OAuthAttempt);
      const current = await attempts.findOne({
        where: {
          state,
          provider,
          consumedAt: IsNull(),
          expiresAt: MoreThan(new Date()),
        },
        lock: { mode: "pessimistic_write" },
      });
      if (!current) throw new UnauthorizedException("OAuth state is not valid");
      current.consumedAt = new Date();
      return attempts.save(current);
    });

    const profile = await this.fetchProviderProfile(provider, code, attempt);
    const user = await this.findOrCreateOAuthUser(provider, profile);
    const rawGrant = randomBytes(32).toString("base64url");
    await this.grants.save(
      this.grants.create({
        userId: user.id,
        codeHash: this.hashToken(rawGrant),
        expiresAt: new Date(Date.now() + OAUTH_GRANT_MINUTES * 60_000),
        consumedAt: null,
      }),
    );
    const redirect = new URL(attempt.returnUrl);
    redirect.searchParams.set("code", rawGrant);
    return redirect.toString();
  }

  async exchangeOAuthGrant(rawCode: string): Promise<AuthResult> {
    this.assertOAuthEnabled();
    const user = await this.dataSource.transaction(async (manager) => {
      const grants = manager.getRepository(OAuthLoginGrant);
      const grant = await grants.findOne({
        where: {
          codeHash: this.hashToken(rawCode),
          consumedAt: IsNull(),
          expiresAt: MoreThan(new Date()),
        },
        lock: { mode: "pessimistic_write" },
      });
      if (!grant)
        throw new UnauthorizedException("OAuth login code is not valid");
      grant.consumedAt = new Date();
      await grants.save(grant);
      const user = await manager.getRepository(User).findOne({
        where: { id: grant.userId, status: UserStatus.Active },
      });
      if (!user) throw new UnauthorizedException("User is not active");
      return user;
    });
    return this.issueSession(user);
  }

  private async issueSession(user: User): Promise<AuthResult> {
    const refresh = this.createRefreshSession(this.sessions, user.id);
    await this.sessions.save(refresh.session);
    return this.buildAuthResult(user, refresh.rawToken);
  }

  private async buildAuthResult(
    user: User,
    refreshToken: string,
  ): Promise<AuthResult> {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email, roles: user.roles, type: "access" },
      { expiresIn: ACCESS_TOKEN_TTL },
    );
    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        roles: user.roles,
      },
    };
  }

  private createRefreshSession(
    repository: Repository<RefreshSession>,
    userId: string,
  ) {
    const rawToken = randomBytes(48).toString("base64url");
    return {
      rawToken,
      session: repository.create({
        userId,
        tokenHash: this.hashToken(rawToken),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_DAYS * 86_400_000),
        revokedAt: null,
        replacedById: null,
      }),
    };
  }

  private async findOrCreateOAuthUser(
    provider: OAuthProvider,
    profile: ProviderProfile,
  ): Promise<User> {
    const identity = await this.identities.findOne({
      where: { provider, providerUserId: profile.id },
    });
    if (identity) {
      const user = await this.users.findOne({ where: { id: identity.userId } });
      if (!user)
        throw new UnauthorizedException("OAuth account is not available");
      return user;
    }

    const email = this.normalizeEmail(profile.email);
    let user = await this.users.findOne({ where: { email } });
    if (!user) {
      user = await this.users.save(
        this.users.create({
          email,
          name: profile.name.slice(0, 60) || "자갈치 사용자",
          passwordHash: null,
          roles: ["USER"],
          status: UserStatus.Active,
        }),
      );
      await this.tickets.openAccount(user.id);
    }
    await this.identities.save(
      this.identities.create({
        userId: user.id,
        provider,
        providerUserId: profile.id,
        email,
      }),
    );
    return user;
  }

  private async fetchProviderProfile(
    provider: OAuthProvider,
    code: string,
    attempt: OAuthAttempt,
  ): Promise<ProviderProfile> {
    if (provider === OAuthProvider.Google) {
      const token = await this.exchangeToken(
        "https://oauth2.googleapis.com/token",
        {
          client_id: this.providerClientId(provider),
          client_secret: this.config.getOrThrow<string>(
            "OAUTH_GOOGLE_CLIENT_SECRET",
          ),
          code,
          code_verifier: attempt.codeVerifier,
          grant_type: "authorization_code",
          redirect_uri: this.oauthCallbackUrl(provider),
        },
      );
      const profile = await this.fetchJson(
        "https://openidconnect.googleapis.com/v1/userinfo",
        {
          authorization: `Bearer ${token.access_token}`,
        },
      );
      if (
        typeof profile.sub !== "string" ||
        typeof profile.email !== "string" ||
        profile.email_verified !== true
      ) {
        throw new UnauthorizedException(
          "Google did not return a verified email",
        );
      }
      return {
        id: profile.sub,
        email: profile.email,
        name:
          typeof profile.name === "string"
            ? profile.name
            : (profile.email.split("@")[0] ?? "자갈치 사용자"),
      };
    }

    if (provider === OAuthProvider.Github) {
      const token = await this.exchangeToken(
        "https://github.com/login/oauth/access_token",
        {
          client_id: this.providerClientId(provider),
          client_secret: this.config.getOrThrow<string>(
            "OAUTH_GITHUB_CLIENT_SECRET",
          ),
          code,
          code_verifier: attempt.codeVerifier,
          redirect_uri: this.oauthCallbackUrl(provider),
        },
        { accept: "application/json" },
      );
      const headers = {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token.access_token}`,
        "x-github-api-version": "2022-11-28",
      };
      const profile = await this.fetchJson(
        "https://api.github.com/user",
        headers,
      );
      const emails = await this.fetchJsonArray(
        "https://api.github.com/user/emails",
        headers,
      );
      const verified = emails.find(
        (candidate) =>
          candidate.primary === true && candidate.verified === true,
      );
      if (
        (typeof profile.id !== "number" && typeof profile.id !== "string") ||
        typeof verified?.email !== "string"
      ) {
        throw new UnauthorizedException(
          "GitHub did not return a verified primary email",
        );
      }
      return {
        id: String(profile.id),
        email: verified.email,
        name:
          typeof profile.name === "string" && profile.name.trim()
            ? profile.name
            : String(profile.login ?? verified.email.split("@")[0]),
      };
    }

    const token = await this.exchangeToken(
      "https://appleid.apple.com/auth/token",
      {
        client_id: this.providerClientId(provider),
        client_secret: this.appleClientSecret(),
        code,
        code_verifier: attempt.codeVerifier,
        grant_type: "authorization_code",
        redirect_uri: this.oauthCallbackUrl(provider),
      },
    );
    if (typeof token.id_token !== "string") {
      throw new UnauthorizedException("Apple did not return an identity token");
    }
    const claims = await this.verifyAppleIdentityToken(
      token.id_token,
      attempt.nonce,
    );
    return {
      id: claims.sub,
      email: claims.email,
      name: claims.email.split("@")[0] ?? "자갈치 사용자",
    };
  }

  private async exchangeToken(
    url: string,
    body: Record<string, string>,
    headers: Record<string, string> = {},
  ): Promise<Record<string, unknown>> {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...headers,
      },
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      throw new BadGatewayException("OAuth provider token exchange failed");
    return (await response.json()) as Record<string, unknown>;
  }

  private async fetchJson(
    url: string,
    headers: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      throw new BadGatewayException("OAuth provider profile request failed");
    return (await response.json()) as Record<string, unknown>;
  }

  private async fetchJsonArray(
    url: string,
    headers: Record<string, string>,
  ): Promise<Array<Record<string, unknown>>> {
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      throw new BadGatewayException("OAuth provider email request failed");
    const result = (await response.json()) as unknown;
    if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
    throw new BadGatewayException("OAuth provider returned invalid email data");
  }

  private async verifyAppleIdentityToken(
    token: string,
    nonce: string,
  ): Promise<{ sub: string; email: string }> {
    const [encodedHeader, encodedClaims, encodedSignature] = token.split(".");
    if (!encodedHeader || !encodedClaims || !encodedSignature) {
      throw new UnauthorizedException("Apple identity token is malformed");
    }
    const header = JSON.parse(
      Buffer.from(encodedHeader, "base64url").toString(),
    ) as {
      kid?: string;
      alg?: string;
    };
    const claims = JSON.parse(
      Buffer.from(encodedClaims, "base64url").toString(),
    ) as {
      iss?: string;
      aud?: string;
      exp?: number;
      nonce?: string;
      sub?: string;
      email?: string;
      email_verified?: string | boolean;
    };
    const jwks = await this.fetchJson(
      "https://appleid.apple.com/auth/keys",
      {},
    );
    const keys = Array.isArray(jwks.keys) ? (jwks.keys as JsonWebKey[]) : [];
    const key = keys.find((candidate) => candidate.kid === header.kid);
    if (
      header.alg !== "RS256" ||
      !key ||
      !cryptoVerify(
        "RSA-SHA256",
        Buffer.from(`${encodedHeader}.${encodedClaims}`),
        createPublicKey({ key, format: "jwk" }),
        Buffer.from(encodedSignature, "base64url"),
      ) ||
      claims.iss !== "https://appleid.apple.com" ||
      claims.aud !== this.providerClientId(OAuthProvider.Apple) ||
      !claims.exp ||
      claims.exp <= Date.now() / 1_000 ||
      claims.nonce !== nonce ||
      !claims.sub ||
      !claims.email ||
      ![true, "true"].includes(claims.email_verified ?? false)
    ) {
      throw new UnauthorizedException("Apple identity token is not valid");
    }
    return { sub: claims.sub, email: claims.email };
  }

  private appleClientSecret(): string {
    const clientId = this.providerClientId(OAuthProvider.Apple);
    const teamId = this.config.getOrThrow<string>("OAUTH_APPLE_TEAM_ID");
    const keyId = this.config.getOrThrow<string>("OAUTH_APPLE_KEY_ID");
    const privateKey = this.config
      .getOrThrow<string>("OAUTH_APPLE_PRIVATE_KEY")
      .replaceAll("\\n", "\n");
    const now = Math.floor(Date.now() / 1_000);
    const header = Buffer.from(
      JSON.stringify({ alg: "ES256", kid: keyId }),
    ).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        iss: teamId,
        iat: now,
        exp: now + 300,
        aud: "https://appleid.apple.com",
        sub: clientId,
      }),
    ).toString("base64url");
    const signingInput = `${header}.${payload}`;
    const signature = cryptoSign("sha256", Buffer.from(signingInput), {
      key: privateKey,
      dsaEncoding: "ieee-p1363",
    });
    return `${signingInput}.${signature.toString("base64url")}`;
  }

  private providerClientId(provider: OAuthProvider): string {
    const key = {
      [OAuthProvider.Google]: "OAUTH_GOOGLE_CLIENT_ID",
      [OAuthProvider.Github]: "OAUTH_GITHUB_CLIENT_ID",
      [OAuthProvider.Apple]: "OAUTH_APPLE_CLIENT_ID",
    }[provider];
    try {
      return this.config.getOrThrow<string>(key);
    } catch {
      throw new ServiceUnavailableException(
        `${provider} login is not configured`,
      );
    }
  }

  private assertOAuthEnabled(provider?: OAuthProvider): void {
    if (this.config.get<string>("OAUTH_ENABLED") !== "true") {
      throw new ServiceUnavailableException({
        code: "OAUTH_DISABLED",
        message: "OAuth is unavailable",
      });
    }
    if (
      provider === OAuthProvider.Apple &&
      this.config.get<string>("OAUTH_APPLE_ENABLED") !== "true"
    ) {
      throw new ServiceUnavailableException({
        code: "OAUTH_PROVIDER_DISABLED",
        message: "Apple OAuth is unavailable",
      });
    }
  }

  private oauthCallbackUrl(provider: OAuthProvider): string {
    const base = new URL(this.config.getOrThrow<string>("PUBLIC_API_URL"));
    return new URL(`/api/users/auth/callback/${provider}`, base).toString();
  }

  private validateReturnUrl(requested?: string): string {
    const fallback = new URL(
      "/auth/callback",
      this.config.getOrThrow<string>("WEB_APP_URL"),
    ).toString();
    if (!requested) return fallback;
    const candidate = new URL(requested);
    const webOrigin = new URL(this.config.getOrThrow<string>("WEB_APP_URL"))
      .origin;
    if (
      (candidate.protocol === "jagalchi:" &&
        candidate.hostname === "oauth" &&
        candidate.pathname === "/callback") ||
      candidate.origin === webOrigin
    ) {
      return candidate.toString();
    }
    throw new UnauthorizedException("OAuth return URL is not allowed");
  }

  private normalizeEmail(value: string): string {
    return value.trim().toLowerCase();
  }

  private hashToken(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  private hashVerificationCode(email: string, code: string): string {
    return createHmac(
      "sha256",
      this.config.getOrThrow<string>("VERIFICATION_CODE_SECRET"),
    )
      .update(`${email}:${code}`)
      .digest("hex");
  }
}
