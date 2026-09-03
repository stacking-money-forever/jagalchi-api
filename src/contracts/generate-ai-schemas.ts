import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { AI_V1_ENDPOINTS, AI_V1_SCHEMAS, stableSchemaJson } from './ai-v1.schemas';

export async function generateAiSchemas(check = false): Promise<void> {
  const directory = resolve(process.cwd(), 'contracts/ai/v1');
  if (!check) await mkdir(directory, { recursive: true });
  const generated = Object.entries(AI_V1_SCHEMAS).sort(([left], [right]) => left.localeCompare(right));
  const hashes: Record<string, string> = {};
  const bundle = createHash('sha256');
  for (const [name, schema] of generated) {
    const path = resolve(directory, name);
    const expected = stableSchemaJson(schema);
    hashes[name] = createHash('sha256').update(expected).digest('hex');
    bundle.update(name).update('\0').update(expected);
    if (check) {
      const actual = await readFile(path, 'utf8');
      if (actual !== expected) throw new Error(`${path} is stale; run pnpm contracts:generate`);
    } else {
      await writeFile(path, expected);
    }
  }
  const manifest = stableSchemaJson({
    schemaVersion: 1,
    endpoints: AI_V1_ENDPOINTS,
    files: hashes,
    bundleSha256: bundle.digest('hex'),
  });
  const manifestPath = resolve(directory, 'manifest.json');
  if (check) {
    if (await readFile(manifestPath, 'utf8') !== manifest) {
      throw new Error(`${manifestPath} is stale; run pnpm contracts:generate`);
    }
  } else {
    await writeFile(manifestPath, manifest);
  }
}

if (require.main === module) {
  void generateAiSchemas(process.argv.includes('--check')).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
