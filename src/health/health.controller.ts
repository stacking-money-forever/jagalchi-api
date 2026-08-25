import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  getHealth(): { status: 'ok'; service: 'jagalchi-api' } {
    return { status: 'ok', service: 'jagalchi-api' };
  }
}
