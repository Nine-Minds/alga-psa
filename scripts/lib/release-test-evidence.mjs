import { readFileSync } from 'node:fs';
import { verifyBrowserProviderReadiness } from './browser-provider-readiness.mjs';
import { validateBrowserArtifactManifest } from './browser-artifact-manifest.mjs';
import { renderedReleaseComponents } from './rendered-release-components.mjs';
import { verifyRuntimeObservationEvidence } from './runtime-observation-evidence.mjs';
import { createHash } from 'node:crypto';
import { validateReleaseManifest, compareReleaseDeployment } from './release-component-manifest.mjs';

function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${Array.from(value, canonical).join(',')}]`;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  throw new Error('Release identity must contain only JSON values');
}

// Bind all recorded metadata (including component build/source identities),
// not just server revision. Component ordering and JSON formatting are immaterial.
export function releaseManifestDigest(input) {
  const validation = validateReleaseManifest(input);
  if (validation.status !== 'passed') throw new Error(validation.failures.join('\n'));
  for (const component of input.manifest.components) {
    if (typeof component.revision !== 'string' || !/^[a-f0-9]{40}$/.test(component.revision)) {
      throw new Error(`Component ${component.name} requires an explicit source revision`);
    }
    const build = component.build;
    const runId = build?.runId;
    const validRunId = typeof runId === 'string' ? Boolean(runId.trim()) && runId.trim() === runId
      : Number.isSafeInteger(runId) && runId > 0;
    if (!build || typeof build.provider !== 'string' || !build.provider.trim() || build.provider.trim() !== build.provider || !validRunId) {
      throw new Error(`Component ${component.name} requires a build identity (provider and runId)`);
    }
    if (build.attempt !== undefined && (!Number.isSafeInteger(build.attempt) || build.attempt <= 0)) {
      throw new Error(`Component ${component.name} has an invalid build attempt`);
    }
  }
  const normalized = { ...input.manifest, components: [...input.manifest.components].sort((a, b) => a.name.localeCompare(b.name)) };
  return `sha256:${createHash('sha256').update(canonical(normalized)).digest('hex')}`;
}

// Required check identities are supplied by the consuming release policy,
// independently of submitted evidence. The producer must bind every verdict
// when testing the actual running component set; this does not attest provenance.
export function verifyReleaseTestEvidence({ manifest, revision, edition, requiredComponents, requiredChecks, requiredCheckConfigurations, requiredBrowserProviders, evidence }) {
  const input = { manifest, revision, edition, requiredComponents };
  const failures = [...validateReleaseManifest(input).failures];
  let manifestDigest;
  try { manifestDigest = releaseManifestDigest(input); } catch (error) { failures.push(error.message); }
  if (!Array.isArray(requiredChecks) || !requiredChecks.length || requiredChecks.some(id => typeof id !== 'string' || !id.trim())
    || new Set(requiredChecks).size !== requiredChecks.length) failures.push('Missing, empty or duplicate required release checks');
  const checks = Array.isArray(requiredChecks) ? requiredChecks : [];
  const plainObject = value => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
  // Every check has an explicit consumer-owned configuration, including {} for
  // checks without configuration. Evidence cannot choose its own expectations.
  const configurations = new Map();
  if (!plainObject(requiredCheckConfigurations)) failures.push('Missing required release check configuration policy');
  else {
    for (const id of Object.keys(requiredCheckConfigurations)) {
      if (!checks.includes(id)) failures.push(`Configuration for unexpected release check: ${id}`);
    }
    for (const id of checks) {
      try {
        if (!Object.hasOwn(requiredCheckConfigurations, id) || !plainObject(requiredCheckConfigurations[id])) throw new Error();
        configurations.set(id, canonical(requiredCheckConfigurations[id]));
      } catch { failures.push(`${id}: missing or invalid required configuration`); }
    }
  }
  if (evidence?.schemaVersion !== 1 || evidence?.revision !== revision || evidence?.edition !== edition) failures.push('Unsupported or stale release test evidence');
  if (!manifestDigest || evidence?.manifestDigest !== manifestDigest) failures.push('Tests belong to a different release manifest');
  if (!Array.isArray(evidence?.results) || !evidence.results.length) failures.push('Missing release test results');
  const seen = new Set();
  for (const result of Array.isArray(evidence?.results) ? evidence.results : []) {
    if (!checks.includes(result?.id) || seen.has(result?.id)) failures.push(`Unexpected or duplicate release check: ${result?.id}`);
    seen.add(result?.id);
    if (result?.manifestDigest !== manifestDigest) failures.push(`${result?.id}: check belongs to a different manifest`);
    if (result?.status !== 'passed' || !Array.isArray(result?.failures) || result.failures.length) failures.push(`${result?.id}: incomplete release check`);
    try {
      if (!configurations.has(result?.id) || !plainObject(result?.configuration)
        || canonical(result.configuration) !== configurations.get(result.id)) throw new Error();
    } catch { failures.push(`${result?.id}: missing, invalid or mismatched release check configuration`); }
  }
  for (const id of checks) if (!seen.has(id)) failures.push(`Missing required release check: ${id}`);
  failures.push(...verifyReleaseProviders({ manifest, revision, edition, requiredChecks: checks, requiredCheckConfigurations, requiredBrowserProviders, evidence }));
  return { schemaVersion: 1, scope: 'tested-release-manifest', revision, edition, manifestDigest,
    status: failures.length ? 'failed' : 'passed', failures,
    providerProofLimitation: 'Provider modes and specified browser authentication/lifecycle are observed; vendor protocol version labels are declarations, not independently verified.' };
}

// The complete rendered release is a separate consumer input. A self-consistent
// manifest/policy/readback cannot authorize silently omitting a workload.
function verifyRenderedInventory(input) {
  const failures = [];
  try {
    const components = renderedReleaseComponents(input.renderedResources, {
      defaultNamespace: input.expectedTarget?.namespace,
    });
    const required = new Set(input.requiredComponents ?? []);
    const rendered = new Map(components.map(component => [component.name, component.image]));
    for (const name of rendered.keys()) if (!required.has(name)) failures.push(`Rendered component missing from release policy: ${name}`);
    for (const name of required) if (!rendered.has(name)) failures.push(`Release policy component absent from rendered release: ${name}`);
    for (const component of input.manifest?.components ?? []) {
      if (rendered.get(component.name) !== component.image) failures.push(`Rendered image differs from release manifest: ${component.name}`);
    }
    const workloads = new Set();
    for (const component of components) {
      const [namespace, kind, name] = component.name.split('/');
      if (namespace !== input.expectedTarget?.namespace) failures.push(`Rendered workload outside approved target namespace: ${namespace}/${kind}/${name}`);
      workloads.add(`${kind}/${name}`);
    }
    const targets = new Set((input.expectedTarget?.workloads ?? []).map(workload => `${workload.kind}/${workload.name}`));
    for (const workload of workloads) if (!targets.has(workload)) failures.push(`Rendered workload missing from runtime target: ${workload}`);
    for (const workload of targets) if (!workloads.has(workload)) failures.push(`Runtime target workload absent from rendered release: ${workload}`);
  } catch {
    failures.push('Missing or invalid complete rendered release inventory');
  }
  return failures;
}

export function verifyReleasePromotion(input) {
  const tests = verifyReleaseTestEvidence(input);
  const freshness = verifyRuntimeObservationEvidence(input);
  const deployment = compareReleaseDeployment({ ...input, observations: input.runtimeEvidence?.observations });
  const failures = [...tests.failures, ...freshness.failures, ...deployment.failures, ...verifyRenderedInventory(input)];
  return { ...tests, scope: 'release-promotion-identities', status: failures.length ? 'failed' : 'passed', failures };
}

// Registry bytes are independently digest-bound; archive/config hashes are
// different identities and must never stand in for registry manifest digests.
function verifyReleaseProviders({ manifest, revision, edition, requiredChecks, requiredCheckConfigurations, requiredBrowserProviders: policy, evidence }) {
  const failures = [];
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)
    || !requiredChecks.includes(policy.checkId)) return ['Missing or invalid required browser provider policy'];
  const configured = requiredChecks.filter(id => requiredCheckConfigurations?.[id]?.providers != null);
  if (configured.some(id => id !== policy.checkId)) failures.push('Provider configuration lacks independent browser proof');
  try {
    const committed = JSON.parse(readFileSync(new URL('../browser-provider-requirements.json', import.meta.url), 'utf8'));
    const raw = evidence?.browserProviderExecution;
    const context = { revision, edition, runId: policy.runId, runAttempt: policy.runAttempt };
    const artifact = validateBrowserArtifactManifest(raw?.artifactManifest, context);
    const verified = verifyBrowserProviderReadiness({ collected: raw.collected, report: raw.report,
      evidence: raw.evidence, root: raw.root, ...context, artifactManifest: artifact,
      requirements: committed.editions?.[edition]?.requirements });
    if (verified.status !== 'passed') failures.push('Required browser provider execution failed');
    const configuration = requiredCheckConfigurations?.[policy.checkId];
    for (const field of ['authentication', 'serverLifecycle']) {
      if (Object.hasOwn(configuration ?? {}, field) && configuration[field] !== verified.configuration?.[field])
        failures.push(`Provider browser ${field} differs from required configuration`);
    }
    if (configuration?.providers != null) {
      if (typeof configuration.providers !== 'object' || Array.isArray(configuration.providers)) throw new Error();
      for (const [provider, expectation] of Object.entries(configuration.providers)) {
        const observed = verified.observations.flatMap(o => o.providers).filter(p => p.provider === provider && p.requestCount > 0);
        if (!expectation || typeof expectation.mode !== 'string' || !observed.length
          || observed.some(p => p.mode !== expectation.mode)) failures.push('Provider mode differs from required configuration');
      }
    }
    // Journal observations do not record vendor protocol versions. Any protocol
    // labels in declaration equality are not independently verified by this gate.

    const mapping = policy.componentServices;
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping) || !Object.keys(mapping).length)
      throw new Error();
    const services = new Set();
    for (const [name, service] of Object.entries(mapping)) {
      const component = manifest.components.find(c => c.name === name);
      const tested = artifact.components.find(c => c.record.service === service)?.record;
      if (!component || !tested || services.has(service)) throw new Error();
      services.add(service);
      if (component.revision !== tested.revision || canonical(component.build) !== canonical(tested.build))
        failures.push('Provider tested component build identity differs from release');
      const encoded = raw.registryManifests?.[name];
      if (typeof encoded !== 'string' || encoded.length > 2000000) throw new Error();
      const bytes = Buffer.from(encoded, 'base64');
      if (bytes.toString('base64') !== encoded) throw new Error();
      const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
      const registry = JSON.parse(bytes.toString('utf8'));
      const oci = registry.mediaType === 'application/vnd.oci.image.manifest.v1+json';
      const descriptor = (value, types) => value && types.includes(value.mediaType)
        && Number.isSafeInteger(value.size) && value.size >= 0 && /^sha256:[a-f0-9]{64}$/.test(value.digest ?? '');
      const configTypes = [oci ? 'application/vnd.oci.image.config.v1+json' : 'application/vnd.docker.container.image.v1+json'];
      const layerTypes = oci ? ['application/vnd.oci.image.layer.v1.tar', 'application/vnd.oci.image.layer.v1.tar+gzip',
        'application/vnd.oci.image.layer.v1.tar+zstd', 'application/vnd.oci.image.layer.nondistributable.v1.tar',
        'application/vnd.oci.image.layer.nondistributable.v1.tar+gzip', 'application/vnd.oci.image.layer.nondistributable.v1.tar+zstd']
        : ['application/vnd.docker.image.rootfs.diff.tar.gzip', 'application/vnd.docker.image.rootfs.foreign.diff.tar.gzip'];
      if (!descriptor(registry.config, configTypes) || !Array.isArray(registry.layers)
        || registry.layers.some(layer => !descriptor(layer, layerTypes))) failures.push('Invalid registry image manifest descriptors');
      if (component.image.split('@')[1] !== digest || registry.schemaVersion !== 2
        || !['application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json'].includes(registry.mediaType)
        || registry.manifests !== undefined || registry.config?.digest !== tested.configImageId)
        failures.push('Registry manifest does not bind tested provider component');
    }
    // Every candidate-built application runtime service must be mapped. Setup,
    // the emulator and unrelated infrastructure are not release applications.
    for (const service of [edition === 'enterprise' ? 'server-ee' : 'server', 'email-service', 'hocuspocus', 'workflow-worker', ...(edition === 'enterprise' ? ['temporal-worker'] : [])]) {
      if (!services.has(service)) failures.push('Missing required provider runtime component mapping');
    }
  } catch { failures.push('Missing or invalid browser provider identity evidence'); }
  return failures;
}
