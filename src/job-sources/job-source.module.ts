import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { createJobSourceAdapter, isJobSourceProvider } from './job-source.adapters';
import { JobSourceError } from './job-source.errors';
import { SystemJobSourceDnsResolver } from './job-source.policy';
import type { JobSourceAdapter } from './job-source.types';
import { NodePinnedJobSourceTransport } from './node-pinned-job-source.transport';

export const JOB_SOURCE_ADAPTER = Symbol('JOB_SOURCE_ADAPTER');

export function createConfiguredJobSourceAdapter(
  provider: string,
  resolver = new SystemJobSourceDnsResolver(),
  transport = new NodePinnedJobSourceTransport(),
): JobSourceAdapter {
  if (!isJobSourceProvider(provider)) {
    throw new JobSourceError('JOB_SOURCE_PROVIDER_UNSUPPORTED');
  }
  return createJobSourceAdapter(provider, { resolver, transport });
}

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: JOB_SOURCE_ADAPTER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const provider = config.get<string>('JOB_SOURCE_PROVIDER');
        if (!provider && config.get<string>('PROJECT_RUNS_ENABLED') !== 'true') {
          return createConfiguredJobSourceAdapter('fixture');
        }
        return createConfiguredJobSourceAdapter(provider ?? '');
      },
    },
  ],
  exports: [JOB_SOURCE_ADAPTER],
})
export class JobSourceModule {}
