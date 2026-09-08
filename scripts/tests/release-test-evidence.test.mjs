import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseManifestDigest, verifyReleaseTestEvidence, verifyReleasePromotion } from '../lib/release-test-evidence.mjs';

function fixture() {
  const revision = 'a'.repeat(40), edition = 'enterprise';
  const requiredComponents = ['server', 'email-service', 'worker'];
  const manifest = { schemaVersion: 1, revision, edition, components: requiredComponents.map((name, index) => ({
    name, image: `registry.example.test/${name}@sha256:${String(index + 1).repeat(64)}`,
    revision: String(index + 1).repeat(40), build: { provider: 'github-actions', runId: 100 + index },
  })) };
  const input = { revision, edition, manifest, requiredComponents, requiredChecks: ['browser-ee', 'email-intake', 'worker-runtime'] };
  const digest = releaseManifestDigest(input);
  const expectedTarget = { context: 'release-smoke', namespace: 'isolated', workloads: [{ kind: 'Deployment', name: 'server' }] };
  return { ...input, expectedTarget, maxObservationAgeSeconds: 300,
    runtimeEvidence: { schemaVersion: 1, scope: 'kubernetes-runtime-image-observations', target: structuredClone(expectedTarget),
      observedAt: new Date().toISOString(), observations: structuredClone(manifest.components) }, evidence: { schemaVersion: 1, revision, edition,
    manifestDigest: digest, results: input.requiredChecks.map(id => ({ id, status: 'passed', failures: [], manifestDigest: digest })) } };
}

test('exact tested and deployed component set passes, including explicitly distinct component source revisions', () => {
  assert.equal(verifyReleasePromotion(fixture()).status, 'passed');
});

test('manifest identity is independent of object key order, whitespace and component order', () => {
  const input = fixture(), before = releaseManifestDigest(input);
  const { manifest } = input;
  input.manifest = JSON.parse(JSON.stringify({ components: [...manifest.components].reverse().map(({ name, image, revision, build }) => ({ build, revision, image, name })), edition: manifest.edition, revision: manifest.revision, schemaVersion: 1 }, null, 4));
  assert.equal(releaseManifestDigest(input), before);
  assert.equal(verifyReleasePromotion(input).status, 'passed');
});

for (const component of ['email-service', 'worker', 'server']) {
  for (const field of ['image', 'revision', 'build']) {
    test(`changing only ${component} ${field} invalidates prior green evidence`, () => {
      const input = fixture(), changed = input.manifest.components.find(item => item.name === component);
      if (field === 'image') changed.image = changed.image.replace(/sha256:.*/, `sha256:${'f'.repeat(64)}`);
      if (field === 'revision') changed.revision = 'e'.repeat(40);
      if (field === 'build') changed.build.runId++;
      input.runtimeEvidence.observations = structuredClone(input.manifest.components);
      const result = verifyReleasePromotion(input);
      assert.equal(result.status, 'failed');
      assert.ok(result.failures.includes('Tests belong to a different release manifest'));
    });
  }
}

test('successful manifest-level evidence cannot hide a check from another build or a missing mandatory check', () => {
  for (const mutate of [
    x => x.evidence.results.pop(),
    x => x.evidence.results.push(structuredClone(x.evidence.results[0])),
    x => { x.evidence.results[0].manifestDigest = `sha256:${'f'.repeat(64)}`; },
    x => { x.evidence.results[0].status = 'skipped'; },
    x => { x.evidence.results[0].failures = ['failed assertion']; },
    x => { x.evidence.results = []; },
    x => { x.evidence.revision = 'b'.repeat(40); },
    x => { x.evidence.edition = 'community'; },
    x => { x.requiredChecks = []; },
    x => { x.requiredChecks.push('new-required-check'); },
  ]) {
    const input = fixture(); mutate(input);
    assert.equal(verifyReleaseTestEvidence(input).status, 'failed');
  }
});

