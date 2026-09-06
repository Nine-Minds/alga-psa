import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reconcileDiscovery, repositoryTestFiles } from './test-discovery.mjs';
import { reconcileNodeExecution } from './node-test-execution.mjs';
import { testRevision } from './test-revision.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
export function runNodeSuite({ suite, isCandidate, exclusionFile, prepare = [] }) {
  const output = path.join(root, 'test-results', suite);
  mkdirSync(output, { recursive: true });
  const eventPath = path.join(output, 'events.jsonl');
  const logPath = path.join(output, 'runner.log');
  const evidencePath = path.join(output, 'evidence.json');
  const discoveryPath = path.join(output, 'discovery.json');
  for (const file of [eventPath, logPath, evidencePath, discoveryPath]) writeFileSync(file, '');
  let before;
  let evidence;
  try {
    if (process.argv.length !== 2) throw new Error(`Usage: node scripts/run-${suite}-tests.mjs (complete suite; no filters)`);
    before = testRevision(root);
    const candidates = repositoryTestFiles(root).filter(isCandidate);
    const exclusions = exclusionFile ? JSON.parse(readFileSync(path.join(root, exclusionFile), 'utf8')) : [];
    const excluded = new Set(exclusions.map(({ file }) => file));
    const files = candidates.filter((file) => !excluded.has(file));
    if (!files.length) throw new Error('Required Node test inventory is empty');
    // Validate exclusions before execution; only actual Node completion summaries
    // are used as runner collection evidence below.
    const selection = reconcileDiscovery({ root, candidates, exclusions, collections: [{ runner: suite, status: 'passed', files }] });
    if (selection.status !== 'passed') throw new Error(selection.failures.join('\n'));
    // Preparation is part of the runner so local and CI execution cannot rely
    // on a stale ignored build. Commands are fixed by the suite entry point.
    for (const { command, args } of prepare) {
      const build = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
      if (build.status !== 0) throw new Error(`Required suite preparation failed: ${command} ${args.join(' ')} (exit ${build.status})`);
    }
    console.log(`${suite}: ${files.length} required files, ${exclusions.length} explicit manual exclusion(s)`);
    const result = spawnSync(process.execPath, [
      '--test', '--test-concurrency=1', '--test-timeout=120000',
      `--test-reporter=${path.join(root, 'scripts/lib/node-test-reporter.mjs')}`,
      `--test-reporter-destination=${eventPath}`,
      '--test-reporter=spec', `--test-reporter-destination=${logPath}`,
      ...files.map((file) => path.join(root, file)),
    ], {
      cwd: root, stdio: 'inherit',
      env: { ...process.env, NODE_TEST_CONTEXT: undefined, SKIP_DB_TESTS: '1', DB_USER_ADMIN: '', DB_PASSWORD_ADMIN: '' },
    });
    const events = readFileSync(eventPath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    evidence = reconcileNodeExecution({ root, suite, revision: before.revision, files, events, exitCode: result.status });
    const discovery = reconcileDiscovery({
      root, candidates, exclusions,
      collections: [{ runner: suite, status: result.status === 0 ? 'passed' : 'failed', files: evidence.executedFiles }],
    });
    writeFileSync(discoveryPath, JSON.stringify(discovery, null, 2) + '\n');
    if (discovery.status !== 'passed') { evidence.status = 'failed'; evidence.failures.push(...discovery.failures); }
    evidence.exclusions = exclusions;
    console.log(readFileSync(logPath, 'utf8'));
  } catch (error) {
    evidence = { schemaVersion: 1, suite, revision: before?.revision, status: 'failed', failures: [error.message] };
  }
  evidence.selection = { mode: 'full' };
  try {
    const after = testRevision(root);
    evidence.source = { before, after };
    evidence.workingTreeDirty = Boolean(before?.dirty || after.dirty);
    if (before?.revision !== after.revision) { evidence.status = 'failed'; evidence.failures.push('Repository revision changed during testing'); }
  } catch (error) { evidence.status = 'failed'; evidence.failures.push(error.message); }
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
  for (const failure of evidence.failures) console.error(failure);
  process.exitCode = evidence.status === 'passed' ? 0 : 1;

}
