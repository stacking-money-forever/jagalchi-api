import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { WorkflowOperationService } from '../workflow-operations/workflow-operation.service';

const READINESS_TIMEOUT_MS = 3_000;

@ApiTags('health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService = { get: () => undefined } as unknown as ConfigService,
    private readonly operations?: WorkflowOperationService,
  ) {}

  @Get()
  getHealth(): { status: 'ok'; service: 'jagalchi-api' } {
    return { status: 'ok', service: 'jagalchi-api' };
  }

  @Get('ready')
  async getReadiness(): Promise<{ status: 'ready'; service: 'jagalchi-api' }> {
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.dataSource.query('SELECT 1'),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('readiness timeout')), READINESS_TIMEOUT_MS);
        }),
      ]);
      if (this.config.get<string>('PROJECT_RUNS_ENABLED') === 'true') {
        const heartbeat = await this.operations?.latestWorkerHeartbeat() ?? null;
        const heartbeatMs = Number(this.config.get<string>('WORKFLOW_HEARTBEAT_MS', '30000'));
        const maxAgeMs = Number(this.config.get<string>(
          'WORKFLOW_HEALTH_MAX_AGE_MS',
          String(Math.max(15_000, heartbeatMs * 3)),
        ));
        if (!heartbeat || Date.now() - heartbeat.getTime() > maxAgeMs) {
          throw new ServiceUnavailableException({
            code: 'WORKFLOW_WORKER_NOT_READY',
            message: 'Service is not ready',
          });
        }
      }
      return { status: 'ready', service: 'jagalchi-api' };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException({
        code: 'DATABASE_NOT_READY',
        message: 'Service is not ready',
      });
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
