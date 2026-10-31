#!/usr/bin/env node
// Refresh e2e-tests/journey-weights.json from a Playwright JSON report.
//
//   node scripts/update-browser-journey-weights.mjs <results.json> [<results.json> ...] [--source "<where the reports came from>"]
//
// Each report contributes its own edition (from config.metadata.edition). A
// file's weight is the whole wall time Playwright spent in it, every attempt
// included, in whole seconds. Files absent from a report keep their old weight.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { playwrightTests } from './lib/playwright-execution-evidence.mjs';

export function journeyWeightsFromReport(report, root) {
  const edition = report?.config?.metadata?.edition;
  if (!['community', 'enterprise'].includes(edition)) throw new Error('Report names no edition');
  const seconds = new Map();
  for (const entry of playwrightTests(report, root)) {
    const spent = (Array.isArray(entry.results) ? entry.results : [])
      .reduce((sum, result) => sum + (typeof result.duration === 'number' ? result.duration : 0), 0);
    seconds.set(entry.file, (seconds.get(entry.file) ?? 0) + spent);
  }
  return { edition, weights: Object.fromEntries([...seconds].sort(([a], [b]) => a.localeCompare(b))
    .map(([file, ms]) => [file, Math.round(ms / 1000)])) };
}

export function mergeJourneyWeights(profile, { edition, weights }, { source } = {}) {
  const editions = { ...profile.editions, [edition]: { ...profile.editions?.[edition], ...weights } };
  for (const name of Object.keys(editions)) {
    editions[name] = Object.fromEntries(Object.entries(editions[name]).sort(([a], [b]) => a.localeCompare(b)));
  }
  return { ...profile, ...(source ? { source } : {}), editions };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const target = path.join(root, 'e2e-tests', 'journey-weights.json');
  const args = process.argv.slice(2);
  const sourceIndex = args.indexOf('--source');
  const source = sourceIndex === -1 ? undefined : args.splice(sourceIndex, 2)[1];
  if (!args.length) throw new Error('usage: update-browser-journey-weights.mjs <results.json> [...] [--source <text>]');
  let profile = JSON.parse(readFileSync(target, 'utf8'));
  for (const file of args) {
    const update = journeyWeightsFromReport(JSON.parse(readFileSync(file, 'utf8')), root);
    profile = mergeJourneyWeights(profile, update, { source });
    console.log(`${update.edition}: ${Object.keys(update.weights).length} journey files from ${file}`);
  }
  writeFileSync(target, JSON.stringify(profile, null, 2) + '\n');
}
