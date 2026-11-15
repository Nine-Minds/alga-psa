import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { parseShard } from '../lib/browser-journey-shards.mjs';

// The production browser job is one definition run once per shard: every shard
// installs the same candidate stack and runs only the suites its matrix entry
// names. The Playwright journeys are split further across `browser-<n>` lanes,
// each running `shard: <index>/<total>` of the files, and the `browser-evidence`
// job merges them back per edition. Facts downstream code relies on and nothing
// else checks:
// - the browser-metrics collector matches exactly one job named
//   "browser / Production browser (<edition>)" and expects it to carry the
//   journey-readiness recorder and the not-selected marker, so that name must
//   belong to `browser-evidence` and to no production-browser shard;
// - an edition's browser lanes must name one total and cover 1..total exactly
//   once, or the merge finds journeys missing or duplicated;
// - every suite a shard names must be one the resolve step knows, or the shard
//   would run nothing for it and still report success;
// - an artifact uploaded by every shard must carry the lane in its name, or
//   the second shard's upload fails on the first one's name.
const workflow = yaml.load(readFileSync('.github/workflows/e2e-fresh-install-tests.yaml', 'utf8'));
const job = workflow.jobs['production-browser'];
const evidence = workflow.jobs['browser-evidence'];
const shards = job.strategy.matrix.include;
const resolve = job.steps.find(step => step.id === 'shard');
const known = resolve.run.match(/^\s*known="([^"]+)"$/m)[1].split(' ');
const suitesOf = shard => shard.suites.split(' ');
const byName = name => job.steps.find(step => step.name === name);
const byId = id => job.steps.find(step => step.id === id);

test('only the per-edition evidence job carries the name, recorder and marker the metrics layer matches', () => {
  assert.equal(evidence.name, 'Production browser (${{ matrix.edition }})');
  assert.deepEqual(evidence.strategy.matrix.edition, ['community', 'enterprise']);
  assert.ok(evidence.needs.includes('production-browser'));
  assert.equal(evidence.if, 'always()');
  assert.equal(job.name, 'Production ${{ matrix.lane }} (${{ matrix.edition }})');
  assert.ok(shards.every(shard => shard.lane !== 'browser'), 'no shard may collide with the evidence job name');
  const recorders = evidence.steps.filter(step => step.name === 'Record browser journey readiness');
  assert.equal(recorders.length, 1);
  assert.match(recorders[0].if, /steps\.merge\.outputs\.complete == 'true'/, 'readiness is recorded only when every shard came up');
  assert.equal(recorders[0]['continue-on-error'], true);
  assert.equal(job.steps.filter(step => step.name === 'Record browser journey readiness').length, 0);
  assert.equal(job.steps.filter(step => step.name === 'Record browser tests not selected').length, 0);
  assert.equal(evidence.steps.filter(step => step.name === 'Record browser tests not selected').length, 1);
});

test('each edition splits its journeys across browser lanes that cover every shard index once', () => {
  for (const edition of ['community', 'enterprise']) {
    const browserShards = shards.filter(shard => shard.edition === edition && suitesOf(shard).includes('browser'));
    assert.ok(browserShards.length >= 2, `${edition} runs its journeys on at least two shards`);
    const specs = browserShards.map(shard => parseShard(shard.shard));
    const totals = new Set(specs.map(spec => spec.total));
    assert.equal(totals.size, 1, `${edition} browser lanes agree on one total`);
    assert.equal([...totals][0], browserShards.length, `${edition} declares as many shards as it has browser lanes`);
    assert.deepEqual(specs.map(spec => spec.index).sort((a, b) => a - b), browserShards.map((_, index) => index + 1));
    for (const shard of browserShards) assert.equal(shard.lane, `browser-${parseShard(shard.shard).index}`, 'lane names its shard index');
    for (const shard of browserShards) assert.deepEqual(suitesOf(shard), ['browser'], 'journey shards run nothing else');
  }
  for (const shard of shards.filter(shard => !suitesOf(shard).includes('browser'))) {
    assert.equal(shard.shard, undefined, `${shard.edition}/${shard.lane} has no journey shard`);
  }
});

test('every shard names only known suites, and each edition runs each other suite exactly once', () => {
  assert.deepEqual(known, ['browser', 'api', 'upgrade', 'citus', 'teams', 'microsoft']);
  for (const shard of shards) {
    assert.ok(shard.lane && shard.suites, `shard ${JSON.stringify(shard)} needs a lane and suites`);
    for (const suite of suitesOf(shard)) assert.ok(known.includes(suite), `${shard.edition}/${shard.lane} names unknown suite ${suite}`);
  }
  const perEdition = edition => shards.filter(shard => shard.edition === edition).flatMap(suitesOf).filter(suite => suite !== 'browser').sort();
  assert.deepEqual(perEdition('community'), ['api']);
  assert.deepEqual(perEdition('enterprise'), known.filter(suite => suite !== 'browser').sort());
  assert.equal(new Set(shards.map(shard => `${shard.edition}/${shard.lane}`)).size, shards.length, 'lanes are unique within an edition');
});

