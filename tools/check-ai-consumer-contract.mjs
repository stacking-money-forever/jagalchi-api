import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const [producerArgument, consumerArgument] = process.argv.slice(2);
if (!producerArgument || !consumerArgument) {
  throw new Error('usage: node tools/check-ai-consumer-contract.mjs <producer-dir> <consumer-dir>');
}

const producerDir = resolve(producerArgument);
const consumerDir = resolve(consumerArgument);
const schemaNames = (directory) =>
  readdirSync(directory)
    .filter((name) => name.endsWith('.json') && name !== 'manifest.json')
    .sort();

const producerNames = schemaNames(producerDir);
const consumerNames = schemaNames(consumerDir);
if (producerNames.length !== 8 || JSON.stringify(producerNames) !== JSON.stringify(consumerNames)) {
  throw new Error('AI producer and consumer must contain the same eight JSON schemas');
}

for (const name of producerNames) {
  const producer = readFileSync(resolve(producerDir, name));
  const consumer = readFileSync(resolve(consumerDir, name));
  if (!producer.equals(consumer)) {
    throw new Error(`jagalchi-ai consumer snapshot is stale: ${name}`);
  }
}

console.log('jagalchi-ai consumer snapshot matches the API producer contract');
