import { providerFixture } from './fixtures/release-provider.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseManifestDigest, verifyReleaseTestEvidence, verifyReleasePromotion } from '../lib/release-test-evidence.mjs';

function fixture() {
  const revision = 'a'.repeat(40), edition = 'enterprise';
  const provider = providerFixture();
  const manifest = {schemaVersion:1,revision,edition,components:provider.components};
  const requiredComponents = manifest.components.map(c=>c.name);
  const input = { revision, edition, manifest, requiredComponents, requiredChecks: ['browser-ee', 'email-intake', 'worker-runtime'] };
  input.requiredBrowserProviders = provider.policy;
  input.requiredCheckConfigurations = { 'browser-ee': { providers: { stripe: { mode: 'emulator', protocol: 'fixture-v1' } }, authentication: 'credentials' }, 'email-intake': { transport: 'smtp-test-sink' }, 'worker-runtime': {} };
  const digest = releaseManifestDigest(input);
  const expectedTarget = { context: 'release-smoke', namespace: 'isolated', workloads: ['server', 'email-service', 'worker', 'hocuspocus', 'temporal-worker'].map(name => ({ kind: 'Deployment', name })) };
  const renderedResources = manifest.components.map(component => ({ kind: 'Deployment',
    metadata: { namespace: 'isolated', name: component.name.split('/')[2] },
    spec: { template: { spec: { containers: [{ name: component.name.split('/').at(-1), image: component.image }] } } } }));
  return { ...input, renderedResources, expectedTarget, maxObservationAgeSeconds: 300,
    runtimeEvidence: { schemaVersion: 1, scope: 'kubernetes-runtime-image-observations', target: structuredClone(expectedTarget),
      observedAt: new Date().toISOString(), observations: structuredClone(manifest.components) }, evidence: { schemaVersion: 1, revision, edition,
    browserProviderExecution: provider.raw, manifestDigest: digest, results: input.requiredChecks.map(id => ({ id, status: 'passed', failures: [], manifestDigest: digest, configuration: structuredClone(input.requiredCheckConfigurations[id]) })) } };
}

test('exact tested and deployed component set passes with independent provider execution', () => {
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
      const input = fixture(), changed = input.manifest.components.find(item => item.name.endsWith(`/containers/${component}`));
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
  write('policy.json', { revision: input.revision, edition: input.edition, requiredComponents: input.requiredComponents, requiredChecks: input.requiredChecks, requiredCheckConfigurations: input.requiredCheckConfigurations, requiredBrowserProviders: input.requiredBrowserProviders, expectedTarget: input.expectedTarget, maxObservationAgeSeconds: input.maxObservationAgeSeconds });
  write('rendered.json', input.renderedResources); write('manifest.json', input.manifest); write('evidence.json', input.evidence); write('observations.json', input.runtimeEvidence);
  const cli = fileURLToPath(new URL('../verify-release-promotion.mjs', import.meta.url));
  const run = () => {
    const child = spawnSync(process.execPath, [cli, 'policy.json', 'rendered.json', 'manifest.json', 'evidence.json', 'observations.json', 'result.json'], { cwd: root, encoding: 'utf8', timeout: 10000 });
    const result = JSON.parse(readFileSync(path.join(root, 'result.json'), 'utf8'));
    assert.equal(child.status, result.status === 'passed' ? 0 : 1, child.stderr);
    return result;
  };
  assert.equal(run().status, 'passed');
  input.evidence.results[0].configuration.providers.stripe.mode = 'sandbox';
  write('evidence.json', input.evidence);
  assert.equal(run().status, 'failed');
  input.evidence.results[0].configuration.providers.stripe.mode = 'emulator';
  write('evidence.json', input.evidence);
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
  assert.equal(run().status, 'failed'); // Rendered deployment still selects the old image.
  input.renderedResources[1].spec.template.spec.containers[0].image = input.manifest.components[1].image;
  write('rendered.json', input.renderedResources);
  assert.equal(run().status, 'failed'); // Rehashing declarations cannot replace digest-bound registry bytes.
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
      const input = fixture(); mutate(input.manifest.components.find(item => item.name.endsWith(`/containers/${component}`)));
      assert.throws(() => releaseManifestDigest(input), /source revision|build identity|build attempt/);
      assert.equal(verifyReleasePromotion(input).status, 'failed');
    }
  }
});