test('matching successful tests cannot authorize substituted or missing runtime components', () => {
  for (const mutate of [
    x => x.runtimeEvidence.observations.pop(),
    x => { x.runtimeEvidence.observations[1].image = `registry.example.test/email-service@sha256:${'f'.repeat(64)}`; },
    x => { x.runtimeEvidence.observations[0].image = 'registry.example.test/server:latest'; },
  ]) {
    const input = fixture(); mutate(input);
    assert.equal(verifyReleasePromotion(input).status, 'failed');
  }
});

test('non-JSON build metadata cannot silently vanish when the identity is hashed', () => {
  for (const value of [undefined, NaN, Infinity, () => {}, new Date()]) {
    const input = fixture(); input.manifest.components[0].build.extra = value;
    assert.throws(() => releaseManifestDigest(input), /JSON values/);
    assert.equal(verifyReleaseTestEvidence(input).status, 'failed');
  }
});

test('promotion CLI rejects an email-only replacement even when the runtime matches the replacement', async t => {
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { spawnSync } = await import('node:child_process');
  const root = mkdtempSync(path.join(tmpdir(), 'release-promotion-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const input = fixture();
  const write = (name, value) => writeFileSync(path.join(root, name), JSON.stringify(value));
  write('policy.json', { revision: input.revision, edition: input.edition, requiredComponents: input.requiredComponents, requiredChecks: input.requiredChecks, expectedTarget: input.expectedTarget, maxObservationAgeSeconds: input.maxObservationAgeSeconds });
  write('manifest.json', input.manifest); write('evidence.json', input.evidence); write('observations.json', input.runtimeEvidence);
  const cli = fileURLToPath(new URL('../verify-release-promotion.mjs', import.meta.url));
  const run = () => {
    const child = spawnSync(process.execPath, [cli, 'policy.json', 'manifest.json', 'evidence.json', 'observations.json', 'result.json'], { cwd: root, encoding: 'utf8', timeout: 10000 });
    const result = JSON.parse(readFileSync(path.join(root, 'result.json'), 'utf8'));
    assert.equal(child.status, result.status === 'passed' ? 0 : 1, child.stderr);
    return result;
  };
  assert.equal(run().status, 'passed');
  input.manifest.components[1].image = `registry.example.test/email-service@sha256:${'e'.repeat(64)}`;
  input.runtimeEvidence.observations = structuredClone(input.manifest.components);
  write('manifest.json', input.manifest); write('observations.json', input.runtimeEvidence);
  assert.equal(run().status, 'failed');
  const digest = releaseManifestDigest(input);
  input.evidence.manifestDigest = digest;
  write('evidence.json', input.evidence);
  assert.equal(run().status, 'failed'); // Updating only the wrapper is insufficient.
  for (const result of input.evidence.results) result.manifestDigest = digest;
  write('evidence.json', input.evidence);
  assert.equal(run().status, 'passed'); // Simulated replacement test evidence, not an actual new smoke run.
  rmSync(path.join(root, 'observations.json'));
  assert.equal(run().status, 'failed');
});

test('matching tested/deployed images still fail promotion for stale or wrong-target observation evidence', () => {
  for (const mutate of [
    x => { x.runtimeEvidence.observedAt = '2000-01-01T00:00:00.000Z'; },
    x => { x.runtimeEvidence.target.context = 'another-cluster'; },
    x => { x.runtimeEvidence.target.namespace = 'another-namespace'; },
    x => { x.runtimeEvidence = x.runtimeEvidence.observations; },
  ]) {
    const input = fixture(); mutate(input);
    assert.equal(verifyReleasePromotion(input).status, 'failed');
  }
});

test('every release component requires an explicit source revision and identifiable build', () => {
  for (const component of ['server', 'email-service', 'worker']) {
    for (const mutate of [
      x => { delete x.revision; },
      x => { x.revision = 'main'; },
      x => { delete x.build; },
      x => { x.build.provider = ''; },
      x => { delete x.build.runId; },
      x => { x.build.runId = 0; },
      x => { x.build.runId = ' '; },
      x => { x.build.attempt = -1; },
    ]) {
      const input = fixture(); mutate(input.manifest.components.find(item => item.name === component));
      assert.throws(() => releaseManifestDigest(input), /source revision|build identity|build attempt/);
      assert.equal(verifyReleasePromotion(input).status, 'failed');
    }
  }
});
