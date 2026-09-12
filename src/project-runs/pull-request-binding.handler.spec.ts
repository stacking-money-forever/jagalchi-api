import { describe, expect, it, vi } from 'vitest';
import { FIXTURE_VERIFICATION_IDS, FixtureVerificationProvider } from '../verification-providers';
import { WorkflowOperationHandlers } from '../workflow-operations/workflow-operation.worker';
import { PullRequestBindingHandler } from './pull-request-binding.handler';

describe('PullRequestBindingHandler production GitHub integration', () => {
  it('resolves and commits the selected pull request through the live GitHub service', async () => {
    const registry = new WorkflowOperationHandlers();
    const github = {
      resolvePullRequestBinding: vi.fn().mockResolvedValue({
        repositoryName: 'fixture/verification-repository',
        repositoryPrivate: true,
      }),
      getPullRequestHead: vi.fn().mockResolvedValue({
        headSha: FIXTURE_VERIFICATION_IDS.initialHeadSha,
      }),
    };
    const subject = new PullRequestBindingHandler(
      {} as never,
      { get: (key: string) => key === 'GITHUB_PROVIDER' ? 'github' : 'true' } as never,
      registry,
      new FixtureVerificationProvider(),
      github as never,
    );
    const operation = {
      id: 'operation-1',
      ownerId: 'owner-1',
      input: {
        githubRepositoryId: FIXTURE_VERIFICATION_IDS.repositoryId,
        pullNumber: 2,
      },
    } as never;
    const fence = {
      run: { id: 'run-1' },
      binding: {
        installationId: 'installation-1',
        githubRepositoryId: FIXTURE_VERIFICATION_IDS.repositoryId,
        repositoryName: 'fixture/verification-repository',
        repositoryPrivate: true,
      },
    };
    vi.spyOn(subject as never, 'readFence').mockResolvedValue(fence as never);
    const commit = vi.spyOn(subject as never, 'commitSuccess').mockResolvedValue({ status: 'PASS' } as never);
    subject.onModuleInit();

    await expect(registry.get('PULL_REQUEST_BINDING')!(operation, new AbortController().signal))
      .resolves.toEqual({ status: 'PASS' });
    expect(github.resolvePullRequestBinding).toHaveBeenCalledWith(
      'owner-1',
      'installation-1',
      FIXTURE_VERIFICATION_IDS.repositoryId,
      2,
    );
    expect(commit).toHaveBeenCalledWith(
      operation,
      fence,
      'fixture/verification-repository',
      true,
      FIXTURE_VERIFICATION_IDS.initialHeadSha,
    );
  });
});
