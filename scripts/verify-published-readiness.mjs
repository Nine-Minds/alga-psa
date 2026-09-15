#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { verifyPublishedReadiness } from './lib/published-readiness.mjs';
const [revision, output] = process.argv.slice(2);
const result = process.argv.length === 4
  ? await verifyPublishedReadiness({ revision, token: process.env.GITHUB_TOKEN })
  : { status: 'failed', failures: ['Usage: node scripts/verify-published-readiness.mjs <full-commit-sha> <output.json>'] };
if (output) writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
for (const failure of result.failures) console.error(failure);
process.exitCode = result.status === 'passed' ? 0 : 1;
