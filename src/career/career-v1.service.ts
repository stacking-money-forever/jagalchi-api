import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, MoreThan, Repository } from 'typeorm';
import { createHash } from 'node:crypto';
import { FIXTURE_JOB_URL, LIVE_JOB_SOURCE_HOSTS, validateJobSourceUrl, validateManualCapture } from '../job-sources';
import { CareerTargetVersion, CandidateProfileSnapshot, CareerDiffSnapshot, ProjectFeature, ProjectFeatureEntitlement, ProjectProposal, ProjectProposalSet, ProjectRunCommand, SnapshotState } from '../project-runs/product-spine.entities';
import { WorkflowOperationService } from '../workflow-operations/workflow-operation.service';

const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object' ? `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}` : JSON.stringify(value) ?? 'null';

@Injectable()
export class CareerV1Service {
  constructor(
    private readonly config: ConfigService,
    private readonly operations: WorkflowOperationService,
    @InjectRepository(ProjectFeatureEntitlement) private readonly entitlements: Repository<ProjectFeatureEntitlement>,
    @InjectRepository(CareerTargetVersion) private readonly targetVersions: Repository<CareerTargetVersion>,
    @InjectRepository(CandidateProfileSnapshot) private readonly profiles: Repository<CandidateProfileSnapshot>,
    @InjectRepository(CareerDiffSnapshot) private readonly diffs: Repository<CareerDiffSnapshot>,
    @InjectRepository(ProjectProposalSet) private readonly proposalSets: Repository<ProjectProposalSet>,
    @InjectRepository(ProjectProposal) private readonly proposals: Repository<ProjectProposal>,
    @InjectRepository(ProjectRunCommand) private readonly commands: Repository<ProjectRunCommand>,
    private readonly dataSource?: DataSource,
  ) {}

  async targetImport(ownerId: string, key: string, body: Record<string, unknown>) {
    await this.requireEntitled(ownerId);
    const input = body.input;
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException({ code: 'INPUT_UNION_INVALID', message: 'Exactly one target input is required' });
    const value = input as Record<string, unknown>;
    if (value.kind === 'FETCHED_URL' && typeof value.url === 'string') {
      try {
        if (this.config.get<string>('JOB_SOURCE_PROVIDER') === 'fixture') {
          if (value.url !== FIXTURE_JOB_URL) throw new Error('unsupported');
        } else validateJobSourceUrl(value.url, LIVE_JOB_SOURCE_HOSTS);
      } catch { throw new UnprocessableEntityException({ code: 'SOURCE_UNSUPPORTED', message: 'Job source is unsupported' }); }
    } else if (value.kind === 'MANUAL_CAPTURE' && typeof value.sourceText === 'string') {
      validateManualCapture({ kind: 'MANUAL_CAPTURE', text: value.sourceText, sourceTitle: typeof value.sourceTitle === 'string' ? value.sourceTitle : 'Manual capture', sourceUrl: typeof value.originalUrl === 'string' ? value.originalUrl : undefined, degradationReason: 'USER_SUPPLIED' });
    } else throw new BadRequestException({ code: 'INPUT_UNION_INVALID', message: 'Exactly one target input is required' });
    return this.createOperation(ownerId, '/api/career/target-imports', key, 'JOB_TARGET_IMPORT', value);
  }

  async profileOperation(ownerId: string, key: string, body: Record<string, unknown>) {
    await this.requireEntitled(ownerId);
    const repositoryIds = body.repositoryIds;
    if (!Array.isArray(repositoryIds) || repositoryIds.length > 50 || !repositoryIds.every((id) => typeof id === 'string')) throw new BadRequestException('repositoryIds is invalid');
    return this.createOperation(ownerId, '/api/career/profile-snapshot-operations/github', key, 'CANDIDATE_PROFILE_SNAPSHOT', { repositoryIds });
  }

  async proposalOperation(ownerId: string, targetId: string, key: string, body: Record<string, unknown>) {
    await this.requireEntitled(ownerId);
    if (typeof body.careerDiffSnapshotId !== 'string') throw new BadRequestException('careerDiffSnapshotId is required');
    const diff = await this.diffs.findOne({ where: { id: body.careerDiffSnapshotId, ownerId, careerTargetId: targetId, state: SnapshotState.Confirmed } });
    if (!diff) throw new NotFoundException('Confirmed Career Diff Snapshot is not available');
    return this.createOperation(ownerId, `/api/career/targets/${targetId}/project-proposal-operations`, key, 'PROJECT_PROPOSALS_V1', { careerDiffSnapshotId: diff.id, constraints: body.constraints ?? {} });
  }

