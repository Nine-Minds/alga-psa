import { createHash } from 'node:crypto';
import { verifyBuildRecord, verifyDockerArchive, verifyLoadedDockerImage, verifyPulledDockerImage,
  verifyRegistryRecord } from '../verify-docker-archive-build.mjs';

const digest = /^sha256:[a-f0-9]{64}$/;
const hash = value => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
// Each transport has a record kind, a receipt kind attesting the consumer's
// local verification, and a manifest identity. A manifest's components all
// travel the same way, so the manifest identity follows from its components.
const transports = {
  'docker-archive-build': { receipt: 'browser-ci-archive-verification',
    manifest: { kind: 'browser-ci-docker-archives', scope: 'candidate-built-archives-only' } },
  'docker-registry-build': { receipt: 'browser-ci-registry-verification',
    manifest: { kind: 'browser-ci-registry-images', scope: 'candidate-pulled-registry-images-only' } },
};
function identity({ revision, edition, runId, runAttempt }) {
  if (!/^[a-f0-9]{40}$/.test(revision ?? '') || !['community', 'enterprise'].includes(edition)
    || !/^[1-9][0-9]*$/.test(String(runId ?? '')) || !Number.isSafeInteger(runAttempt) || runAttempt < 1) {
    throw new Error('Invalid browser candidate identity');
  }
  return { revision, edition, runId: String(runId), runAttempt };
}
export function browserArtifactServices(edition) {
  if (!['community', 'enterprise'].includes(edition)) throw new Error('Invalid browser edition');
  return [edition === 'enterprise' ? 'server-ee' : 'server', 'setup', 'email-service', 'hocuspocus',
    'redis', 'pgbouncer', 'algasim', 'workflow-worker', ...(edition === 'enterprise' ? ['temporal-worker'] : [])].sort();
}
function recordFields(record, context) {
  verifyBuildRecord(record, { ...context, attempt: context.runAttempt, service: record?.service });
  if (typeof record.dockerfile !== 'string' || !record.dockerfile || record.dockerfile.startsWith('/')
    || record.dockerfile.split(/[\\/]/).includes('..')) throw new Error('Invalid browser build record');
  const common = { schemaVersion: 1, kind: record.kind, registryPublication: false,
    revision: record.revision, build: { provider: record.build.provider, runId: record.build.runId, attempt: record.build.attempt },
    service: record.service, image: record.image, dockerfile: record.dockerfile, platform: record.platform,
    configImageId: record.configImageId, buildReportedDigest: record.buildReportedDigest,
    metadata: { 'containerimage.config.digest': record.configImageId, 'containerimage.digest': record.buildReportedDigest } };
  if (record.kind === 'docker-registry-build') {
    const registry = verifyRegistryRecord(record);
    return { ...common, registry: { reference: registry.reference, tag: registry.tag, manifestDigest: registry.manifestDigest,
      mediaType: registry.mediaType, bytes: registry.bytes } };
  }
  if (!digest.test(record.archive?.sha256 ?? '') || !Number.isSafeInteger(record.archive?.bytes) || record.archive.bytes < 1
    || record.archive?.filename !== `${record.service}.tar.gz`) throw new Error('Invalid browser archive record');
  return { ...common, archive: { filename: record.archive.filename, bytes: record.archive.bytes, sha256: record.archive.sha256 } };
}
const receipt = (context, selected) => ({ schemaVersion: 1, kind: transports[selected.kind].receipt, ...context,
  service: selected.service, recordSha256: hash(selected) });
// Receipts attest a successful local verification before CI discards what it
// verified: the gzip archive's bytes, or the pulled image's repository digest.
// They are not signatures or evidence of release publication.
export async function createBrowserArchiveReceipt(record, archivePath, expected) {
  const context = identity(expected);
  const selected = recordFields(record, context);
  await verifyDockerArchive(record, archivePath, { ...context, attempt: context.runAttempt, service: selected.service });
  return receipt(context, selected);
}
export function createBrowserRegistryReceipt(record, inspection, expected) {
  const context = identity(expected);
  const selected = recordFields(record, context);
  verifyPulledDockerImage(record, inspection, { ...context, attempt: context.runAttempt, service: selected.service,
    registryNamespace: expected.registryNamespace });
  return receipt(context, selected);
}
function componentFields({ record, receipt: given, inspection }, context) {
  const selected = recordFields(record, context);
  if (given?.schemaVersion !== 1 || given.kind !== transports[selected.kind].receipt
    || given.service !== selected.service || given.recordSha256 !== hash(selected)
    || Object.entries(context).some(([key, value]) => given[key] !== value)) throw new Error('Candidate verification receipt mismatch');
  const expected = { ...context, attempt: context.runAttempt, service: selected.service };
  const image = inspection?.[0];
  const sanitized = { Id: image?.Id, Os: image?.Os, Architecture: image?.Architecture,
    Config: { Labels: { 'org.opencontainers.image.revision': image?.Config?.Labels?.['org.opencontainers.image.revision'] } } };
  if (selected.kind === 'docker-registry-build') sanitized.RepoDigests = [verifyPulledDockerImage(selected, inspection, expected)];
  else verifyLoadedDockerImage(selected, inspection, expected);
  return { record: selected, receipt: { schemaVersion: 1, kind: given.kind, ...context,
    service: given.service, recordSha256: given.recordSha256 }, inspection: [sanitized] };
}
export function buildBrowserArtifactManifest({ components, ...expected }) {
  const context = identity(expected);
  if (!Array.isArray(components)) throw new Error('Browser candidate components are required');
  const selected = components.map(component => componentFields(component, context))
    .sort((a, b) => a.record.service.localeCompare(b.record.service));
  if (JSON.stringify(selected.map(component => component.record.service)) !== JSON.stringify(browserArtifactServices(context.edition))) {
    throw new Error('Browser candidate component inventory mismatch');
  }
  const kinds = new Set(selected.map(component => component.record.kind));
  if (kinds.size !== 1) throw new Error('Browser candidate components must share one transport');
  return { schemaVersion: 1, ...transports[[...kinds][0]].manifest, registryPublication: false, ...context, components: selected };
}
export function validateBrowserArtifactManifest(manifest, expected) {
  const current = identity(expected);
  // A partial "re-run failed jobs" reuses a successful upstream browser job's
  // artifact from an earlier attempt of the same run; its manifest keeps that
  // earlier attempt while the consuming gate runs at the current attempt. runId
  // and revision already pin the run and the code, so — mirroring the build
  // record rule (attempt <= current) in verifyBuildRecord — accept an earlier
  // browser-execution attempt and reject only a future (forged) one.
  const attempt = manifest?.runAttempt;
  if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > current.runAttempt) {
    throw new Error('Browser artifact manifest identity mismatch');
  }
  const context = { ...current, runAttempt: attempt };
  const transport = Object.values(transports).find(({ manifest: shape }) => shape.kind === manifest?.kind && shape.scope === manifest.scope);
  if (manifest?.schemaVersion !== 1 || !transport || manifest.registryPublication !== false
    || Object.entries(context).some(([key, value]) => manifest[key] !== value)) throw new Error('Browser artifact manifest identity mismatch');
  // Return the sanitized projection; never export arbitrary inspection environment
  // variables or build metadata to metrics.
  const rebuilt = buildBrowserArtifactManifest({ ...context, components: manifest.components });
  if (rebuilt.kind !== manifest.kind) throw new Error('Browser artifact manifest identity mismatch');
  return rebuilt;
}
