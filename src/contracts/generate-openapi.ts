import { Test } from '@nestjs/testing';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AiController } from '../ai/ai.controller';
import { AuthController, UsersController } from '../auth/auth.controller';
import { CareerController } from '../career/career.controller';
import { CareerV1Controller, ProjectRunOperationsController } from '../career/career-v1.controller';
import { GithubWebhookController } from '../github/github-webhook.controller';
import { GithubController } from '../github/github.controller';
import { HealthController } from '../health/health.controller';
import { ProjectRunsController } from '../project-runs/project-runs.controller';
import { RealtimeController, RealtimeTicketController } from '../realtime/realtime.controller';
import { DirectoriesController, RoadmapsController } from '../roadmaps/roadmaps.controller';
import { SocialController } from '../social/social.controller';
import { TicketsController } from '../tickets/tickets.controller';
import { UploadsController } from '../uploads/uploads.controller';
import { createJagalchiOpenApi } from './openapi';
import { WorkflowOperationController, WorkflowOperationPublicController } from '../workflow-operations/workflow-operation.controller';

const outputPath = resolve(process.cwd(), 'contracts/openapi.json');
const controllers = [
  AiController, UsersController, AuthController, CareerController, GithubWebhookController,
  GithubController, HealthController, ProjectRunsController, RealtimeController,
  RealtimeTicketController, DirectoriesController, RoadmapsController, SocialController,
  TicketsController, UploadsController,
  WorkflowOperationController, WorkflowOperationPublicController, CareerV1Controller, ProjectRunOperationsController,
];

export async function openApiBytes(): Promise<string> {
  const contractControllers = controllers.map((Base) => {
    const Parent = Base as unknown as new () => object;
    class ContractController extends Parent { constructor() { super(); } }
    Object.defineProperty(ContractController, 'name', { value: Base.name });
    Reflect.defineMetadata('design:paramtypes', [], ContractController);
    Reflect.defineMetadata('self:paramtypes', [], ContractController);
    return ContractController;
  });
  const module = await Test.createTestingModule({
    controllers: contractControllers,
  }).compile();
  const app = module.createNestApplication();
  app.setGlobalPrefix('api');
  const document = createJagalchiOpenApi(app);
  await app.close();
  return `${JSON.stringify(document, null, 2)}\n`;
}

export async function generateOpenApi(check = false): Promise<void> {
  const expected = await openApiBytes();
  if (check) {
    const actual = await readFile(outputPath, 'utf8');
    if (actual !== expected) throw new Error('OpenAPI document is stale; run pnpm openapi:generate');
    return;
  }
  await writeFile(outputPath, expected);
}

if (require.main === module) {
  void generateOpenApi(process.argv.includes('--check')).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
