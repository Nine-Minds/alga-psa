import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
import { assertSourceLabels, labelsOf } from '../verify-trusted-tree-image.mjs';

// Only code on main may create or move a `tree-<hash>` tag, because the Argo
// build copies whatever sits under the tree of the commit it deploys. These
// checks read the workflows the way GitHub resolves them: a called workflow's
// token is capped by the caller's grant, and a job with no `permissions:`
// inherits it.
const load = file => yaml.load(readFileSync(`.github/workflows/${file}`, 'utf8'));
const caller = load('production-regression.yml');
const callee = load('e2e-fresh-install-tests.yaml');
const LEVEL = { none: 0, read: 1, write: 2 };
const level = value => LEVEL[value ?? 'none'];
const asMap = permissions => permissions === 'write-all' ? { '*': 'write' } : permissions ?? {};
const grants = (permissions, scope) => level(asMap(permissions)[scope] ?? asMap(permissions)['*']);

// A caller job can run on a pull request unless its condition names another event.
const runsOnPullRequest = job => !job.if
  || !/github\.event_name\s*==\s*'(push|workflow_dispatch)'/.test(job.if) && !/github\.event_name\s*!=\s*'pull_request'/.test(job.if);

// What a called job's token is: its own declaration, else the workflow's, else the caller's.
const effective = (job, calling) => job.permissions ?? callee.permissions ?? calling.permissions;
const calls = Object.entries(caller.jobs).filter(([, job]) => job.uses?.endsWith('e2e-fresh-install-tests.yaml'));

test('the browser lane is called from a pull-request job and a trusted job', () => {
  assert.deepEqual(calls.map(([name]) => name).sort(), ['browser-pr', 'browser-trusted']);
  assert.equal(caller.jobs.browser.needs.sort().join(), 'browser-pr,browser-trusted', 'readiness keeps reading needs.browser');
});

test('no job reachable from a pull request is granted packages: write', () => {
  assert.ok(calls.some(([, job]) => runsOnPullRequest(job)), 'the model sees a pull-request caller');
  for (const [name, job] of Object.entries(caller.jobs)) {
    if (!runsOnPullRequest(job)) continue;
    assert.ok(grants(job.permissions ?? caller.permissions, 'packages') < LEVEL.write, `${name} holds packages: write on a pull request`);
    assert.equal(grants(job.permissions ?? caller.permissions, 'id-token'), 0, `${name} holds id-token on a pull request`);
    if (!job.uses) continue;
    for (const [calleeName, inner] of Object.entries(callee.jobs)) {
      const permissions = effective(inner, job);
      assert.ok(grants(permissions, 'packages') < LEVEL.write, `${name} -> ${calleeName} holds packages: write on a pull request`);
      assert.equal(grants(permissions, 'id-token'), 0, `${name} -> ${calleeName} holds id-token on a pull request`);
    }
  }
});

test('a called job never asks for more than its caller grants, or the run fails at startup', () => {
  for (const [name, job] of calls) {
    for (const [calleeName, inner] of Object.entries(callee.jobs)) {
      const asked = inner.permissions ?? callee.permissions;
      if (!asked) continue;
      for (const scope of Object.keys(asMap(asked))) {
        assert.ok(grants(asked, scope) <= grants(job.permissions, scope), `${calleeName} asks for ${scope} beyond ${name}`);
      }
    }
  }
  assert.equal(callee.jobs['build-images'].permissions, undefined, 'build-images inherits its caller grant');
  assert.equal(callee.permissions, undefined, 'a workflow-level block would cap the trusted caller');
});

test('transport selection never yields registry for pull_request', () => {
  const step = callee.jobs.changes.steps.find(candidate => candidate.id === 'transport');
  // Run the step's own shell up to its output block, as the runner would.
  const script = step.run.slice(0, step.run.indexOf('{'));
  const run = (eventName, actor = 'someone') => spawnTransport(script, eventName, actor);
  assert.equal(run('pull_request'), 'artifact');
  assert.equal(run('pull_request', 'dependabot[bot]'), 'artifact');
  assert.equal(run('push'), 'registry');
  assert.equal(run('workflow_dispatch'), 'registry');
  assert.equal(run('push', 'dependabot[bot]'), 'artifact');
  assert.doesNotMatch(JSON.stringify(step.env), /head\.repo\.full_name/, 'same-repository pull requests get no registry');
});

