import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function command(program, args, input) {
  const result = spawnSync(program, args, { input, encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
  // Docker errors may include environment values; keep raw command diagnostics private.
  if (result.error || result.status !== 0) throw new Error('Provider topology command failed');
  return result.stdout;
}

class ProviderTopologyError extends Error {}

export function verifyProviderTopology({ edition = process.env.E2E_EDITION, revision = process.env.GITHUB_SHA,
  run = command, outputDirectory = 'logs/provider-readiness',
  probeSource = readFileSync(new URL('./check-provider-routing.mjs', import.meta.url), 'utf8'),
} = {}) {
  let phase = 'configuration', activeService = '';
  try {
    assert.ok(['community', 'enterprise'].includes(edition), 'Expected edition');
    assert.match(revision ?? '', /^[a-f0-9]{40}$/, 'Expected candidate revision');
    mkdirSync(outputDirectory, { recursive: true });
    // Delete only records owned by this helper, including replicas replaced since
    // the last attempt. Never let failed topology validation leave old success.
    for (const filename of readdirSync(outputDirectory)) {
      if (/^(server|email-service|workflow-worker|temporal-worker)-[a-f0-9]{64}\.json$/.test(filename)) {
        rmSync(path.join(outputDirectory, filename));
      }
    }
    const project = 'alga-e2e-test';
    const compose = args => run('docker-compose', ['-p', project, ...(edition === 'enterprise' ? ['--profile', 'enterprise'] : []), ...args]);
    const config = JSON.parse(compose(['config', '--format', 'json']));
    assert.equal(config.name, project, 'Resolved Compose project mismatch');
    const services = ['server', 'email-service', 'workflow-worker', ...(edition === 'enterprise' ? ['temporal-worker'] : [])];
    const containers = [], seen = new Set();
    // Validate the complete topology before sending any provider requests.
    for (const service of services) {
      activeService = service;
      phase = 'image';
      assert.ok(config.services?.[service], `Missing configured service: ${service}`);
      const definition = config.services[service];
      const hasBuild = typeof definition.build === 'string' ? Boolean(definition.build.trim())
        : definition.build !== null && typeof definition.build === 'object' && !Array.isArray(definition.build);
      const image = definition.image ?? (hasBuild ? `${config.name}-${service}` : undefined);
      assert.ok(typeof image === 'string' && image.trim(), `Missing configured image: ${service}`);
      const images = JSON.parse(run('docker', ['image', 'inspect', image]));
      assert.ok(Array.isArray(images) && images.length === 1, 'Expected one candidate image');
      const imageId = images[0].Id;
      assert.match(imageId ?? '', /^sha256:[a-f0-9]{64}$/, 'Invalid candidate image identity');
      assert.equal(images[0].Config?.Labels?.['org.opencontainers.image.revision'], revision, 'Candidate image revision mismatch');
      phase = 'replicas';
      const replicas = config.services[service].deploy?.replicas ?? 1;
      assert.ok(Number.isSafeInteger(replicas) && replicas > 0, `Invalid replica count: ${service}`);
      const ids = compose(['ps', '-a', '-q', service]).trim().split(/\s+/).filter(Boolean);
      assert.equal(ids.length, replicas, `Replica count mismatch: ${service}`);
      for (const id of ids) {
        assert.match(id, /^[a-f0-9]{64}$/, 'Expected full container identity');
        assert.ok(!seen.has(id), 'Duplicate container identity');
        seen.add(id);
        phase = 'container';
        const inspection = JSON.parse(run('docker', ['inspect', id]));
        assert.ok(Array.isArray(inspection) && inspection.length === 1, 'Expected one inspected container');
        const container = inspection[0];
        assert.equal(container.Id, id, 'Inspected container identity mismatch');
        assert.equal(container.Image, imageId, 'Running container image mismatch');
        assert.equal(container.State?.Running, true, 'Container is not running');
        assert.equal(container.Config?.Labels?.['com.docker.compose.project'], project, 'Container project mismatch');
        assert.equal(container.Config?.Labels?.['com.docker.compose.service'], service, 'Container service mismatch');
        containers.push({ service, id, imageId });
      }
    }
    mkdirSync(outputDirectory, { recursive: true });
    for (const { service, id } of containers) {
      activeService = service;
      phase = 'probe';
      const outputPath = path.join(outputDirectory, `${service}-${id}.json`);
      rmSync(outputPath, { force: true });
      const output = run('docker', ['exec', '-i', '-e', `PROVIDER_PROBE_SERVICE=${service}`,
        '-e', `E2E_CANDIDATE_REVISION=${revision}`, '-e', `PROVIDER_PROBE_CONTAINER_ID=${id}`,
        id, 'node', '--input-type=module'], probeSource);
      writeFileSync(outputPath, output);
      phase = 'probe-result';
      const result = JSON.parse(output);
      assert.equal(result.status, 'passed', 'Provider probe failed');
      assert.equal(result.service, service, 'Provider probe service mismatch');
      assert.equal(result.revision, revision, 'Provider probe revision mismatch');
      assert.equal(result.containerId, id, 'Provider probe container mismatch');
    }
    return { status: 'passed', revision, edition, containers };
  } catch {
    throw new ProviderTopologyError(`Provider topology verification failed (${phase}${activeService ? `: ${activeService}` : ''})`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(verifyProviderTopology())); }
  catch (error) { console.error(error instanceof ProviderTopologyError ? error.message : 'Provider topology verification failed'); process.exitCode = 1; }
}
