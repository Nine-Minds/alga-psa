const revisionPattern = /^[0-9a-f]{40}$/;
const immutableImagePattern = /^[^@\s]+@sha256:[0-9a-f]{64}$/;

// Component requirements come from the consuming deployment definition, never
// from the submitted manifest. This validates identity, not build provenance
// or successful execution; those remain separate mandatory promotion checks.
export function validateReleaseManifest({ manifest, revision, edition, requiredComponents }) {
  const failures = [];
  if (!revisionPattern.test(revision ?? '')) failures.push('Invalid expected source revision');
  if (!['community', 'enterprise'].includes(edition)) failures.push('Invalid expected edition');
  if (!Array.isArray(requiredComponents) || !requiredComponents.length
    || requiredComponents.some(name => typeof name !== 'string' || !name.trim())
    || new Set(requiredComponents).size !== requiredComponents.length) {
    failures.push('Missing, empty or duplicate required component inventory');
  }
  const required = Array.isArray(requiredComponents) ? requiredComponents : [];
  if (manifest?.schemaVersion !== 1) failures.push('Unsupported release manifest schema');
  if (manifest?.revision !== revision) failures.push('Release source revision differs from candidate');
  if (manifest?.edition !== edition) failures.push('Release edition differs from candidate');
  const components = Array.isArray(manifest?.components) ? manifest.components : [];
  if (!components.length) failures.push('Release contains no components');
  const seen = new Set();
  for (const component of components) {
    const name = component?.name;
    if (!required.includes(name)) failures.push(`Unexpected release component: ${name}`);
    if (seen.has(name)) failures.push(`Duplicate release component: ${name}`);
    seen.add(name);
    if (typeof component?.image !== 'string' || !immutableImagePattern.test(component.image)) {
      failures.push(`Component ${name} requires an immutable sha256 image reference`);
    }
  }
  for (const name of required) if (!seen.has(name)) failures.push(`Missing release component: ${name}`);
  return { schemaVersion: 1, scope: 'release-component-identities', revision, edition,
    status: failures.length ? 'failed' : 'passed', failures };
}

// The adapter supplying observations must resolve actual image identities from
// the target runtime. A desired deployment spec or a tag is not readback proof.
export function compareReleaseDeployment({ manifest, revision, edition, requiredComponents, observations }) {
  const validation = validateReleaseManifest({ manifest, revision, edition, requiredComponents });
  const failures = [...validation.failures];
  if (!Array.isArray(observations) || !observations.length) failures.push('Missing deployed component observations');
  const seen = new Set();
  const expected = new Map((Array.isArray(manifest?.components) ? manifest.components : []).map(component => [component?.name, component?.image]));
  for (const observation of Array.isArray(observations) ? observations : []) {
    const name = observation?.name;
    if (seen.has(name)) failures.push(`Duplicate deployed component observation: ${name}`);
    seen.add(name);
    if (!expected.has(name)) failures.push(`Unexpected deployed component: ${name}`);
    if (typeof observation?.image !== 'string' || !immutableImagePattern.test(observation.image)) {
      failures.push(`Deployed component ${name} lacks an immutable image identity`);
    } else if (observation.image !== expected.get(name)) {
      failures.push(`Deployed component ${name} differs from the approved image`);
    }
  }
  for (const name of Array.isArray(requiredComponents) ? requiredComponents : []) {
    if (!seen.has(name)) failures.push(`Missing deployed component: ${name}`);
  }
  return { ...validation, scope: 'deployed-component-identities', status: failures.length ? 'failed' : 'passed', failures };
}
