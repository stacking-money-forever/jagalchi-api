import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { DataSource } from 'typeorm';

const READINESS_TIMEOUT_MS = 3_000;

@ApiTags('health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

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
      return { status: 'ready', service: 'jagalchi-api' };
    } catch {
      throw new ServiceUnavailableException({
        code: 'DATABASE_NOT_READY',
        message: 'Service is not ready',
      });
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
