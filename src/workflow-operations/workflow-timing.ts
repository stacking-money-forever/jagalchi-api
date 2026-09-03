import type { ConfigService } from '@nestjs/config';

export const WORKFLOW_TIMING_DEFAULTS = {
  aiTimeoutMs: 65_000,
  leaseMs: 120_000,
  heartbeatMs: 30_000,
  pollMs: 1_000,
} as const;

export function workflowTiming(config: ConfigService) {
  return {
    aiTimeoutMs: Number(config.get<string>('AI_TIMEOUT_MS', String(WORKFLOW_TIMING_DEFAULTS.aiTimeoutMs))),
    leaseMs: Number(config.get<string>('WORKFLOW_LEASE_MS', String(WORKFLOW_TIMING_DEFAULTS.leaseMs))),
    heartbeatMs: Number(config.get<string>('WORKFLOW_HEARTBEAT_MS', String(WORKFLOW_TIMING_DEFAULTS.heartbeatMs))),
    pollMs: Number(config.get<string>('WORKFLOW_POLL_MS', String(WORKFLOW_TIMING_DEFAULTS.pollMs))),
  };
}
