import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import config from '../../stryker.config.mjs';

const report = JSON.parse(readFileSync('reports/mutation/mutation.json', 'utf8'));
assert.deepEqual(Object.keys(report.files).sort(), [...config.mutate].sort(), 'Mutation report must cover the complete configured pilot');
assert.equal(Object.keys(report.testFiles ?? {}).length, 2, 'Both maintained behavioral suites must run');
const files = Object.entries(report.files).map(([file, data]) => {
  assert.equal(data.source, readFileSync(file, 'utf8'), `Stale mutation source: ${file}`);
  assert.ok(data.mutants.length > 0, `No mutations generated for ${file}`);
  assert.ok(data.mutants.some(m => m.status === 'Killed'), `No behavioral detection in ${file}`);
  assert.ok(data.mutants.every(m => ['Killed', 'Survived', 'NoCoverage'].includes(m.status)), `Mutation execution error or timeout in ${file}`);
  return { file, sourceSha256: createHash('sha256').update(data.source).digest('hex'),
    statuses: data.mutants.reduce((counts, m) => ({ ...counts, [m.status]: (counts[m.status] ?? 0) + 1 }), {}),
    remaining: data.mutants.filter(m => m.status !== 'Killed').map(m => ({
      id: m.id, status: m.status, mutator: m.mutatorName, location: m.location, replacement: m.replacement,
    })),
  };
});
const summary = {
  schemaVersion: 1, kind: 'scoped-mutation-pilot', enforcement: 'report-only-score',
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  workingTreeDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()),
  runtime: process.version, framework: report.framework, files,
};
writeFileSync('reports/mutation/summary.json', JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
