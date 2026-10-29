import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';

// The production browser job is one definition run once per shard: every shard
// installs the same candidate stack and runs only the suites its matrix entry
// names. Three facts downstream code relies on and nothing else checks:
// - the browser-metrics collector matches exactly one job named
//   "browser / Production browser (<edition>)" and expects it to run the
//   journey-readiness recorder, so exactly one shard per edition may own the
//   `browser` suite and it must be the `browser` lane;
// - every suite a shard names must be one the resolve step knows, or the shard
//   would run nothing for it and still report success;
// - an artifact uploaded by every shard must carry the lane in its name, or
//   the second shard's upload fails on the first one's name.
const workflow = yaml.load(readFileSync('.github/workflows/e2e-fresh-install-tests.yaml', 'utf8'));
const job = workflow.jobs['production-browser'];
const shards = job.strategy.matrix.include;
const resolve = job.steps.find(step => step.id === 'shard');
const known = resolve.run.match(/^\s*known="([^"]+)"$/m)[1].split(' ');
const suitesOf = shard => shard.suites.split(' ');
const byName = name => job.steps.find(step => step.name === name);
const byId = id => job.steps.find(step => step.id === id);

test('the job title is the lane, so the browser shard keeps the name the metrics layer matches', () => {
  assert.equal(job.name, 'Production ${{ matrix.lane }} (${{ matrix.edition }})');
  for (const edition of ['community', 'enterprise']) {
    const browserShards = shards.filter(shard => shard.edition === edition && suitesOf(shard).includes('browser'));
    assert.equal(browserShards.length, 1, `${edition} needs exactly one shard running browser journeys`);
    assert.equal(browserShards[0].lane, 'browser');
  }
});

test('every shard names only known suites, and each edition runs each of its suites exactly once', () => {
  assert.deepEqual(known, ['browser', 'api', 'upgrade', 'citus', 'teams', 'microsoft']);
  for (const shard of shards) {
    assert.ok(shard.lane && shard.suites, `shard ${JSON.stringify(shard)} needs a lane and suites`);
    for (const suite of suitesOf(shard)) assert.ok(known.includes(suite), `${shard.edition}/${shard.lane} names unknown suite ${suite}`);
  }
  const perEdition = edition => shards.filter(shard => shard.edition === edition).flatMap(suitesOf).sort();
  assert.deepEqual(perEdition('community'), ['api', 'browser']);
  assert.deepEqual(perEdition('enterprise'), [...known].sort());
  assert.equal(new Set(shards.map(shard => `${shard.edition}/${shard.lane}`)).size, shards.length, 'lanes are unique within an edition');
});

test('each suite chain starts at a step gated on its resolved suite', () => {
  for (const [step, suite] of [
    [byName('Run Playwright E2E tests'), 'browser'], [byName('Record browser journey readiness'), 'browser'],
    [byName('Upload Playwright diagnostics'), 'browser'], [byName('Upload browser flaky-test evidence'), 'browser'],
    [byId('api_dependencies'), 'api'], [byId('upgrade_schema'), 'upgrade'], [byId('citus_upgrade_service'), 'citus'],
    [byId('teams_development_server'), 'teams'], [byId('microsoft_callback'), 'microsoft'],
  ]) {
    assert.ok(step, `step for ${suite} exists`);
    assert.match(step.if, new RegExp(`steps\\.shard\\.outputs\\.${suite} == 'true'`), `${step.name} gates on the ${suite} suite`);
  }
  assert.match(byId('browser_packages').if, /steps\.shard\.outputs\.playwright == 'true'/, 'Playwright installs only where a suite drives a browser');
  assert.ok(resolve.run.includes('*" browser "*|*" upgrade "*|*" citus "*|*" teams "*) playwright=true'), 'the browser-driving suites are the ones that install Playwright');
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
  assert.ok(uploads.length >= 10, 'the job still publishes its evidence through upload-artifact');
  for (const step of uploads) {
    if (owned.has(step.id ?? step.name)) continue;
    assert.ok(step.with.name.includes('${{ matrix.lane }}'), `${step.name} uploads from every shard and would collide without the lane`);
  }
  assert.ok(byName('Upload logs as artifacts').with.name.includes('${{ matrix.lane }}'));
});
