export type VerificationProviderErrorCode =
  | 'VERIFICATION_PROVIDER_UNAVAILABLE'
  | 'REPOSITORY_BINDING_NOT_FOUND'
  | 'REPOSITORY_NOT_AUTHORIZED'
  | 'PULL_REQUEST_NOT_FOUND'
  | 'VERIFICATION_FACTS_INVALID'
  | 'VERIFICATION_RULE_UNSUPPORTED'
  | 'VERIFICATION_PROVIDER_DRIFTED';

const MESSAGES: Record<VerificationProviderErrorCode, string> = {
  VERIFICATION_PROVIDER_UNAVAILABLE: 'The verification provider is unavailable.',
  REPOSITORY_BINDING_NOT_FOUND: 'The repository binding was not found.',
  REPOSITORY_NOT_AUTHORIZED: 'The repository is not authorized for verification.',
  PULL_REQUEST_NOT_FOUND: 'The pull request was not found.',
  VERIFICATION_FACTS_INVALID: 'The verification provider returned invalid facts.',
  VERIFICATION_RULE_UNSUPPORTED: 'The evidence rule is unsupported.',
  VERIFICATION_PROVIDER_DRIFTED: 'The verification provider facts changed during evaluation.',
};

export class VerificationProviderError extends Error {
  constructor(readonly code: VerificationProviderErrorCode) {
    super(MESSAGES[code]);
    this.name = 'VerificationProviderError';
  }
}
