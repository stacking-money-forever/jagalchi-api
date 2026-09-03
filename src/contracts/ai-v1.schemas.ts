type Schema = Record<string, unknown>;
const string = (maxLength: number, extra: Schema = {}): Schema => ({ type: 'string', maxLength, ...extra });
const array = (items: Schema, maxItems: number, minItems = 0): Schema => ({ type: 'array', items, maxItems, ...(minItems ? { minItems } : {}) });
const object = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({ type: 'object', additionalProperties: false, required, properties });
const operation = { type: 'string', format: 'uuid' };
const version = { const: 1 };
const citation = object({
  id: string(128, { minLength: 1, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' }),
  title: string(300, { minLength: 1 }), url: string(2048, { format: 'uri' }),
  quote: string(2000, { minLength: 1 }),
});
const receipt = object({
  provider: string(80, { minLength: 1 }), model: string(160, { minLength: 1 }),
  providerRequestId: string(200), promptVersion: string(80, { minLength: 1 }),
  inputHash: string(64, { pattern: '^[0-9a-f]{64}$' }), generatedAt: { type: 'string', format: 'date-time' },
  durationMs: { type: 'integer', minimum: 0 }, timeoutBudgetSeconds: { type: 'integer', minimum: 1 }, usage: { type: 'object' },
}, ['provider', 'model', 'providerRequestId', 'promptVersion', 'inputHash', 'generatedAt', 'durationMs', 'timeoutBudgetSeconds']);
const stableId = string(128, { minLength: 1, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' });
const evidenceRule = string(500, { minLength: 1, pattern: '^(pr:changed-path:|pr:named-check:|test:|measurement:|deployment:).+' });
const proposal = object({
  id: stableId, title: string(300, { minLength: 1 }),
  projectBlueprintId: stableId, projectBlueprintVersion: { type: 'integer', minimum: 1 },
  repositoryMode: { enum: ['EXISTING_OWNED', 'OPEN_SOURCE_CONTRIBUTION', 'MANUAL_GREENFIELD'] },
  citedGapIds: array(stableId, 20), citationIds: array(stableId, 20, 1),
  boundedOutcome: string(2000, { minLength: 1 }), nonGoals: array(string(1000, { minLength: 1 }), 10, 1),
  durationHours: { type: 'integer', minimum: 1, maximum: 160 },
  difficulty: { enum: ['EASY', 'MEDIUM', 'HARD'] },
  evidenceRules: array(evidenceRule, 20, 1), confidence: { type: 'number', minimum: 0, maximum: 1 },
  rejectionReasons: array(string(1000, { minLength: 1 }), 10),
});
const envelope = (kind: string, result: Schema): Schema => object({ schemaVersion: version, operationId: operation, kind: { const: kind }, result, citations: array(citation, 100), receipt });
const document = (title: string, schema: Schema): Schema => ({ $schema: 'https://json-schema.org/draft/2020-12/schema', $id: `https://jagalchi.dev/schemas/ai/v1/${title}.schema.json`, title: `Jagalchi AI v1 ${title}`, ...schema });

export const AI_V1_ENDPOINTS = {
  jobPostingExtract: '/ai/internal/v1/job-posting-extract',
  candidateEvidenceInterpret: '/ai/internal/v1/candidate-evidence-interpret',
  projectProposals: '/ai/internal/v1/project-proposals',
  projectPlan: '/ai/internal/v1/project-plan',
} as const;

export const AI_V1_SCHEMAS = {
  'job-posting-extract.request.schema.json': document('job-posting-extract.request', object({ schemaVersion: version, operationId: operation, text: string(50_000, { minLength: 1 }), sourceUrl: string(2048, { format: 'uri' }), sourceTitle: string(300, { minLength: 1 }) }, ['schemaVersion', 'operationId', 'text'])),
  'job-posting-extract.response.schema.json': document('job-posting-extract.response', envelope('job_posting_extract', object({
    company: string(300, { minLength: 1 }), role: string(300, { minLength: 1 }),
    requirements: array(object({
      id: stableId, text: string(2000, { minLength: 1 }), priority: { enum: ['REQUIRED', 'PREFERRED'] },
      sourceSpan: object({
        start: { type: 'integer', minimum: 0 }, end: { type: 'integer', minimum: 1 },
        quote: string(2000, { minLength: 1 }),
      }),
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    }), 100, 1),
    warnings: array(string(1000, { minLength: 1 }), 30),
  }))),
  'candidate-evidence-interpret.request.schema.json': document('candidate-evidence-interpret.request', object({ schemaVersion: version, operationId: operation, objective: string(2000, { minLength: 1 }), evidence: array(citation, 50, 1) })),
  'candidate-evidence-interpret.response.schema.json': document('candidate-evidence-interpret.response', envelope('candidate_evidence_interpret', object({ findings: array(object({ statement: string(2000, { minLength: 1 }), confidence: { type: 'number', minimum: 0, maximum: 1 }, citationIds: array(string(128, { minLength: 1 }), 20, 1) }), 50), gaps: array(string(1000, { minLength: 1 }), 30) }))),
  'project-proposals.request.schema.json': document('project-proposals.request', object({
    schemaVersion: version, operationId: operation, objective: string(2000, { minLength: 1 }),
    findings: array(object({ id: stableId, statement: string(2000, { minLength: 1 }), citationIds: array(stableId, 20, 1) }), 50, 1),
    gaps: array(object({ id: stableId, description: string(1000, { minLength: 1 }) }), 30),
    constraints: array(string(1000, { minLength: 1 }), 30),
  }, ['schemaVersion', 'operationId', 'objective', 'findings', 'gaps'])),
  'project-proposals.response.schema.json': document('project-proposals.response', envelope('project_proposals', object({ proposals: array(proposal, 3, 3) }))),
  'project-plan.request.schema.json': document('project-plan.request', object({ schemaVersion: version, operationId: operation, title: string(300, { minLength: 1 }), selectedProposalId: stableId, proposals: array(proposal, 3, 3), target: { enum: ['project_run', 'proof_mission'] } })),
  'project-plan.response.schema.json': document('project-plan.response', envelope('project_plan', object({ artifact: object({
    id: stableId, schemaVersion: version, title: string(300, { minLength: 1 }), target: { enum: ['project_run', 'proof_mission'] },
    projectBlueprintId: stableId, projectBlueprintVersion: { type: 'integer', minimum: 1 },
    milestones: array(object({ id: stableId, title: string(300, { minLength: 1 }) }), 8, 1),
    tasks: array(object({
      id: stableId, title: string(300, { minLength: 1 }), milestoneId: stableId,
      prerequisiteIds: array(stableId, 3), purpose: string(2000, { minLength: 1 }),
      acceptanceCriteria: array(string(1000, { minLength: 1 }), 20, 1),
      evidenceRules: array(evidenceRule, 20, 1),
      citationIds: array(stableId, 20, 1), gapIds: array(stableId, 20),
    }), 40, 1),
    firstAction: stableId,
  }) }))),
} as const;

export function stableSchemaJson(value: unknown): string { return `${JSON.stringify(value, null, 2)}\n`; }
