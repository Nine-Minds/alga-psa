import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Verifies candidate build records and the image the consumer ends up with,
// for both transports: a gzip Docker archive (`docker-archive-build`) or a
// manifest pulled by digest from the CI candidate registry (`docker-registry-build`).
// Self-contained on purpose: the browser runner copies this file beside the
// evidence libraries without the rest of scripts/.
const digest = /^sha256:[a-f0-9]{64}$/;
const recordKinds = ['docker-archive-build', 'docker-registry-build'];
// A repository reference without tag or digest: registry host, then at least one path segment.
export const registryReferencePattern = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?(\/[a-z0-9]([a-z0-9._-]*[a-z0-9])?)+$/;
export const registryTagPattern = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const manifestMediaTypes = ['application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json'];

export function verifyBuildRecord(record, expected) {
  if (!/^[a-f0-9]{40}$/.test(expected.revision ?? '') || !/^[1-9][0-9]*$/.test(String(expected.runId ?? ''))
    || !Number.isSafeInteger(expected.attempt) || expected.attempt < 1 || !expected.service) throw new Error('Expected candidate identity is required');
  if (record?.schemaVersion !== 1 || !recordKinds.includes(record.kind) || record.registryPublication !== false
    || record.revision !== expected.revision || record.build?.provider !== 'github-actions'
    || record.build.runId !== String(expected.runId) || !Number.isSafeInteger(record.build.attempt)
    || record.build.attempt < 1 || record.build.attempt > expected.attempt
    || record.service !== expected.service || record.platform !== 'linux/amd64'
    || typeof record.image !== 'string' || !record.image || /\s/.test(record.image)
    || !digest.test(record.configImageId ?? '') || !digest.test(record.buildReportedDigest ?? '')
    || record.metadata?.['containerimage.config.digest'] !== record.configImageId
    || record.metadata?.['containerimage.digest'] !== record.buildReportedDigest) throw new Error('Build record does not match candidate');
  return record;
}

export async function verifyDockerArchive(record, archivePath, expected) {
  verifyBuildRecord(record, expected);
  if (record.kind !== 'docker-archive-build') throw new Error('Record is not an archive build');
  if (record.archive?.filename !== path.basename(archivePath) || !digest.test(record.archive?.sha256 ?? '')
    || !Number.isSafeInteger(record.archive?.bytes) || record.archive.bytes <= 0) throw new Error('Archive record is invalid');
  const before = await stat(archivePath);
  if (!before.isFile() || before.size !== record.archive.bytes) throw new Error('Archive size differs');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(archivePath)) hash.update(chunk);
  const after = await stat(archivePath);
  if (`sha256:${hash.digest('hex')}` !== record.archive.sha256 || after.size !== before.size
    || after.mtimeMs !== before.mtimeMs || after.ino !== before.ino) throw new Error('Archive bytes differ');
}

export function verifyLoadedDockerImage(record, inspection, expected) {
  verifyBuildRecord(record, expected);
  if (!Array.isArray(inspection) || inspection.length !== 1) throw new Error('Exactly one loaded image is required');
  const image = inspection[0];
  if (image.Id !== record.configImageId || image.Config?.Labels?.['org.opencontainers.image.revision'] !== expected.revision
    || `${image.Os}/${image.Architecture}` !== record.platform) throw new Error('Loaded image does not match candidate build');
}

// The registry's content digest is the sha256 of the exact manifest bytes. A
// manifest (never an index) whose config is this build's image config proves the
// registry serves this build under `manifestDigest`. A single trailing newline
// appended by the tool that printed the bytes is not part of the manifest.
export function verifyRegistryManifest(bytes, { manifestDigest, configImageId }) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > 4 * 1024 * 1024) throw new Error('Registry manifest bytes are required');
  if (!digest.test(manifestDigest ?? '') || !digest.test(configImageId ?? '')) throw new Error('Registry manifest identity is required');
  const sha = buffer => `sha256:${createHash('sha256').update(buffer).digest('hex')}`;
  let exact = bytes;
  if (sha(exact) !== manifestDigest) {
    if (bytes.at(-1) !== 0x0a) throw new Error('Registry manifest bytes differ');
    exact = bytes.subarray(0, -1);
    if (sha(exact) !== manifestDigest) throw new Error('Registry manifest bytes differ');
  }
  let manifest;
  try { manifest = JSON.parse(exact.toString('utf8')); } catch { throw new Error('Registry manifest is not JSON'); }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || manifest.schemaVersion !== 2
    || !manifestMediaTypes.includes(manifest.mediaType) || manifest.config?.digest !== configImageId
    || !Array.isArray(manifest.layers) || manifest.layers.length === 0
    || manifest.layers.some(layer => !digest.test(layer?.digest ?? ''))) throw new Error('Registry manifest does not describe the candidate image');
  return { mediaType: manifest.mediaType, bytes: exact.length, configDigest: manifest.config.digest, layers: manifest.layers.length };
}

export function verifyRegistryRecord(record, expected = {}) {
  if (record?.kind !== 'docker-registry-build') throw new Error('Record is not a registry build');
  const registry = record.registry;
  if (typeof registry?.reference !== 'string' || !registryReferencePattern.test(registry.reference)
    || typeof registry.tag !== 'string' || !registryTagPattern.test(registry.tag)
    || registry.manifestDigest !== record.buildReportedDigest || !manifestMediaTypes.includes(registry.mediaType)
    || !Number.isSafeInteger(registry.bytes) || registry.bytes <= 0) throw new Error('Registry record is invalid');
  if (expected.registryNamespace != null && !registry.reference.startsWith(`${expected.registryNamespace}/`)) {
    throw new Error('Registry reference is outside the candidate namespace');
  }
  return registry;
}

// A pulled image carries the repository digest it was fetched by; the loaded
// checks still apply because `docker tag` of a pulled digest keeps its config Id.
export function verifyPulledDockerImage(record, inspection, expected) {
  verifyLoadedDockerImage(record, inspection, expected);
  const registry = verifyRegistryRecord(record, expected);
  const pulled = `${registry.reference}@${registry.manifestDigest}`;
  if (!Array.isArray(inspection[0].RepoDigests) || !inspection[0].RepoDigests.includes(pulled)) throw new Error('Image was not pulled from the recorded registry manifest');
  return pulled;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [mode, inputPath, recordPath, service] = process.argv.slice(2);
    if (process.argv.length !== 6 || !['archive', 'loaded', 'pulled'].includes(mode)) throw new Error('Invalid arguments');
    const record = JSON.parse(await readFile(recordPath, 'utf8'));
    const expected = { revision: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID,
      attempt: Number(process.env.GITHUB_RUN_ATTEMPT), service, registryNamespace: process.env.E2E_REGISTRY_NAMESPACE || undefined };
    if (mode === 'archive') await verifyDockerArchive(record, inputPath, expected);
    else if (mode === 'loaded') verifyLoadedDockerImage(record, JSON.parse(await readFile(inputPath, 'utf8')), expected);
    else verifyPulledDockerImage(record, JSON.parse(await readFile(inputPath, 'utf8')), expected);
  } catch {
    console.error('Candidate Docker archive or loaded image identity verification failed');
    process.exitCode = 1;
  }
}
