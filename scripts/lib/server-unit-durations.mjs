import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Per-file wall time of the full server unit suite, measured on main and
// committed, so every shard and the merge job partition from the same numbers.
// scripts/update-server-unit-durations.mjs refreshes it from the newest main
// run's merged progress journal; a stale file only balances approximately, and
// a missing one falls back to the modulo split.
// Not under a data/ directory: the root .gitignore drops every one of those.
export const SERVER_UNIT_DURATIONS_PATH = 'scripts/server-unit-durations.json';

export function readServerUnitDurations(root) {
  const file = path.join(root, SERVER_UNIT_DURATIONS_PATH);
  if (!existsSync(file)) return null;
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  if (parsed?.schemaVersion !== 1 || !parsed.durationsMs || typeof parsed.durationsMs !== 'object') {
    throw new Error(`${SERVER_UNIT_DURATIONS_PATH} is not a schemaVersion 1 durations document`);
  }
  return parsed;
}

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
