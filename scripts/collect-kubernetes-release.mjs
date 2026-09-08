#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { collectKubernetesRelease } from './lib/collect-kubernetes-release.mjs';
const [targetFile, outputFile] = process.argv.slice(2);
try {
  if (process.argv.length !== 4) throw new Error('Usage: node scripts/collect-kubernetes-release.mjs <target.json> <observations.json>');
  // Clear stale successful evidence before any runtime query can fail.
  mkdirSync(path.dirname(outputFile), { recursive: true });
  writeFileSync(outputFile, '');
  const result = collectKubernetesRelease(JSON.parse(readFileSync(targetFile, 'utf8')));
  writeFileSync(outputFile, JSON.stringify(result.observations, null, 2) + '\n');
  writeFileSync(`${outputFile}.metadata.json`, JSON.stringify({ ...result, observations: undefined }, null, 2) + '\n');
} catch (error) { console.error(error.message); process.exitCode = 1; }
