#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { verifyReleasePromotion } from './lib/release-test-evidence.mjs';

// Policy is a consumer-owned release configuration, never supplied by the
// producer evidence. Observations must come from the actual target runtime.
const [policyFile, manifestFile, evidenceFile, observationsFile, outputFile] = process.argv.slice(2);
let result;
try {
  if (process.argv.length !== 7) throw new Error('Usage: node scripts/verify-release-promotion.mjs <policy.json> <manifest.json> <evidence.json> <runtime-observations.json> <output.json>');
  const read = file => JSON.parse(readFileSync(file, 'utf8'));
  const policy = read(policyFile);
  result = verifyReleasePromotion({ revision: policy.revision, edition: policy.edition,
    requiredComponents: policy.requiredComponents, requiredChecks: policy.requiredChecks,
    manifest: read(manifestFile), evidence: read(evidenceFile), observations: read(observationsFile) });
} catch (error) { result = { schemaVersion: 1, scope: 'release-promotion-identities', status: 'failed', failures: [error.message] }; }
if (outputFile) {
  mkdirSync(path.dirname(outputFile), { recursive: true });
  writeFileSync(outputFile, JSON.stringify(result, null, 2) + '\n');
}
for (const failure of result.failures) console.error(failure);
process.exitCode = result.status === 'passed' ? 0 : 1;