  async projectRunOperation(ownerId: string, key: string, body: Record<string, unknown>) {
    await this.requireEntitled(ownerId);
    for (const field of ['projectProposalId', 'candidateProfileSnapshotId', 'careerDiffSnapshotId']) if (typeof body[field] !== 'string') throw new BadRequestException(`${field} is required`);
    const proposal = await this.proposals.findOne({ where: { id: body.projectProposalId as string } });
    const set = proposal ? await this.proposalSets.findOne({ where: { id: proposal.proposalSetId, ownerId } }) : null;
    const profile = await this.profiles.findOne({ where: { id: body.candidateProfileSnapshotId as string, ownerId, state: SnapshotState.Confirmed } });
    const diff = await this.diffs.findOne({ where: { id: body.careerDiffSnapshotId as string, ownerId, state: SnapshotState.Confirmed } });
    if (!proposal || !set || !profile || !diff || set.careerDiffSnapshotId !== diff.id || diff.candidateProfileSnapshotId !== profile.id) throw new ConflictException({ code: 'SNAPSHOT_MISMATCH', message: 'Snapshot inputs do not match' });
    const repository = body.repository;
    if (!repository || typeof repository !== 'object' || Array.isArray(repository)) throw new BadRequestException('repository is required');
    const mode = (repository as Record<string, unknown>).mode;
    if (!['EXISTING_OWNED', 'OPEN_SOURCE_CONTRIBUTION', 'MANUAL_GREENFIELD'].includes(String(mode))) throw new BadRequestException('repository mode is invalid');
    if (mode !== 'MANUAL_GREENFIELD' && typeof (repository as Record<string, unknown>).githubRepositoryId !== 'string') throw new BadRequestException('githubRepositoryId is required');
    if (mode === 'MANUAL_GREENFIELD' && Object.keys(repository as Record<string, unknown>).some((field) => field !== 'mode')) throw new BadRequestException('Manual greenfield repository must not contain GitHub fields');
    return this.createOperation(ownerId, '/api/project-run-operations', key, 'PROJECT_RUN_CREATE', body);
  }

  async getTargetVersion(ownerId: string, id: string) { return this.ownerResource(this.targetVersions, ownerId, id); }
  async getProfile(ownerId: string, id: string) { return this.ownerResource(this.profiles, ownerId, id); }
  async getDiff(ownerId: string, id: string) { return this.ownerResource(this.diffs, ownerId, id); }
  async getProposalSet(ownerId: string, id: string) {
    const set = await this.ownerResource(this.proposalSets, ownerId, id);
    return { ...set, proposals: await this.proposals.find({ where: { proposalSetId: id }, order: { rank: 'ASC' } }) };
  }

  async confirmProfile(ownerId: string, id: string, key: string, payload: Record<string, unknown>) {
    this.allowCorrections(payload, ['acceptedRepositoryIds', 'competencyCorrections']);
    if (!this.dataSource) throw new Error('Snapshot transaction is unavailable');
    const route = `/api/career/profile-snapshots/${id}/confirm`; const inputHash = this.digest(payload);
    return this.dataSource.transaction(async (manager) => {
      const commands = manager.getRepository(ProjectRunCommand); const profiles = manager.getRepository(CandidateProfileSnapshot);
      const prior = await commands.findOne({ where: { ownerId, route, idempotencyKey: key } }); if (prior) return this.checkReplay(prior, inputHash);
      const source = await profiles.findOne({ where: { id, ownerId }, lock: { mode: 'pessimistic_write' } }); if (!source) throw new NotFoundException('Resource is not available');
      const concurrent = await commands.findOne({ where: { ownerId, route, idempotencyKey: key } }); if (concurrent) return this.checkReplay(concurrent, inputHash);
      if (source.state !== SnapshotState.Draft || await profiles.findOne({ where: { ownerId, sourceSnapshotId: id, state: SnapshotState.Confirmed } })) throw new ConflictException({ code: 'SNAPSHOT_ALREADY_CONFIRMED', message: 'Snapshot is already confirmed' });
      const confirmedPayload = { ...source.payload };
      if (typeof confirmedPayload.operationId === 'string') {
        confirmedPayload.sourceOperationId = confirmedPayload.operationId;
        delete confirmedPayload.operationId;
      }
      const result = await profiles.save(profiles.create({ ownerId, sourceSnapshotId: id, state: SnapshotState.Confirmed, schemaVersion: 1, payload: { ...confirmedPayload, corrections: payload } }));
      await commands.save(commands.create({ ownerId, route, idempotencyKey: key, inputHash, response: result as unknown as Record<string, unknown> })); return result;
    });
  }

  async createDiff(ownerId: string, targetId: string, key: string, body: Record<string, unknown>) {
    const route = `/api/career/targets/${targetId}/diff-snapshots`; const replay = await this.replay(ownerId, route, key, body); if (replay) return replay;
    if (typeof body.careerTargetVersionId !== 'string' || typeof body.candidateProfileSnapshotId !== 'string') throw new BadRequestException('Snapshot IDs are required');
    const target = await this.targetVersions.findOne({ where: { id: body.careerTargetVersionId, ownerId, careerTargetId: targetId } });
    const profile = await this.profiles.findOne({ where: { id: body.candidateProfileSnapshotId, ownerId, state: SnapshotState.Confirmed } });
    if (!target || !profile) throw new NotFoundException('Confirmed snapshot inputs are not available');
    const result = await this.diffs.save(this.diffs.create({ ownerId, careerTargetId: targetId, careerTargetVersionId: target.id, candidateProfileSnapshotId: profile.id, state: SnapshotState.Draft, sourceSnapshotId: null, schemaVersion: 1, payload: { observed: [], inferred: [], missing: target.payload.requirements ?? [], citations: target.payload.citations ?? [] } }));
    await this.remember(ownerId, route, key, body, result as unknown as Record<string, unknown>); return result;
  }

