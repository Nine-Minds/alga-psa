import { readFileSync } from 'node:fs';
import path from 'node:path';

// The gate's committed requirement selects the artifact directory, filenames,
// format and producer checkout root. Job outcomes come from CI, not the report.
export function readCandidateExecutionBundle({ id, format, directory, sourceRoot, outcome, files = {} }) {
  if (typeof sourceRoot !== 'string' || !path.isAbsolute(sourceRoot)) throw new Error(`Missing producer checkout root: ${id}`);
  const read = (key, fallback, json = true) => {
    const value = readFileSync(path.resolve(directory, files[key] ?? fallback), 'utf8');
    return json ? JSON.parse(value) : value;
  };
  const evidence = read('evidence', 'evidence.json');
  if (evidence.schemaVersion !== 1) throw new Error(`Unsupported execution evidence: ${id}`);
  const bundle = { id, sourceRoot, outcome, source: evidence.source, producerStatus: evidence.status,
    filters: evidence.selection?.filters };
  if (format === 'node-events') {
    // Node suite entry points reject CLI filters and label full selection.
    bundle.filters = evidence.selection?.mode === 'full' ? evidence.selection.filters ?? [] : undefined;
    bundle.events = read('events', 'events.jsonl', false).split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
  } else if (format === 'vitest' || format === 'playwright') {
    bundle.collected = read('collected', 'collected.json');
    bundle.report = read('report', 'results.json');
    if (format === 'vitest') bundle.collectedTests = read('collectedTests', 'collected-tests.json');
  } else {
    throw new Error(`Unsupported execution format: ${format}`);
  }
  return bundle;
}