for (const omitted of ['workload', 'init-container']) {
  test(`complete rendered inventory rejects consistently omitted ${omitted}`, () => {
    const input = fixture();
    if (omitted === 'workload') {
      input.requiredComponents.pop(); input.manifest.components.pop(); input.runtimeEvidence.observations.pop();
      input.expectedTarget.workloads.pop(); input.runtimeEvidence.target.workloads.pop();
      const digest = releaseManifestDigest(input);
      input.evidence.manifestDigest = digest;
      for (const result of input.evidence.results) result.manifestDigest = digest;
    } else {
      input.renderedResources[0].spec.template.spec.initContainers = [
        { name: 'migrate', image: `registry.example.test/migrate@sha256:${'9'.repeat(64)}` },
      ];
    }
    assert.equal(verifyReleasePromotion(input).status, 'failed');
  });
}

test('rendered input is mandatory and target workload inventory must match it exactly', () => {
  for (const mutate of [
    input => { delete input.renderedResources; },
    input => { input.renderedResources = []; },
    input => { input.expectedTarget.workloads.pop(); input.runtimeEvidence.target.workloads.pop(); },
    input => { input.expectedTarget.workloads.push({ kind: 'Deployment', name: 'extra' }); input.runtimeEvidence.target = structuredClone(input.expectedTarget); },
    input => { input.renderedResources[0].metadata.namespace = 'elsewhere'; },
  ]) {
    const input = fixture(); mutate(input);
    assert.equal(verifyReleasePromotion(input).status, 'failed');
  }
});

test('explicitly inventoried and tested init container passes with the same rendered workload target', () => {
  const input = fixture();
  const component = { name: 'isolated/Deployment/server/initContainers/migrate',
    image: `registry.example.test/migrate@sha256:${'9'.repeat(64)}`, revision: '9'.repeat(40),
    build: { provider: 'github-actions', runId: 999 } };
  input.renderedResources[0].spec.template.spec.initContainers = [{ name: 'migrate', image: component.image }];
  input.requiredComponents.push(component.name); input.manifest.components.push(component);
  input.runtimeEvidence.observations.push(component);
  const digest = releaseManifestDigest(input);
  input.evidence.manifestDigest = digest;
  for (const result of input.evidence.results) result.manifestDigest = digest;
  assert.equal(verifyReleasePromotion(input).status, 'passed');
});

for (const [label, mutate] of [
  ['missing consumer policy', x => { delete x.requiredCheckConfigurations; }],
  ['missing required configuration', x => { delete x.requiredCheckConfigurations['browser-ee']; }],
  ['unknown policy check', x => { x.requiredCheckConfigurations['not-required'] = {}; }],
  ['missing result configuration', x => { delete x.evidence.results[0].configuration; }],
  ['provider mode changed', x => { x.evidence.results[0].configuration.providers.stripe.mode = 'sandbox'; }],
  ['protocol changed', x => { x.evidence.results[0].configuration.providers.stripe.protocol = 'fixture-v2'; }],
  ['authentication changed', x => { x.evidence.results[0].configuration.authentication = 'prelinked'; }],
  ['extra unapproved configuration', x => { x.evidence.results[0].configuration.override = true; }],
  ['non-JSON configuration', x => { x.requiredCheckConfigurations['worker-runtime'].value = undefined; }],
]) test(`release configuration rejects ${label} despite passing checks and matching images`, () => {
  const input = fixture(); mutate(input);
  const result = verifyReleasePromotion(input);
  assert.equal(result.status, 'failed');
  assert.ok(result.failures.some(message => /configuration/i.test(message)));
});

test('configuration comparison ignores object key order but keeps array order and exact values', () => {
  const input = fixture();
  input.evidence.results[0].configuration = { authentication: 'credentials', providers: { stripe: { protocol: 'fixture-v1', mode: 'emulator' } } };
  assert.equal(verifyReleasePromotion(input).status, 'passed');
  input.requiredCheckConfigurations['worker-runtime'] = { phases: ['start', 'consume'] };
  input.evidence.results[2].configuration = { phases: ['consume', 'start'] };
  assert.equal(verifyReleasePromotion(input).status, 'failed');
});

for (const side of ['policy', 'result']) test(`sparse arrays cannot disappear from direct ${side} configuration`, () => {
  const input = fixture();
  input.requiredCheckConfigurations['worker-runtime'] = { values: [] };
  input.evidence.results[2].configuration = { values: [] };
  if (side === 'policy') input.requiredCheckConfigurations['worker-runtime'].values = Array(1);
  else input.evidence.results[2].configuration.values = Array(1);
  assert.equal(verifyReleasePromotion(input).status, 'failed');
});