  async confirmDiff(ownerId: string, id: string, key: string, payload: Record<string, unknown>) {
    this.allowCorrections(payload, ['acceptedCompetencyIds', 'corrections']);
    if (!this.dataSource) throw new Error('Snapshot transaction is unavailable');
    const route = `/api/career/diff-snapshots/${id}/confirm`; const inputHash = this.digest(payload);
    return this.dataSource.transaction(async (manager) => {
      const commands = manager.getRepository(ProjectRunCommand); const diffs = manager.getRepository(CareerDiffSnapshot);
      const prior = await commands.findOne({ where: { ownerId, route, idempotencyKey: key } }); if (prior) return this.checkReplay(prior, inputHash);
      const source = await diffs.findOne({ where: { id, ownerId }, lock: { mode: 'pessimistic_write' } }); if (!source) throw new NotFoundException('Resource is not available');
      const concurrent = await commands.findOne({ where: { ownerId, route, idempotencyKey: key } }); if (concurrent) return this.checkReplay(concurrent, inputHash);
      if (source.state !== SnapshotState.Draft || await diffs.findOne({ where: { ownerId, sourceSnapshotId: id, state: SnapshotState.Confirmed } })) throw new ConflictException({ code: 'SNAPSHOT_ALREADY_CONFIRMED', message: 'Snapshot is already confirmed' });
      const result = await diffs.save(diffs.create({ ownerId, careerTargetId: source.careerTargetId, careerTargetVersionId: source.careerTargetVersionId, candidateProfileSnapshotId: source.candidateProfileSnapshotId, state: SnapshotState.Confirmed, sourceSnapshotId: id, schemaVersion: 1, payload: { ...source.payload, corrections: payload } }));
      await commands.save(commands.create({ ownerId, route, idempotencyKey: key, inputHash, response: result as unknown as Record<string, unknown> })); return result;
    });
  }

  private async requireEntitled(ownerId: string): Promise<void> {
    if (this.config.get<string>('PROJECT_RUNS_ENABLED') !== 'true') throw new ServiceUnavailableException({ code: 'PROJECT_RUNS_DISABLED', message: 'Project Runs are unavailable' });
    const allowed = await this.entitlements.exists({ where: [
      { userId: ownerId, feature: ProjectFeature.ProjectRuns, enabled: true, expiresAt: IsNull() },
      { userId: ownerId, feature: ProjectFeature.ProjectRuns, enabled: true, expiresAt: MoreThan(new Date()) },
    ] });
    if (!allowed) throw new NotFoundException('Project Runs are unavailable');
  }
  private async createOperation(ownerId: string, route: string, key: string, kind: string, input: Record<string, unknown>) {
    const created = await this.operations.createOrReplay({ ownerId, route, idempotencyKey: key, kind, input });
    return this.operations.get(ownerId, created.operation.id);
  }
  private async ownerResource<T extends { id: string; ownerId: string }>(repository: Repository<T>, ownerId: string, id: string): Promise<T> {
    const value = await repository.findOne({ where: { id, ownerId } as never });
    if (!value) throw new NotFoundException('Resource is not available');
    return value;
  }
  private digest(value: unknown) { return createHash('sha256').update(canonical(value)).digest('hex'); }
  private async replay(ownerId: string, route: string, key: string, input: Record<string, unknown>) { const prior = await this.commands.findOne({ where: { ownerId, route, idempotencyKey: key } }); if (!prior) return null; if (prior.inputHash !== this.digest(input)) throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'Idempotency key was reused' }); return prior.response; }
  private async remember(ownerId: string, route: string, key: string, input: Record<string, unknown>, response: Record<string, unknown>) { await this.commands.save(this.commands.create({ ownerId, route, idempotencyKey: key, inputHash: this.digest(input), response })); }
  private checkReplay(command: ProjectRunCommand, inputHash: string) { if (command.inputHash !== inputHash) throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'Idempotency key was reused' }); return command.response; }
  private allowCorrections(value: Record<string, unknown>, allowed: string[]) { if (Object.keys(value).some((key) => !allowed.includes(key))) throw new BadRequestException('Correction field is not allowed'); for (const item of Object.values(value)) if (item !== undefined && !(Array.isArray(item) || (item && typeof item === 'object' && !Array.isArray(item)))) throw new BadRequestException('Correction value is invalid'); }
}
