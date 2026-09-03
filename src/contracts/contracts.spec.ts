import { describe, expect, it } from 'vitest';
import { generateAiSchemas } from './generate-ai-schemas';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isProjectRunProjection } from '../project-runs/project-run.projection';

type JsonSchema = Record<string, unknown>;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function acceptsOpenApi(document: JsonSchema, rawSchema: JsonSchema, value: unknown): boolean {
  const ref = rawSchema.$ref;
  const schema = typeof ref === 'string'
    ? ref.slice(2).split('/').reduce<unknown>((current, key) => (current as JsonSchema)[key], document) as JsonSchema
    : rawSchema;
  if (value === null) return schema.nullable === true || rawSchema.nullable === true;
  if (Array.isArray(schema.allOf)) return schema.allOf.every((item) => acceptsOpenApi(document, item as JsonSchema, value));
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false;
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const objectValue = value as JsonSchema;
    const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
    if (Array.isArray(schema.required) && schema.required.some((key) => !(String(key) in objectValue))) return false;
    if (schema.additionalProperties === false && Object.keys(objectValue).some((key) => !(key in properties))) return false;
    return Object.entries(properties).every(([key, child]) => !(key in objectValue) || acceptsOpenApi(document, child, objectValue[key]));
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value) || (typeof schema.maxItems === 'number' && value.length > schema.maxItems)) return false;
    return value.every((item) => acceptsOpenApi(document, schema.items as JsonSchema, item));
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string' || (typeof schema.minLength === 'number' && value.length < schema.minLength) || (typeof schema.maxLength === 'number' && value.length > schema.maxLength)) return false;
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) return false;
    if (schema.format === 'uuid' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return false;
    if (schema.format === 'date-time' && (!RFC3339.test(value) || Number.isNaN(Date.parse(value)))) return false;
  }
  if (schema.type === 'integer' && (!Number.isInteger(value) || (typeof schema.minimum === 'number' && Number(value) < schema.minimum))) return false;
  if (schema.type === 'boolean' && typeof value !== 'boolean') return false;
  return true;
}

