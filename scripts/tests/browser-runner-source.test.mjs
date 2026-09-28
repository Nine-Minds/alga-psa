import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const source = fileURLToPath(new URL('../..', import.meta.url));
test('browser command rejects dirty source before or during otherwise passing execution', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'alga-browser-source-'));
  try {
    mkdirSync(path.join(root, 'e2e-tests/tests'), { recursive: true });
    mkdirSync(path.join(root, 'scripts'), { recursive: true });
    cpSync(path.join(source, 'scripts/lib'), path.join(root, 'scripts/lib'), { recursive: true });
    cpSync(path.join(source, 'scripts/verify-docker-archive-build.mjs'), path.join(root, 'scripts/verify-docker-archive-build.mjs'));
    cpSync(path.join(source, 'e2e-tests/run.mjs'), path.join(root, 'e2e-tests/run.mjs'));
    writeFileSync(path.join(root, '.gitignore'), 'node_modules/\ne2e-tests/execution-evidence/\n');
    writeFileSync(path.join(root, 'app.txt'), 'original');
    writeFileSync(path.join(root, 'e2e-tests/tests/journey.spec.ts'), '// protocol fixture\n');
    const pkg = path.join(root, 'node_modules/@playwright/test');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ exports: { './cli': './cli.cjs' } }));
    // Simulate the runner report protocol; browser behavior is covered by the real journeys.
    writeFileSync(path.join(pkg, 'cli.cjs'), `
      const fs=require('node:fs'), path=require('node:path');
      const listing=process.argv.includes('--list');
      if(!listing && process.env.MUTATE_SOURCE==='1') fs.writeFileSync(path.resolve('../app.txt'),'changed during execution');
      const retried=!listing && process.env.RETRY_ONLY==='1';
      const results=retried?[{status:'failed',retry:0,errors:[]},{status:'passed',retry:1,errors:[]}]:[{status:'passed',retry:0,errors:[]}];
      const report={config:{rootDir:path.resolve('tests'),metadata:{edition:'enterprise'}},errors:[],
        suites:[{specs:[{file:'journey.spec.ts',title:'persists result',tests:[{projectId:'ee',projectName:'ee',expectedStatus:'passed',status:retried?'flaky':'expected',results:listing?[]:results}]}]}],
        stats:{expected:retried?0:1,unexpected:0,flaky:retried?1:0,skipped:0}};
      fs.writeFileSync(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE,JSON.stringify(report));
    `);
    const git = args => {
      const run = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
      assert.equal(run.status, 0, run.stderr);
    };
    git(['init', '-q']); git(['add', '.']);
    git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']);
    const evidenceFile = name => JSON.parse(readFileSync(path.join(root, `e2e-tests/execution-evidence/${name}.json`), 'utf8'));
    // Uploaded only when something retried, so the weekly report never spends a
    // download on a run with nothing to report.
    const uploaded = path.join(root, 'e2e-tests/execution-evidence/flaky/flaky-tests.json');
    for (const mode of ['clean', 'before', 'during']) {
      writeFileSync(path.join(root, 'app.txt'), mode === 'before' ? 'already changed' : 'original');
      const run = spawnSync(process.execPath, ['e2e-tests/run.mjs'], { cwd: root, encoding: 'utf8', timeout: 10000,
        env: { ...process.env, MUTATE_SOURCE: mode === 'during' ? '1' : '0' } });
      const evidence = evidenceFile('evidence');
      assert.equal(run.status, mode === 'clean' ? 0 : 1, `${mode}: ${run.stderr}`);
      assert.equal(evidence.status, mode === 'clean' ? 'passed' : 'failed');
      assert.equal(evidence.counts.passed, 1);
      // Every run writes the document; nothing is published when it is empty.
      assert.deepEqual(evidenceFile('flaky-tests').tests, []);
      assert.equal(existsSync(uploaded), false, mode);
    }
    // A retry-only pass still fails the gate, and is the evidence the weekly
    // flaky report reads out of the red job.
    writeFileSync(path.join(root, 'app.txt'), 'original');
    const retried = spawnSync(process.execPath, ['e2e-tests/run.mjs'], { cwd: root, encoding: 'utf8', timeout: 10000,
      env: { ...process.env, MUTATE_SOURCE: '0', RETRY_ONLY: '1', GITHUB_RUN_ID: '77', GITHUB_RUN_ATTEMPT: '2' } });
    assert.equal(retried.status, 1, retried.stderr);
    assert.equal(evidenceFile('evidence').counts.flaky, 1);
    const flaky = evidenceFile('flaky-tests');
    assert.match(flaky.revision, /^[a-f0-9]{40}$/);
    assert.deepEqual({ ...flaky, revision: null, tests: undefined }, { schemaVersion: 1, suite: 'production-browser',
      job: 'production-browser (enterprise)', edition: 'enterprise', revision: null, runId: '77', runAttempt: 2, tests: undefined });
    assert.deepEqual(flaky.tests, [{ testId: 'e2e-tests/tests/journey.spec.ts > persists result [ee]',
      file: 'e2e-tests/tests/journey.spec.ts', name: 'persists result', project: 'ee', retryCount: 1 }]);
    // The uploaded copy is the same document, and living under the ignored
    // evidence directory is what keeps the clean-source gate from tripping.
    assert.deepEqual(JSON.parse(readFileSync(uploaded, 'utf8')), flaky);
    assert.equal(evidenceFile('evidence').workingTreeDirty, false);
    // A rerun that retries nothing must not leave the previous flake published.
    writeFileSync(path.join(root, 'app.txt'), 'original');
    const rerun = spawnSync(process.execPath, ['e2e-tests/run.mjs'], { cwd: root, encoding: 'utf8', timeout: 10000,
      env: { ...process.env, MUTATE_SOURCE: '0', RETRY_ONLY: '0' } });
    assert.equal(rerun.status, 0, rerun.stderr);
    assert.equal(existsSync(uploaded), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