function spawnTransport(script, eventName, actor) {
  const result = spawnSync('bash', ['-c', `${script}\necho "$transport"`], { env: { ...process.env, EVENT_NAME: eventName, ACTOR: actor }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

const everyJob = [
  ...Object.entries(caller.jobs).map(([name, job]) => ({ file: 'production-regression.yml', name, job })),
  ...Object.entries(callee.jobs).map(([name, job]) => ({ file: 'e2e-fresh-install-tests.yaml', name, job })),
];
const writesTreeTag = job => (job.steps ?? []).some(step => /tree-/.test(step.run ?? '') && /imagetools\s+create/.test(step.run ?? ''));

test('exactly one job writes a tree- tag, and it only runs on main', () => {
  const writers = everyJob.filter(({ job }) => writesTreeTag(job));
  assert.deepEqual(writers.map(({ file, name }) => `${file}:${name}`), ['production-regression.yml:promote-trusted-images']);
  const { job } = writers[0];
  assert.match(job.if, /github\.event_name == 'push'/);
  assert.match(job.if, /github\.ref == 'refs\/heads\/main'/);
  assert.match(job.if, /browser-trusted\.result == 'success'/);
  const steps = job.steps;
  const index = predicate => steps.findIndex(predicate);
  const tree = index(step => step.id === 'tree');
  const verify = index(step => /verify-trusted-tree-image\.mjs labels/.test(step.run ?? ''));
  const tag = index(writesTreeTagStep);
  const attest = index(step => /actions\/attest(-build-provenance)?@/.test(step.uses ?? ''));
  assert.match(steps[tree].run, /git rev-parse 'HEAD\^\{tree\}'/, 'the tree is recomputed from this job\'s own checkout');
  assert.ok(steps.some(step => step.uses?.startsWith('actions/checkout@')));
  assert.match(steps[verify].run, /--tree "\$TREE" --revision "\$GITHUB_SHA"/);
  assert.match(steps[verify].run, /imagetools inspect/);
  const lastAttest = steps.map(step => /actions\/attest/.test(step.uses ?? '')).lastIndexOf(true);
  assert.ok(tree >= 0 && tree < verify && verify < attest && lastAttest < tag, 'recompute, verify labels, attest every digest, then tag');
  // An output read under a key the candidates step never writes is empty at run time.
  // The step writes `${service//-/_}` for each service in SERVICES.
  const candidates = steps[index(step => step.id === 'candidates')].run;
  assert.match(candidates, /echo "\$\{service\/\/-\/_\}=\$digest" >> "\$GITHUB_OUTPUT"/);
  const keys = job.env.SERVICES.split(/\s+/).map(service => service.replace(/-/g, '_'));
  const referenced = [...JSON.stringify(steps).matchAll(/steps\.candidates\.outputs\.([A-Za-z0-9_-]+)/g)].map(([, key]) => key);
  assert.ok(referenced.length >= 3);
  for (const key of referenced) assert.ok(keys.includes(key), `steps.candidates.outputs.${key} is never written (the step writes ${keys.join(', ')})`);

  assert.ok(steps.filter(step => /actions\/attest/.test(step.uses ?? '')).every(step => step.with['push-to-registry'] === true));
  assert.equal(steps.filter(step => /actions\/attest/.test(step.uses ?? '')).length, 2, 'both server candidates are attested');
  assert.ok(!JSON.stringify(steps).includes('needs.build-images.outputs'), 'nothing is trusted from the build job outputs');
});
function writesTreeTagStep(step) { return /tree-/.test(step.run ?? '') && /imagetools\s+create/.test(step.run ?? ''); }

test('only the promotion job holds id-token: write', () => {
  const holders = everyJob.filter(({ job }) => grants(job.permissions, 'id-token') > 0 || grants(job.permissions, 'attestations') > 0);
  assert.deepEqual(holders.map(({ name }) => name), ['promote-trusted-images']);
  assert.deepEqual(caller.permissions, { contents: 'read' });
  for (const [, job] of calls) assert.equal(grants(job.permissions, 'id-token'), 0);
});

test('the label check accepts only the recomputed tree and revision', () => {
  const tree = 'a'.repeat(40), revision = 'b'.repeat(40);
  const config = labels => ({ config: { Labels: labels } });
  const good = config({ 'com.nineminds.source-tree': tree, 'org.opencontainers.image.revision': revision });
  assertSourceLabels(good, { tree, revision });
  assertSourceLabels({ 'linux/amd64': good }, { tree, revision });
  assert.throws(() => assertSourceLabels(good, { tree: 'c'.repeat(40), revision }));
  assert.throws(() => assertSourceLabels(good, { tree, revision: 'c'.repeat(40) }));
  assert.throws(() => assertSourceLabels(config({}), { tree, revision }));
  assert.throws(() => labelsOf({ 'linux/amd64': good, 'linux/arm64': good }));
});

test('every caller of the browser lane is displayed as browser, so check names and the metrics collector still match', () => {
  for (const [name, job] of calls) assert.equal(job.name, 'browser', `${name} must render as "browser / Production browser (<edition>)"`);
  const collector = readFileSync('scripts/lib/collect-browser-metric-executions.mjs', 'utf8');
  assert.ok(collector.includes('browser / Production browser (${edition})'));
  assert.notEqual(caller.jobs.browser.name, 'browser', 'the aggregator must not share the callers\' display name');
  assert.equal(callee.jobs['browser-evidence'].name, 'Production browser (${{ matrix.edition }})');
});
