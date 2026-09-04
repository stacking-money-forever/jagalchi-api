import {
  ConflictException,
  INestApplication,
  Module,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { JwtStrategy } from '../auth/jwt.strategy';
import { ProjectRunsController } from '../project-runs/project-runs.controller';
import { ProjectRunsService } from '../project-runs/project-runs.service';
import {
  WorkflowOperationPublicController,
} from '../workflow-operations/workflow-operation.controller';
import { WorkflowOperationState } from '../workflow-operations/workflow-operation.entities';

const JWT_SECRET = 'test-jwt-access-secret-with-32-characters';
const OWNER_ID = '10000000-0000-4000-8000-000000000001';
const FOREIGN_RUN_ID = '00000000-0000-4000-8000-000000009999';
const SEED_RUN_ID = '00000000-0000-4000-8000-000000000001';
const OPERATION_ID = '20000000-0000-4000-8000-000000000001';
const IDEMPOTENCY_KEY = '30000000-0000-4000-8000-000000000099';

async function requestJson(
  baseUrl: string,
  method: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, { method, headers });
  const text = await response.text();
  const body = text ? JSON.parse(text) as Record<string, unknown> : {};
  return { status: response.status, body };
}

function createRunsMock() {
  return {
    get: vi.fn(),
    taskCommand: vi.fn(),
  };
}

function createOperationsMock() {
  return {
    get: vi.fn(),
    requestCancelVersioned: vi.fn(),
  };
}

