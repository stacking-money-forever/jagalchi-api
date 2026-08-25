export const ROADMAP_OPERATION_TYPES = [
  'NODE_CREATE',
  'NODE_UPDATE',
  'NODE_DELETE',
  'EDGE_CREATE',
  'EDGE_UPDATE',
  'EDGE_DELETE',
  'SECTION_CREATE',
  'SECTION_UPDATE',
  'SECTION_DELETE',
  'TEXT_CREATE',
  'TEXT_UPDATE',
  'TEXT_DELETE',
  'GROUP_CREATE',
  'GROUP_UPDATE',
  'GROUP_DELETE',
  'RESOURCE_CREATE',
  'RESOURCE_UPDATE',
  'RESOURCE_DELETE',
] as const;

export type RoadmapOperationType = (typeof ROADMAP_OPERATION_TYPES)[number];

export interface RoadmapOperation {
  type: RoadmapOperationType;
  targetId: string;
  value?: Record<string, unknown>;
}

export interface EditRequest {
  roadmapId: string;
  idempotencyKey: string;
  baseSequence: number;
  operation: RoadmapOperation;
}

export interface EditAck {
  ok: true;
  duplicate: boolean;
  sequence: number;
  eventId: string;
}

export interface EditNack {
  ok: false;
  code: 'INVALID_OPERATION' | 'FORBIDDEN' | 'SEQUENCE_CONFLICT' | 'INTERNAL_ERROR';
  message: string;
  currentSequence?: number;
}

export function parseEditRequest(value: unknown): EditRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  const keys = Object.keys(request);
  if (
    keys.some(
      (key) =>
        !['roadmapId', 'idempotencyKey', 'baseSequence', 'operation'].includes(key),
    ) ||
    typeof request.roadmapId !== 'string' ||
    !/^[0-9a-f-]{36}$/i.test(request.roadmapId) ||
    typeof request.idempotencyKey !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(request.idempotencyKey) ||
    !Number.isSafeInteger(request.baseSequence) ||
    (request.baseSequence as number) < 0 ||
    !request.operation ||
    typeof request.operation !== 'object' ||
    Array.isArray(request.operation)
  ) {
    return null;
  }
  const operation = request.operation as Record<string, unknown>;
  if (
    Object.keys(operation).some((key) => !['type', 'targetId', 'value'].includes(key)) ||
    !ROADMAP_OPERATION_TYPES.includes(operation.type as RoadmapOperationType) ||
    typeof operation.targetId !== 'string' ||
    operation.targetId.length < 1 ||
    operation.targetId.length > 120 ||
    (operation.value !== undefined &&
      (!operation.value ||
        typeof operation.value !== 'object' ||
        Array.isArray(operation.value) ||
        JSON.stringify(operation.value).length > 64_000))
  ) {
    return null;
  }
  return request as unknown as EditRequest;
}
