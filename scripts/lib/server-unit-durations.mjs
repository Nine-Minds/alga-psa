import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Per-file fork occupancy of a sharded lane, measured on main and committed,
// so every shard and its merge or gate job partition from the same numbers.
// scripts/update-shard-durations.mjs <lane> refreshes a file from the newest
// main run's progress journals; a stale file only balances approximately, and
// a missing one falls back to the modulo split. Not under a data/ directory:
// the root .gitignore drops every one of those.
export const SHARD_DURATIONS = Object.freeze({
  'server-unit': { path: 'scripts/server-unit-durations.json', artifacts: ['server-unit-execution'],
    member: 'test-results/server-coverage/progress.jsonl' },
  integration: { path: 'scripts/integration-durations.json',
    // One upload path, so the archive holds the directory's contents at its root.
    artifacts: [1, 2, 3, 4].map(shard => `server-integration-shard-${shard}`), member: 'progress.jsonl' },
});
export const SERVER_UNIT_DURATIONS_PATH = SHARD_DURATIONS['server-unit'].path;

export function readShardDurations(root, lane) {
  const lanePath = SHARD_DURATIONS[lane]?.path;
  if (!lanePath) throw new Error(`No shard durations are kept for lane ${lane}`);
  const file = path.join(root, lanePath);
  if (!existsSync(file)) return null;
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  if (parsed?.schemaVersion !== 1 || !parsed.durationsMs || typeof parsed.durationsMs !== 'object') {
    throw new Error(`${lanePath} is not a schemaVersion 1 durations document`);
  }
  return parsed;
}

export const readServerUnitDurations = root => readShardDurations(root, 'server-unit');

// The journal names files relative to server/; the shard inventory is relative
// to the repository root. A file's cost is the whole time it holds a fork:
// module-queued (handed to a fresh fork) to module-finished, so spawn, import
// and collection count — on main they are two thirds of every fork-minute,
// the tests themselves one third. A journal cut short of the queued event
// falls back to the started one, and a file that ran more than once keeps its
// longest span.
export function durationsFromProgressJournal(journal) {
  const opened = new Map();
  const durations = {};
  for (const line of journal.split('\n')) {
    if (!line.trim()) continue;
    const event = JSON.parse(line);
    if (typeof event.file !== 'string' || typeof event.runId !== 'string') continue;
    const key = `${event.runId}\0${event.file}`;
    const at = Date.parse(event.timestamp);
    if (!Number.isFinite(at)) continue;
    if (event.event === 'module-queued' || (event.event === 'module-started' && !opened.has(key))) opened.set(key, at);
    if (event.event === 'module-finished' && opened.has(key)) {
      const file = event.file.startsWith('../') ? event.file.slice(3) : `server/${event.file}`;
      durations[file] = Math.max(durations[file] ?? 0, at - opened.get(key));
      opened.delete(key);
    }
  }
  return Object.fromEntries(Object.keys(durations).sort().map(file => [file, durations[file]]));
}
