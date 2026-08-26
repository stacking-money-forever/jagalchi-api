export const GITHUB_APP_PERMISSIONS = Object.freeze({
  pull_requests: 'read',
  checks: 'read',
  statuses: 'read',
} as const);

export interface GithubInstallationAccount {
  installationId: string;
  accountId: string;
  accountType: 'USER' | 'ORGANIZATION';
}

export interface GithubRepositoryIdentity {
  repositoryId: string;
  fullName: string;
  private: boolean;
}

export interface PullRequestFacts {
  repositoryId: string;
  pullNumber: number;
  headSha: string;
  merged: boolean;
  baseBranch: string;
  changedPaths: string[];
  checks: Array<{ name: string; successful: boolean }>;
  statuses: Array<{ context: string; successful: boolean }>;
}

export interface GithubPullRequestBinding {
  repositoryId: string;
  pullNumber: number;
  repositoryName: string;
  repositoryPrivate: boolean;
  pullTitle: string;
  pullUrl: string;
}

export interface GithubSetupState {
  state: string;
  expiresAt: string;
  returnPath: string;
}

export interface GithubInstallationClaim {
  installationId: string;
  githubInstallationId: string;
  repositoryCount: number;
  returnPath: string;
}
