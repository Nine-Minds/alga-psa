import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { durationsFromProgressJournal, readServerUnitDurations, readShardDurations, SERVER_UNIT_DURATIONS_PATH, SHARD_DURATIONS } from '../lib/server-unit-durations.mjs';

const line = (runId, event, file, seconds) => JSON.stringify({ schemaVersion: 1, runId, sequence: 0,
  timestamp: new Date(Date.parse('2026-11-05T07:00:00.000Z') + seconds * 1000).toISOString(), event, file });

test('a file\'s duration is its queued-to-finished span, keyed the way the shard inventory names it', () => {
  const journal = [
    line('run-1', 'initialized', undefined, 0),
    line('run-1', 'module-queued', 'src/test/unit/a.test.ts', 0),
    line('run-1', 'module-started', 'src/test/unit/a.test.ts', 1),
    line('run-1', 'module-started', '../packages/billing/tests/b.test.tsx', 2),
    line('run-1', 'module-finished', 'src/test/unit/a.test.ts', 4),
    line('run-2', 'module-started', '../packages/billing/tests/b.test.tsx', 10),
    line('run-1', 'module-finished', '../packages/billing/tests/b.test.tsx', 9),
    // A second run of the same file (a retried shard) keeps the longer span.
    line('run-2', 'module-finished', '../packages/billing/tests/b.test.tsx', 20),
    // Finished without a queue or a start is a journal cut short, not a zero-length file.
    line('run-1', 'module-finished', 'src/test/unit/c.test.ts', 30),
    '',
  ].join('\n');
  // a: queued at 0, finished at 4 (its import counts); b: never queued in the
  // journal, so started-to-finished stands in, and the retried run's 10 s wins over 7 s.
  assert.deepEqual(durationsFromProgressJournal(journal), {
    'packages/billing/tests/b.test.tsx': 10_000,
    'server/src/test/unit/a.test.ts': 4_000,
  });
});

test('the committed durations document is read from the repository root and validated', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'alga-durations-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(readServerUnitDurations(root), null);
  const file = path.join(root, SERVER_UNIT_DURATIONS_PATH);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ schemaVersion: 1, generatedAt: '2026-11-05T12:00:00.000Z',
    source: { runId: 1 }, files: 1, durationsMs: { 'server/src/test/unit/a.test.ts': 3000 } }));
  assert.deepEqual(readServerUnitDurations(root).durationsMs, { 'server/src/test/unit/a.test.ts': 3000 });
  writeFileSync(file, JSON.stringify({ schemaVersion: 2 }));
  assert.throws(() => readServerUnitDurations(root), /schemaVersion 1/);
  // Every lane keeps its own file beside the scripts, never under data/.
  assert.equal(readShardDurations(root, 'integration'), null);
  for (const lane of Object.keys(SHARD_DURATIONS)) assert.doesNotMatch(SHARD_DURATIONS[lane].path, /(^|\/)data\//);
  assert.throws(() => readShardDurations(root, 'browser'), /No shard durations/);
});