describe('API negative regression contracts (N1–N4, N5 poll)', () => {
  describe('HTTP auth boundary (N1)', () => {
    let app: INestApplication;
    let baseUrl = '';
    let jwt: JwtService;
    const runs = createRunsMock();

    @Module({
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({
          secret: JWT_SECRET,
          signOptions: {
            algorithm: 'HS256',
            issuer: 'jagalchi-api',
            audience: 'jagalchi-client',
          },
        }),
      ],
      controllers: [ProjectRunsController],
      providers: [
        {
          provide: JwtStrategy,
          useFactory: () => new JwtStrategy({
            get: (key: string) => (key === 'JWT_ACCESS_SECRET' ? JWT_SECRET : undefined),
            getOrThrow: (key: string) => {
              if (key === 'JWT_ACCESS_SECRET') return JWT_SECRET;
              throw new Error(`Missing config key: ${key}`);
            },
          } as ConfigService),
        },
        { provide: ProjectRunsService, useValue: runs },
      ],
    })
    class NegativeAuthModule {}

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [NegativeAuthModule],
      }).compile();
      app = moduleRef.createNestApplication();
      app.setGlobalPrefix('api');
      await app.init();
      await app.listen(0, '127.0.0.1');
      const address = app.getHttpServer().address();
      if (!address || typeof address === 'string') throw new Error('HTTP server did not bind');
      baseUrl = `http://127.0.0.1:${address.port}`;
      jwt = app.get(JwtService);
    });

    afterAll(async () => {
      if (app) await app.close();
    });

    function bearer(type: 'access' | 'refresh' = 'access'): Record<string, string> {
      const token = jwt.sign({
        sub: OWNER_ID,
        email: 'seed@example.test',
        roles: ['USER'],
        type,
      });
      return { Authorization: `Bearer ${token}` };
    }

    it('N1 returns 401 for unauthenticated project run reads', async () => {
      const response = await requestJson(baseUrl, 'GET', `/api/project-runs/${SEED_RUN_ID}`);
      expect(response.status).toBe(401);
      expect(runs.get).not.toHaveBeenCalled();
    });

    it('rejects refresh tokens at the JWT boundary with 401', async () => {
      const response = await requestJson(
        baseUrl,
        'GET',
        `/api/project-runs/${SEED_RUN_ID}`,
        bearer('refresh'),
      );
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({ statusCode: 401 });
      expect(runs.get).not.toHaveBeenCalled();
    });
  });

  describe('ownership and versioned mutation contracts (N2–N4)', () => {
    const user = { id: OWNER_ID, email: 'seed@example.test', roles: ['USER'] };

    it('N2 returns 404 without leaking ownership for foreign project runs', async () => {
      const runs = createRunsMock();
      runs.get.mockRejectedValueOnce(new NotFoundException('Project run is not available'));
      const controller = new ProjectRunsController(runs as never);
      const caught = await controller.getProjectRun(user, FOREIGN_RUN_ID).catch((error) => error);
      expect(caught).toBeInstanceOf(NotFoundException);
      expect(caught.getStatus()).toBe(404);
      expect(caught.getStatus()).not.toBe(403);
      expect(JSON.stringify(caught.getResponse())).not.toContain(OWNER_ID);
      expect(runs.get).toHaveBeenCalledWith(OWNER_ID, FOREIGN_RUN_ID);
    });

    it('N3 returns 409 STALE_VERSION with currentVersion for stale workflow cancel If-Match', async () => {
      const operations = createOperationsMock();
      operations.requestCancelVersioned.mockRejectedValueOnce(new ConflictException({
        code: 'STALE_VERSION',
        message: 'Operation version is stale',
        details: { currentVersion: 3 },
      }));
      const controller = new WorkflowOperationPublicController(operations as never);
      const caught = await controller.cancel(user, OPERATION_ID, '1', IDEMPOTENCY_KEY).catch((error) => error);
      expect(caught).toBeInstanceOf(ConflictException);
      expect(caught.getStatus()).toBe(409);
      expect(caught.getResponse()).toMatchObject({
        code: 'STALE_VERSION',
        details: { currentVersion: 3 },
      });
      expect(operations.requestCancelVersioned).toHaveBeenCalledWith(
        OPERATION_ID,
        OWNER_ID,
        1,
        IDEMPOTENCY_KEY,
      );
    });

    it('N4 returns 409 STALE_VERSION with currentVersion for stale project run task start', async () => {
      const runs = createRunsMock();
      runs.taskCommand.mockRejectedValueOnce(new ConflictException({
        code: 'STALE_VERSION',
        message: 'Project run version is stale',
        details: { currentVersion: 1 },
      }));
      const controller = new ProjectRunsController(runs as never);
      const caught = await controller.start(user, SEED_RUN_ID, 'seed-task-1', '999', IDEMPOTENCY_KEY).catch((error) => error);
      expect(caught).toBeInstanceOf(ConflictException);
      expect(caught.getStatus()).toBe(409);
      expect(caught.getResponse()).toMatchObject({
        code: 'STALE_VERSION',
        details: { currentVersion: 1 },
      });
      expect(runs.taskCommand).toHaveBeenCalledWith(expect.objectContaining({
        ownerId: OWNER_ID,
        runId: SEED_RUN_ID,
        taskKey: 'seed-task-1',
        command: 'start',
        expectedVersion: 999,
        idempotencyKey: IDEMPOTENCY_KEY,
      }));
    });
  });

  describe('retry poll contract (N5)', () => {
    it('exposes retryable=true on failed workflow poll responses for transient dependency failures', async () => {
      const operations = createOperationsMock();
      operations.get.mockResolvedValueOnce({
        id: OPERATION_ID,
        kind: 'JOB_TARGET_IMPORT',
        state: WorkflowOperationState.Failed,
        version: 4,
        attempt: 3,
        maxAttempts: 3,
        nextAttemptAt: null,
        result: null,
        error: { code: 'JOB_SOURCE_TIMEOUT', retryable: true },
        createdAt: new Date('2026-09-03T00:00:00Z'),
        updatedAt: new Date('2026-09-03T00:00:05Z'),
        body: null,
      });
      const controller = new WorkflowOperationPublicController(operations as never);
      await expect(controller.get(
        { id: OWNER_ID, email: 'seed@example.test', roles: ['USER'] },
        OPERATION_ID,
      )).resolves.toMatchObject({
        state: 'FAILED',
        attempt: 3,
        error: { code: 'JOB_SOURCE_TIMEOUT', retryable: true },
      });
    });
  });
});