test('each suite chain starts at a step gated on its resolved suite', () => {
  for (const [step, suite] of [
    [byName('Run Playwright E2E tests'), 'browser'], [byName('Upload Playwright diagnostics'), 'browser'],
    [byName('Describe this browser shard'), 'browser'],
    [byId('api_database'), 'api'], [byId('upgrade_schema'), 'upgrade'], [byId('citus_upgrade_service'), 'citus'],
    [byId('teams_development_server'), 'teams'], [byId('microsoft_callback'), 'microsoft'],
  ]) {
    assert.ok(step, `step for ${suite} exists`);
    assert.match(step.if, new RegExp(`steps\\.shard\\.outputs\\.${suite} == 'true'`), `${step.name} gates on the ${suite} suite`);
  }
  assert.match(byId('browser_packages').if, /steps\.shard\.outputs\.playwright == 'true'/, 'Playwright installs only where a suite drives a browser');
  assert.ok(resolve.run.includes('*" browser "*|*" upgrade "*|*" citus "*|*" teams "*) playwright=true'), 'the browser-driving suites are the ones that install Playwright');
  // The upgrade preparation runs tsx and knex and the Citus probe imports pg
  // from the repository's node_modules; the first sharded run failed there.
  assert.match(byId('api_dependencies').if, /steps\.shard\.outputs\.workspace_dependencies == 'true'/);
  assert.ok(resolve.run.includes('*" api "*|*" upgrade "*|*" citus "*|*" teams "*|*" microsoft "*) workspace_dependencies=true'), 'suites that run from root node_modules install them');
});

test('the journey shard travels from the matrix to the runner, the descriptor and the shard artifact', () => {
  assert.equal(byName('Run Playwright E2E tests').env.E2E_SHARD, '${{ matrix.shard }}');
  const describe = byName('Describe this browser shard');
  assert.equal(describe.env.SHARD, '${{ matrix.shard }}');
  assert.ok(describe.run.includes('browser-shard.json'));
  assert.ok(job.steps.indexOf(describe) < job.steps.indexOf(byName('Checkout repository')), 'the descriptor exists before anything can fail');
  const upload = byName('Upload Playwright diagnostics');
  assert.equal(upload.with.name, 'fresh-install-browser-shard-${{ matrix.edition }}-${{ matrix.lane }}');
  assert.ok(upload.with.path.includes('${{ runner.temp }}/browser-shard.json'));
  assert.ok(upload.with.path.includes('${{ runner.temp }}/browser-artifact-manifest.json'));
  assert.ok(upload.with.path.includes('e2e-tests/execution-evidence/'));
  // Both consumers merge from the same shard artifacts into the same name.
  assert.equal(evidence.steps.find(step => step.name === "Download this edition's browser shard evidence").with.pattern, 'fresh-install-browser-shard-${{ matrix.edition }}-*');
  assert.equal(evidence.steps.find(step => step.name === 'Upload merged Playwright execution evidence').with.name, 'fresh-install-playwright-${{ matrix.edition }}');
  assert.equal(evidence.steps.find(step => step.name === 'Upload browser flaky-test evidence').with.name, 'flaky-tests-browser-${{ matrix.edition }}');
  const gate = workflow.jobs['fresh-install-e2e'];
  assert.equal(gate.steps.find(step => step.name === "Download every browser shard's execution artifact").with.pattern, 'fresh-install-browser-shard-*');
  const merge = gate.steps.find(step => step.name === "Merge each edition's browser shards into its execution evidence");
  assert.ok(merge.run.includes('--output "test-results/fresh-install-input/fresh-install-playwright-$edition"'));
  assert.ok(gate.steps.indexOf(merge) < gate.steps.findIndex(step => step.name === 'Require complete production execution'));
});

test('artifacts that every shard uploads carry the lane in their name', () => {
  // A step is suite-owned when it gates on a resolved suite, or on the outcome
  // of a step that is; every other step runs in every shard.
  const owned = new Set();
  for (let grew = true; grew;) {
    grew = false;
    for (const step of job.steps) {
      const id = step.id ?? step.name;
      const condition = step.if ?? '';
      if (owned.has(id)) continue;
      if (/steps\.shard\.outputs\./.test(condition) || [...owned].some(other => condition.includes(`steps.${other}.outcome`))) {
        owned.add(id);
        grew = true;
      }
    }
  }
  const uploads = job.steps.filter(step => step.uses?.startsWith('actions/upload-artifact'));
  assert.ok(uploads.length >= 9, 'the job still publishes its evidence through upload-artifact');
  for (const step of uploads) {
    if (owned.has(step.id ?? step.name)) continue;
    assert.ok(step.with.name.includes('${{ matrix.lane }}'), `${step.name} uploads from every shard and would collide without the lane`);
  }
  assert.ok(byName('Upload logs as artifacts').with.name.includes('${{ matrix.lane }}'));
  // Browser shards of one edition all upload journey evidence, so that name
  // needs the lane too.
  assert.ok(byName('Upload Playwright diagnostics').with.name.includes('${{ matrix.lane }}'));
});