for (const [name, mutate] of [
  ['missing policy', x => { delete x.requiredBrowserProviders; }],
  ['removed provider declaration cannot bypass required proof', x => { delete x.requiredCheckConfigurations['browser-ee'].providers; delete x.evidence.results[0].configuration.providers; delete x.requiredBrowserProviders; }],
  ['null policy', x => { x.requiredBrowserProviders = null; }],
  ['missing raw traffic', x => { x.evidence.browserProviderExecution.report.suites[0].specs[0].tests[0].results[0].attachments = []; }],
  ['corrupt archive', x => { x.evidence.browserProviderExecution.artifactManifest.components[0].record.archive.sha256 = 'sha256:' + 'f'.repeat(64); }],
  ['wrong run', x => { x.requiredBrowserProviders.runId = '999'; }],
  ['missing component mapping', x => { delete x.requiredBrowserProviders.componentServices[x.manifest.components[0].name]; }],
  ['missing registry bytes', x => { delete x.evidence.browserProviderExecution.registryManifests; }],
  ['corrupt registry bytes', x => { x.evidence.browserProviderExecution.registryManifests[x.manifest.components[0].name] = Buffer.from('{}').toString('base64'); }],
  ['wrong tested build', x => { x.manifest.components[0].build = {...x.manifest.components[0].build,attempt:3}; const d=releaseManifestDigest(x); x.evidence.manifestDigest=d; x.evidence.results.forEach(r=>r.manifestDigest=d); }],
  ['cannot replace committed journey policy', x => { x.requiredBrowserProviders.requirements=[]; x.evidence.browserProviderExecution.report.suites=[]; }],
]) test(`release provider proof rejects ${name}`, () => {
  const input=fixture(); mutate(input); assert.equal(verifyReleasePromotion(input).status,'failed');
});

test('digest-valid OCI indexes and wrong config digests cannot substitute for tested image manifests', async () => {
  const { createHash } = await import('node:crypto');
  for (const document of [
    {schemaVersion:2,mediaType:'application/vnd.oci.image.index.v1+json',manifests:[]},
    {schemaVersion:2,mediaType:'application/vnd.oci.image.manifest.v1+json',config:{digest:'sha256:'+'f'.repeat(64)},layers:[]},
  ]) {
    const input=fixture(),component=input.manifest.components[0],bytes=Buffer.from(JSON.stringify(document));
    component.image=component.image.split('@')[0]+'@sha256:'+createHash('sha256').update(bytes).digest('hex');
    input.evidence.browserProviderExecution.registryManifests[component.name]=bytes.toString('base64');
    const d=releaseManifestDigest(input);input.evidence.manifestDigest=d;input.evidence.results.forEach(r=>r.manifestDigest=d);
    input.renderedResources[0].spec.template.spec.containers[0].image=component.image;
    input.runtimeEvidence.observations=structuredClone(input.manifest.components);
    assert.ok(verifyReleasePromotion(input).failures.includes('Registry manifest does not bind tested provider component'));
  }
});

for (const field of ['provider-mode', 'authentication', 'serverLifecycle']) test(`matching declarations cannot override observed ${field}`, () => {
  const input=fixture();
  const configuration=input.requiredCheckConfigurations['browser-ee'];
  if(field==='provider-mode') configuration.providers.stripe.mode='sandbox';
  else configuration[field]='unobserved-value';
  input.evidence.results[0].configuration=structuredClone(configuration);
  assert.equal(verifyReleasePromotion(input).status,'failed');
});

for (const damage of ['minimal-digest-only', 'config-media', 'config-size', 'layers-missing', 'layer-digest', 'layer-size', 'layer-media']) test(`digest-valid registry manifest rejects ${damage}`, async () => {
  const {createHash}=await import('node:crypto');
  const input=fixture(),component=input.manifest.components[0];
  const document=JSON.parse(Buffer.from(input.evidence.browserProviderExecution.registryManifests[component.name],'base64'));
  document.layers=[{mediaType:'application/vnd.oci.image.layer.v1.tar+gzip',size:10,digest:'sha256:'+'1'.repeat(64)}];
  if(damage==='minimal-digest-only') { document.config={digest:document.config.digest}; delete document.layers; }
  if(damage==='config-media') delete document.config.mediaType;
  if(damage==='config-size') document.config.size=-1;
  if(damage==='layers-missing') delete document.layers;
  if(damage==='layer-digest') document.layers[0].digest='sha256:invalid';
  if(damage==='layer-size') document.layers[0].size=1.5;
  if(damage==='layer-media') document.layers[0].mediaType='text/plain';
  const bytes=Buffer.from(JSON.stringify(document));
  component.image=component.image.split('@')[0]+'@sha256:'+createHash('sha256').update(bytes).digest('hex');
  input.evidence.browserProviderExecution.registryManifests[component.name]=bytes.toString('base64');
  const d=releaseManifestDigest(input);input.evidence.manifestDigest=d;input.evidence.results.forEach(r=>r.manifestDigest=d);
  assert.ok(verifyReleasePromotion(input).failures.includes('Invalid registry image manifest descriptors'));
});
