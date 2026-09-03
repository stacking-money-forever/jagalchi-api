type JsonSchema = Record<string, unknown>;

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface JsonSchemaValidationResult {
  valid: boolean;
  path?: string;
}

export function validateJsonSchema(schema: JsonSchema, value: unknown, path = '$'): JsonSchemaValidationResult {
  if ('const' in schema && value !== schema.const) return { valid: false, path };
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return { valid: false, path };
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { valid: false, path };
    const objectValue = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
    if (Array.isArray(schema.required)) {
      const missing = schema.required.find((key) => !(String(key) in objectValue));
      if (missing !== undefined) return { valid: false, path: `${path}.${String(missing)}` };
    }
    if (schema.additionalProperties === false) {
      const unknown = Object.keys(objectValue).find((key) => !(key in properties));
      if (unknown) return { valid: false, path: `${path}.${unknown}` };
    }
    for (const [key, child] of Object.entries(properties)) {
      if (!(key in objectValue)) continue;
      const result = validateJsonSchema(child, objectValue[key], `${path}.${key}`);
      if (!result.valid) return result;
    }
    return { valid: true };
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return { valid: false, path };
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) return { valid: false, path };
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) return { valid: false, path };
    const items = schema.items as JsonSchema;
    for (let index = 0; index < value.length; index += 1) {
      const result = validateJsonSchema(items, value[index], `${path}[${index}]`);
      if (!result.valid) return result;
    }
    return { valid: true };
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') return { valid: false, path };
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) return { valid: false, path };
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) return { valid: false, path };
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) return { valid: false, path };
    if (schema.format === 'uuid' && !UUID.test(value)) return { valid: false, path };
    if (schema.format === 'date-time' && (!RFC3339.test(value) || Number.isNaN(Date.parse(value)))) return { valid: false, path };
    if (schema.format === 'uri') {
      try { new URL(value); } catch { return { valid: false, path }; }
    }
    return { valid: true };
  }
  if (schema.type === 'integer') {
    if (!Number.isInteger(value)) return { valid: false, path };
    if (typeof schema.minimum === 'number' && Number(value) < schema.minimum) return { valid: false, path };
    if (typeof schema.maximum === 'number' && Number(value) > schema.maximum) return { valid: false, path };
    return { valid: true };
  }
  if (schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return { valid: false, path };
    if (typeof schema.minimum === 'number' && value < schema.minimum) return { valid: false, path };
    if (typeof schema.maximum === 'number' && value > schema.maximum) return { valid: false, path };
    return { valid: true };
  }
  if (schema.type === 'boolean') return { valid: typeof value === 'boolean', ...(typeof value === 'boolean' ? {} : { path }) };
  return { valid: true };
}
