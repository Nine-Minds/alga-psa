import { createHash } from 'node:crypto';
import { verifyBuildRecord, verifyDockerArchive, verifyLoadedDockerImage } from '../verify-docker-archive-build.mjs';

const digest = /^sha256:[a-f0-9]{64}$/;
const hash = value => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
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
  if (!digest.test(record.archive?.sha256 ?? '') || !Number.isSafeInteger(record.archive?.bytes) || record.archive.bytes < 1
    || record.archive?.filename !== `${record.service}.tar.gz`
    || typeof record.dockerfile !== 'string' || !record.dockerfile || record.dockerfile.startsWith('/')
    || record.dockerfile.split(/[\\/]/).includes('..')) throw new Error('Invalid browser archive record');
  return { schemaVersion: 1, kind: 'docker-archive-build', registryPublication: false,
    revision: record.revision, build: { provider: record.build.provider, runId: record.build.runId, attempt: record.build.attempt },
    service: record.service, image: record.image, dockerfile: record.dockerfile, platform: record.platform,
    configImageId: record.configImageId, buildReportedDigest: record.buildReportedDigest,
    metadata: { 'containerimage.config.digest': record.configImageId, 'containerimage.digest': record.buildReportedDigest },
    archive: { filename: record.archive.filename, bytes: record.archive.bytes, sha256: record.archive.sha256 } };
}
// Receipts attest a successful local byte verification before CI removes the large
// gzip archive. They are not signatures or evidence of registry publication.
export async function createBrowserArchiveReceipt(record, archivePath, expected) {
  const context = identity(expected);
  const selected = recordFields(record, context);
  await verifyDockerArchive(record, archivePath, { ...context, attempt: context.runAttempt, service: selected.service });
  return { schemaVersion: 1, kind: 'browser-ci-archive-verification', ...context,
    service: selected.service, recordSha256: hash(selected) };
}
function componentFields({ record, receipt, inspection }, context) {
  const selected = recordFields(record, context);
  if (receipt?.schemaVersion !== 1 || receipt.kind !== 'browser-ci-archive-verification'
    || receipt.service !== selected.service || receipt.recordSha256 !== hash(selected)
    || Object.entries(context).some(([key, value]) => receipt[key] !== value)) throw new Error('Archive verification receipt mismatch');
  verifyLoadedDockerImage(selected, inspection, { ...context, attempt: context.runAttempt, service: selected.service });
  const image = inspection[0];
  return { record: selected, receipt: { schemaVersion: 1, kind: receipt.kind, ...context,
    service: receipt.service, recordSha256: receipt.recordSha256 }, inspection: [{ Id: image.Id,
    Os: image.Os, Architecture: image.Architecture,
    Config: { Labels: { 'org.opencontainers.image.revision': image.Config.Labels['org.opencontainers.image.revision'] } } }] };
}
export function buildBrowserArtifactManifest({ components, ...expected }) {
  const context = identity(expected);
  if (!Array.isArray(components)) throw new Error('Browser archive components are required');
  const selected = components.map(component => componentFields(component, context))
    .sort((a, b) => a.record.service.localeCompare(b.record.service));
  if (JSON.stringify(selected.map(component => component.record.service)) !== JSON.stringify(browserArtifactServices(context.edition))) {
    throw new Error('Browser archive component inventory mismatch');
  }
  return { schemaVersion: 1, kind: 'browser-ci-docker-archives', registryPublication: false,
    scope: 'candidate-built-archives-only', ...context, components: selected };
}
export function validateBrowserArtifactManifest(manifest, expected) {
  const context = identity(expected);
  if (manifest?.schemaVersion !== 1 || manifest.kind !== 'browser-ci-docker-archives' || manifest.registryPublication !== false
    || manifest.scope !== 'candidate-built-archives-only'
    || Object.entries(context).some(([key, value]) => manifest[key] !== value)) throw new Error('Browser artifact manifest identity mismatch');
  // Return the sanitized projection; never export arbitrary inspection environment
  // variables or build metadata to metrics.
  return buildBrowserArtifactManifest({ ...context, components: manifest.components });
}
