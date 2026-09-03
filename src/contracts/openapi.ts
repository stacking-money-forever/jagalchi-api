import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import type { ParameterObject, ReferenceObject, SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';

export function createJagalchiOpenApi(app: INestApplication): OpenAPIObject {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('Jagalchi API').setDescription('Jagalchi modular API contract')
      .setVersion('1.0').addBearerAuth().build(),
    { operationIdFactory: (controllerKey, methodKey) => `${controllerKey}_${methodKey}` },
  );
  for (const schema of Object.values(document.components?.schemas ?? {})) {
    const objectSchema = schema as SchemaObject;
    if (objectSchema.type === 'object' && objectSchema.additionalProperties === undefined) {
      objectSchema.additionalProperties = false;
    }
  }
  for (const [path, item] of Object.entries(document.paths)) {
    const names = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]!);
    for (const operation of Object.values(item ?? {})) {
      if (!operation || typeof operation !== 'object' || !('responses' in operation)) continue;
      operation.parameters ??= [];
      for (const name of names) {
        const exists = operation.parameters.some((parameter: ParameterObject | ReferenceObject) =>
          '$ref' in parameter ? false : parameter.in === 'path' && parameter.name === name);
        if (exists) continue;
        const schema = name === 'provider'
          ? { type: 'string' as const, enum: ['google', 'github', 'apple'] }
          : name === 'type'
            ? { type: 'string' as const, enum: ['LIKE', 'FAVORITE'] }
            : name === 'repositoryId'
              ? { type: 'string' as const, pattern: '^[1-9]\\d*$' }
              : name === 'nodeId'
                ? { type: 'string' as const, minLength: 1, maxLength: 128 }
                : { type: 'string' as const, format: 'uuid' };
        operation.parameters.push({ name, in: 'path', required: true, schema });
      }
    }
  }
  const operationIds = Object.values(document.paths).flatMap((path) =>
    Object.values(path ?? {}).flatMap((operation) =>
      operation && typeof operation === 'object' && 'operationId' in operation
        ? [String(operation.operationId)] : []));
  if (new Set(operationIds).size !== operationIds.length) throw new Error('OpenAPI operationIds are not globally unique');
  return document;
}
