export interface LegacySchemaValidationResult {
  valid: boolean;
  path?: string;
}

type Schema = Record<string, unknown>;

export function validateLegacyAiSchema(
  schema: Schema,
  value: unknown,
  path = '$',
): LegacySchemaValidationResult {
  if (value === null && schema.nullable === true) return { valid: true };
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return { valid: false, path };
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { valid: false, path };
    const objectValue = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, Schema>;
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
      const result = validateLegacyAiSchema(child, objectValue[key], `${path}.${key}`);
      if (!result.valid) return result;
    }
    return { valid: true };
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return { valid: false, path };
    const items = schema.items as Schema;
    for (let index = 0; index < value.length; index += 1) {
      const result = validateLegacyAiSchema(items, value[index], `${path}[${index}]`);
      if (!result.valid) return result;
    }
    return { valid: true };
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') return { valid: false, path };
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      return { valid: false, path };
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      return { valid: false, path };
    }
    return { valid: true };
  }
  if (schema.type === 'integer') {
    if (!Number.isInteger(value)) return { valid: false, path };
    if (typeof schema.minimum === 'number' && Number(value) < schema.minimum) {
      return { valid: false, path };
    }
    if (typeof schema.maximum === 'number' && Number(value) > schema.maximum) {
      return { valid: false, path };
    }
    return { valid: true };
  }
  if (schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return { valid: false, path };
    return { valid: true };
  }
  if (schema.type === 'boolean') {
    return typeof value === 'boolean' ? { valid: true } : { valid: false, path };
  }
  return { valid: false, path };
}