describe('generated service contracts', () => {
  it('keeps checked-in AI v1 JSON schemas fresh', async () => {
    await expect(generateAiSchemas(true)).resolves.toBeUndefined();
  });

  it('pins the enriched internal AI lineage contracts', async () => {
    const extract = JSON.parse(await readFile(resolve(process.cwd(), 'contracts/ai/v1/job-posting-extract.response.schema.json'), 'utf8'));
    const requirement = extract.properties.result.properties.requirements.items;
    expect(requirement.required).toEqual(expect.arrayContaining(['id', 'text', 'priority', 'sourceSpan', 'confidence']));
    expect(requirement.properties.sourceSpan.additionalProperties).toBe(false);
    const proposals = JSON.parse(await readFile(resolve(process.cwd(), 'contracts/ai/v1/project-proposals.response.schema.json'), 'utf8'));
    expect(proposals.properties.result.properties.proposals.items.required).toEqual(expect.arrayContaining([
      'projectBlueprintId', 'projectBlueprintVersion', 'repositoryMode', 'citedGapIds',
      'boundedOutcome', 'nonGoals', 'durationHours', 'difficulty', 'evidenceRules',
      'confidence', 'rejectionReasons',
    ]));
    const plan = JSON.parse(await readFile(resolve(process.cwd(), 'contracts/ai/v1/project-plan.response.schema.json'), 'utf8'));
    const artifact = plan.properties.result.properties.artifact;
    expect(artifact.required).toEqual(expect.arrayContaining([
      'projectBlueprintId', 'projectBlueprintVersion', 'milestones', 'tasks', 'firstAction',
    ]));
    expect(artifact.properties.tasks.items.required).toEqual(expect.arrayContaining([
      'gapIds', 'citationIds', 'evidenceRules',
    ]));
  });

  it('uses the compiled Nest generator for production OpenAPI freshness', async () => {
    const manifest = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8'));
    expect(manifest.scripts['openapi:generate']).toContain('node dist/contracts/generate-openapi.js');
    expect(manifest.scripts['openapi:check']).toContain('node dist/contracts/generate-openapi.js --check');
  });

  it('publishes a closed, typed ProjectRun projection contract', async () => {
    const document = JSON.parse(await readFile(resolve(process.cwd(), 'contracts/openapi.json'), 'utf8'));
    const schema = document.components.schemas.ProjectRunProjectionDto;
    expect(schema.additionalProperties).toBe(false);
    const task = document.components.schemas.ProjectRunTaskDto;
    expect(task.additionalProperties ?? false).toBe(false);
    expect(task.required).toEqual(expect.arrayContaining([
      'title', 'required', 'milestoneId', 'prerequisiteIds', 'purpose', 'acceptanceCriteria', 'evidenceRequirements',
    ]));
    expect(document.components.schemas.ProjectRunMapNodeDto.additionalProperties ?? false).toBe(false);
    expect(document.components.schemas.ProjectRunMapNodeDto.properties.title.maxLength).toBe(300);
    expect(document.components.schemas.ProjectRunMapEdgeDto.properties.kind.enum).toEqual(['PREREQUISITE', 'SEQUENCE']);
    expect(document.components.schemas.ProjectRunProofDto.additionalProperties ?? false).toBe(false);
    expect(document.components.schemas.ProjectRunProofDto.properties.validUntil.format).toBe('date-time');
    expect(schema.properties.tasks.maxItems).toBe(40);
    expect(document.paths['/api/project-runs/{id}'].get.parameters[0].schema.format).toBe('uuid');
    expect(document.paths['/api/users'].post.requestBody.content['application/json'].schema.$ref).toContain('RegisterDto');
    expect(document.paths['/api/ai/jobs'].post.requestBody.content['application/json'].schema.$ref).toContain('RunAiJobDto');
    expect(document.paths['/api/v1/operations/project-plan'].post.requestBody).toBeDefined();
    const operationIds = Object.values(document.paths).flatMap((item) =>
      Object.values(item as Record<string, { operationId: string }>).map((operation) => operation.operationId));
    expect(new Set(operationIds).size).toBe(operationIds.length);
  });

  it('rejects the same representative bound violations in runtime and generated OpenAPI', async () => {
    const document = JSON.parse(await readFile(resolve(process.cwd(), 'contracts/openapi.json'), 'utf8')) as JsonSchema;
    const schema = ((document.components as JsonSchema).schemas as Record<string, JsonSchema>).ProjectRunProjectionDto!;
    const valid = {
      id: '00000000-0000-4000-8000-000000000001', state: 'READY', version: 1,
      currentTaskId: 'task-1', recommendedTaskId: 'task-1', plan: { id: 'plan-1', schemaVersion: 1 },
      map: { nodes: [{ id: 'task-1', title: 'Ship', milestoneId: 'milestone-1', state: 'READY' }], edges: [] },
      tasks: [{ id: 'task-1', title: 'Ship', state: 'READY', required: true, milestoneId: 'milestone-1', prerequisiteIds: [], purpose: '', acceptanceCriteria: ['Pass'], evidenceRequirements: ['PR'] }],
      proof: { summary: '', validUntil: '2026-09-03T10:00:00+09:00', publication: { state: 'ACTIVE', publicId: 'proof-1' }, verification: { state: 'PASS', verifiedAt: '2026-09-03T10:00:00Z' } },
    };
    expect(isProjectRunProjection(valid)).toBe(true);
    expect(acceptsOpenApi(document, schema, valid)).toBe(true);
    const invalid: unknown[] = [];
    const mutate = (change: (copy: typeof valid) => void) => { const copy = structuredClone(valid); change(copy); invalid.push(copy); };
    mutate((copy) => { copy.version = 0; });
    mutate((copy) => { copy.plan.schemaVersion = 0; });
    mutate((copy) => { copy.tasks[0]!.id = ''; copy.map.nodes[0]!.id = ''; copy.currentTaskId = null; copy.recommendedTaskId = null; });
    mutate((copy) => { copy.tasks[0]!.title = ''; });
    mutate((copy) => { copy.map.nodes[0]!.title = 'x'.repeat(301); });
    mutate((copy) => { copy.tasks[0]!.acceptanceCriteria = ['']; });
    mutate((copy) => { copy.tasks[0]!.evidenceRequirements = ['x'.repeat(1001)]; });
    mutate((copy) => { copy.proof.validUntil = '2026-09-03'; });
    for (const value of invalid) {
      expect(isProjectRunProjection(value)).toBe(false);
      expect(acceptsOpenApi(document, schema, value)).toBe(false);
    }
  });
});
