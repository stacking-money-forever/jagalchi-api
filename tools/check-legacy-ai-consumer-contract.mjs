import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import vm from 'node:vm';

import ts from 'typescript';

const [consumerArgument, producerArgument = 'src/ai/legacy-ai-job-contract.ts'] =
  process.argv.slice(2);
if (!consumerArgument) {
  throw new Error(
    'usage: node tools/check-legacy-ai-consumer-contract.mjs <jagalchi-ai legacy manifest> [producer contract ts]',
  );
}

function loadProducer(path) {
  const source = readFileSync(path, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2023,
    },
    fileName: path,
    reportDiagnostics: true,
  });
  if (output.diagnostics?.length) {
    throw new Error('Nest legacy AI producer contract does not transpile');
  }
  const exports = {};
  const sandbox = { exports, module: { exports } };
  vm.runInNewContext(output.outputText, sandbox, { filename: path, timeout: 1_000 });
  const contract = sandbox.module.exports.LEGACY_AI_JOB_CONTRACTS;
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    throw new Error('Nest legacy AI producer contract is missing');
  }
  return JSON.parse(JSON.stringify(contract));
}

const producer = loadProducer(producerArgument);
const consumer = JSON.parse(readFileSync(consumerArgument, 'utf8'));
if (
  consumer.schemaVersion !== 1 ||
  consumer.visibility !== 'legacy-server-to-server-through-nest-only' ||
  !Array.isArray(consumer.jobs) ||
  consumer.jobs.length !== 7
) {
  throw new Error('Django legacy AI consumer manifest identity is invalid');
}

const consumerByFeature = new Map();
for (const job of consumer.jobs) {
  if (!job || typeof job.feature !== 'string' || consumerByFeature.has(job.feature)) {
    throw new Error('Django legacy AI consumer contains an invalid or duplicate feature');
  }
  consumerByFeature.set(job.feature, job);
}

const producerFeatures = Object.keys(producer).sort();
const consumerFeatures = [...consumerByFeature.keys()].sort();
if (
  producerFeatures.length !== 7 ||
  !isDeepStrictEqual(producerFeatures, consumerFeatures)
) {
  throw new Error('Nest and Django must expose the same exact seven legacy AI jobs');
}

for (const feature of producerFeatures) {
  const expected = producer[feature];
  const actual = consumerByFeature.get(feature);
  for (const field of ['method', 'path', 'request', 'response']) {
    if (!isDeepStrictEqual(expected[field], actual[field])) {
      throw new Error(`Legacy AI ${feature} ${field} contract differs from Django`);
    }
  }
}

console.log('Nest legacy AI producer matches all seven Django consumer contracts');
