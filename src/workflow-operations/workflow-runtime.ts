import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class WorkflowClock {
  now(): Date {
    return new Date();
  }

  sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
    if (milliseconds <= 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timeout);
        reject(signal?.reason ?? new Error('Workflow wait aborted'));
      };
      const timeout = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, milliseconds);
      timeout.unref();
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}

@Injectable()
export class WorkflowBackoffPolicy {
  constructor(private readonly config: ConfigService) {}

  delayMs(attempts: number): number {
    const base = Number(this.config.get<string>('WORKFLOW_RETRY_BASE_MS', '1000'));
    const maximum = Number(this.config.get<string>('WORKFLOW_RETRY_MAX_MS', '30000'));
    return Math.min(maximum, base * (2 ** Math.max(0, attempts - 1)));
  }
}

export class RetryableWorkflowError extends Error {
  readonly retryable = true;

  constructor(
    readonly code: string,
    message: string,
    readonly failureClass = 'TRANSIENT_DEPENDENCY',
  ) {
    super(message);
  }
}
