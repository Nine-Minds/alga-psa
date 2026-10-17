import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { verifyProviderTopology } from '../../e2e-tests/harness/check-provider-topology.mjs';

const revision = 'a'.repeat(40);
function harness(t, edition = 'enterprise') {
  const outputDirectory = mkdtempSync(path.join(tmpdir(), 'provider-topology-'));
  t.after(() => rmSync(outputDirectory, { recursive: true, force: true }));
  const services = ['server', 'email-service', 'workflow-worker', ...(edition === 'enterprise' ? ['temporal-worker'] : [])];
  const config = { name: 'alga-e2e-test', services: Object.fromEntries(services.map(service => [service, { image: `candidate-${service}`, deploy: { replicas: service === 'workflow-worker' ? 2 : 1 } }])) };
  const imageId = 'sha256:' + 'b'.repeat(64);
  const images = Object.fromEntries(services.map(service => [`candidate-${service}`, { Id: imageId, Config: { Labels: { 'org.opencontainers.image.revision': revision } } }]));
  let index = 0;
  const ids = Object.fromEntries(services.map(service => [service, Array.from({ length: config.services[service].deploy.replicas }, () => (++index).toString(16).padStart(64, '0'))]));
  const inspections = Object.fromEntries(services.flatMap(service => ids[service].map(id => [id, { Id: id, Image: imageId, State: { Running: true }, Config: { Labels: {
    'com.docker.compose.project': 'alga-e2e-test', 'com.docker.compose.service': service,
  } } }])));
  const calls = [], results = {};
  const run = (program, args, input) => {
    calls.push({ program, args, input });
    if (program === 'docker-compose') {
      assert.deepEqual(args.slice(0, 2), ['-p', 'alga-e2e-test']);
      if (edition === 'enterprise') assert.deepEqual(args.slice(2, 4), ['--profile', 'enterprise']);
      else assert.ok(!args.includes('--profile'));
      const operation = args.slice(edition === 'enterprise' ? 4 : 2);
      if (operation[0] === 'config') return JSON.stringify(config);
      assert.deepEqual(operation.slice(0, 3), ['ps', '-a', '-q']);
      return ids[operation[3]].join('\n');
    }
    assert.equal(program, 'docker');
    if (args[0] === 'image') {
      assert.equal(args[1], 'inspect');
      return JSON.stringify([images[args[2]]]);
    }
    if (args[0] === 'inspect') return JSON.stringify([inspections[args[1]]]);
    assert.deepEqual(args.slice(0, 2), ['exec', '-i']);
    assert.equal(input, 'synthetic probe payload');
    const env = Object.fromEntries(args.filter(x => x.includes('=')).map(x => x.split('=')));
    const id = env.PROVIDER_PROBE_CONTAINER_ID;
    assert.ok(args.includes(id));
    if (results[id] instanceof Error) throw results[id];
    return JSON.stringify({ status: 'passed', service: env.PROVIDER_PROBE_SERVICE, revision: env.E2E_CANDIDATE_REVISION, containerId: id, ...results[id] });
  };
  const records = {};
  return { config, ids, inspections, images, imageId, calls, results, outputDirectory, records,
    check: () => verifyProviderTopology({ edition, revision, run, outputDirectory, probeSource: 'synthetic probe payload', buildRecords: service => records[service] ?? null, runId: '500', runAttempt: 1 }) };
}
for (const edition of ['community', 'enterprise']) test(`probes every ${edition} replica and retains reconciled results`, t => {
  const h = harness(t, edition), result = h.check();
  assert.equal(result.containers.length, edition === 'enterprise' ? 5 : 4);
  assert.equal(h.calls.filter(x => x.args[0] === 'exec').length, result.containers.length);
  assert.equal(readdirSync(h.outputDirectory).length, result.containers.length);
  for (const { service, id } of result.containers) assert.deepEqual(JSON.parse(readFileSync(path.join(h.outputDirectory, `${service}-${id}.json`))),
    { status: 'passed', service, revision, containerId: id });
});
for (const defect of ['missing', 'extra', 'duplicate', 'stopped', 'service', 'project', 'identity', 'unconfigured', 'wrongrunningimage', 'wrongrevision']) test(`rejects ${defect} topology before probing`, t => {
  const h = harness(t), id = h.ids['workflow-worker'][0];
  if (defect === 'missing') h.ids['workflow-worker'].pop();
  if (defect === 'extra') h.ids['workflow-worker'].push('f'.repeat(64));
  if (defect === 'duplicate') h.ids['workflow-worker'][1] = id;
  if (defect === 'stopped') h.inspections[id].State.Running = false;
  if (defect === 'service') h.inspections[id].Config.Labels['com.docker.compose.service'] = 'server';
  if (defect === 'project') h.inspections[id].Config.Labels['com.docker.compose.project'] = 'unowned';
  if (defect === 'identity') h.inspections[id].Id = 'f'.repeat(64);
  if (defect === 'wrongrunningimage') h.inspections[id].Image = 'sha256:' + 'c'.repeat(64);
  if (defect === 'wrongrevision') h.images['candidate-workflow-worker'].Config.Labels['org.opencontainers.image.revision'] = 'c'.repeat(40);
  if (defect === 'unconfigured') delete h.config.services['workflow-worker'];
  assert.throws(h.check);
  assert.equal(h.calls.filter(x => x.args[0] === 'exec').length, 0);
});
for (const defect of ['status', 'service', 'revision', 'containerId', 'command']) test(`rejects ${defect} probe failure`, t => {
  const h = harness(t), id = h.ids['workflow-worker'][1];
  h.results[id] = defect === 'command' ? new Error('Synthetic exec failure') : { [defect]: 'wrong' };
  assert.throws(h.check);
});

 test('failed retry removes previous success for the failing container', t => {
  const h = harness(t);
  h.check();
  const id = h.ids['workflow-worker'][1];
  h.results[id] = new Error('Synthetic retry failure');
  assert.throws(h.check);
  assert.ok(!readdirSync(h.outputDirectory).includes(`workflow-worker-${id}.json`));
});

