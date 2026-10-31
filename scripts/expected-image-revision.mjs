#!/usr/bin/env node
// Prints the revision label the named candidate image must carry.
import { expectedImageRevision } from './lib/expected-image-revision.mjs';
try {
  const [service] = process.argv.slice(2);
  if (process.argv.length !== 3 || !/^[a-z0-9][a-z0-9-]*$/.test(service ?? '')) throw new Error('Expected one service name');
  process.stdout.write(`${expectedImageRevision({ service })}\n`);
} catch {
  console.error('Expected image revision could not be established');
  process.exitCode = 1;
}