test('failed topology retry removes owned records but preserves unrelated files', t => {
  const h = harness(t);
  h.check();
  writeFileSync(path.join(h.outputDirectory, 'unrelated.json'), '{}');
  h.ids['workflow-worker'].pop();
  assert.throws(h.check);
  assert.deepEqual(readdirSync(h.outputDirectory), ['unrelated.json']);
});

test('replacement container removes old evidence and records its candidate image', t => {
  const h = harness(t);
  h.check();
  const previous = h.ids['workflow-worker'][1], replacement = 'f'.repeat(64);
  h.ids['workflow-worker'][1] = replacement;
  h.inspections[replacement] = { ...h.inspections[previous], Id: replacement };
  const result = h.check();
  assert.ok(!readdirSync(h.outputDirectory).includes(`workflow-worker-${previous}.json`));
  assert.ok(readdirSync(h.outputDirectory).includes(`workflow-worker-${replacement}.json`));
  assert.deepEqual(result.containers.find(item => item.id === replacement), { service: 'workflow-worker', id: replacement, imageId: h.imageId });
});

test('build-only email service resolves the validated Compose-generated image', t => {
  const h = harness(t);
  delete h.config.services['email-service'].image;
  h.config.services['email-service'].build = { context: '/owned/checkout', dockerfile: 'services/email-service/Dockerfile' };
  h.images['alga-e2e-test-email-service'] = h.images['candidate-email-service'];
  assert.equal(h.check().status, 'passed');
  assert.ok(h.calls.some(call => call.program === 'docker' && call.args.join(' ') === 'image inspect alga-e2e-test-email-service'));
});

test('missing both explicit image and build cannot select a fallback image', t => {
  const h = harness(t);
  delete h.config.services['email-service'].image;
  assert.throws(h.check);
});

test('resolved Compose project must match the owned project', t => {
  const h = harness(t);
  h.config.name = 'foreign-project';
  assert.throws(h.check);
});

test('probe failures expose only controlled phase and service, never command secrets', t => {
  const h = harness(t);
  h.results[h.ids['email-service'][0]] = new Error('TOKEN=private-command-output');
  assert.throws(h.check, error => {
    assert.equal(error.message, 'Provider topology verification failed (probe: email-service)');
    assert.ok(!String(error).includes('private-command-output'));
    return true;
  });
});

function record(service, reuse) {
  const id = `sha256:${'1'.repeat(64)}`, reported = `sha256:${'2'.repeat(64)}`;
  return { schemaVersion: 1, kind: 'docker-archive-build', registryPublication: false, revision, build: { provider: 'github-actions', runId: '500', attempt: 1 },
    service, image: `candidate-${service}`, dockerfile: 'Dockerfile', platform: 'linux/amd64', configImageId: id, buildReportedDigest: reported,
    metadata: { 'containerimage.config.digest': id, 'containerimage.digest': reported }, archive: { filename: `${service}.tar.gz`, bytes: 10, sha256: reported },
    ...(reuse ? { reuse: { sourceRevision: reuse, sourceRunId: '400', sourceAttempt: 1, artifactRunId: '400', inputs: { policy: 'scripts/image-inputs.json', sha256: reported, files: 3 } } } : {}) };
}
test('a reused image must carry its original build revision, as its verified record states', t => {
  const source = 'c'.repeat(40);
  const h = harness(t, 'enterprise');
  h.records['workflow-worker'] = record('workflow-worker', source);
  h.records['server-ee'] = record('server-ee');
  assert.throws(h.check, /image: workflow-worker/, 'candidate label on a reused image is a mismatch');
  h.images['candidate-workflow-worker'].Config.Labels['org.opencontainers.image.revision'] = source;
  assert.equal(h.check().status, 'passed');
  h.images['candidate-server'].Config.Labels['org.opencontainers.image.revision'] = source;
  assert.throws(h.check, /image: server/, 'a built image must still carry the candidate revision');
  h.images['candidate-server'].Config.Labels['org.opencontainers.image.revision'] = revision;
  h.records['server-ee'].revision = 'd'.repeat(40);
  assert.throws(h.check, /image: server/, 'a record for another candidate is rejected before the label is trusted');
});
