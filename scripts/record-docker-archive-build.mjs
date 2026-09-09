import { createGunzip } from 'node:zlib';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const digestPattern = /^sha256:[a-f0-9]{64}$/;
const plain = value => typeof value === 'string' && value.trim() === value && value.length > 0;

export async function recordDockerArchiveBuild(input, archivePath, outputPath) {
  if (!plain(outputPath)) throw new Error('Output path is required');
  if (path.resolve(archivePath || '') === path.resolve(outputPath)) throw new Error('Archive and output paths must differ');
  // A rejected new build must never leave the previous build's evidence usable.
  await mkdir(path.dirname(outputPath), { recursive: true });
  await rm(outputPath, { force: true });
  if (!/^[a-f0-9]{40}$/.test(input?.revision ?? '') || !/^\d+$/.test(String(input?.runId ?? '')) || BigInt(input.runId) <= 0n
    || !Number.isSafeInteger(input?.attempt) || input.attempt <= 0) throw new Error('Invalid build source or run identity');
  if (!plain(input.service) || !/^[a-z0-9][a-z0-9-]*$/.test(input.service)
    || !plain(input.image) || /\s/.test(input.image)
    || !plain(input.dockerfile) || path.isAbsolute(input.dockerfile) || input.dockerfile.split(/[\\/]/).includes('..')
    || !/^linux\/(amd64|arm64)(\/v[0-9]+)?$/.test(input.platform ?? '')) throw new Error('Invalid component build identity');
  if (!digestPattern.test(input.configImageId ?? '') || !digestPattern.test(input.buildReportedDigest ?? '')) throw new Error('Missing or invalid build action identity');
  let metadata;
  try { metadata = typeof input.metadata === 'string' ? JSON.parse(input.metadata) : input.metadata; }
  catch { throw new Error('Invalid build metadata'); }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)
    || metadata['containerimage.config.digest'] !== input.configImageId
    || metadata['containerimage.digest'] !== input.buildReportedDigest) throw new Error('Build metadata disagrees with action outputs');
  if (!plain(archivePath) || !archivePath.endsWith('.tar.gz')) throw new Error('A gzip Docker archive is required');
  const info = await stat(archivePath);
  if (!info.isFile() || info.size === 0) throw new Error('Missing or empty Docker archive');
  const hash = createHash('sha256');
  let bytes = 0;
  let header = Buffer.alloc(0);
  for await (const chunk of createReadStream(archivePath)) {
    if (header.length < 2) header = Buffer.concat([header, chunk.subarray(0, 2 - header.length)]);
    bytes += chunk.length; hash.update(chunk);
  }
  if (header[0] !== 0x1f || header[1] !== 0x8b || bytes !== info.size) throw new Error('Invalid or changing gzip archive');
  await pipeline(createReadStream(archivePath), createGunzip(), new Writable({ write(_chunk, _encoding, callback) { callback(); } }));
  const after = await stat(archivePath);
  if (after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ino !== info.ino) throw new Error('Archive changed while recording');
  const record = { schemaVersion: 1, kind: 'docker-archive-build', registryPublication: false,
    revision: input.revision, build: { provider: 'github-actions', runId: String(input.runId), attempt: input.attempt },
    service: input.service, image: input.image, dockerfile: input.dockerfile, platform: input.platform,
    configImageId: input.configImageId, buildReportedDigest: input.buildReportedDigest,
    // These are build-action outputs, not evidence of a published registry manifest.
    metadata: { 'containerimage.config.digest': metadata['containerimage.config.digest'], 'containerimage.digest': metadata['containerimage.digest'] },
    archive: { filename: path.basename(archivePath), bytes, sha256: `sha256:${hash.digest('hex')}` } };
  await writeFile(outputPath, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
  return record;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [archive, output] = process.argv.slice(2);
  try {
    if (process.argv.length !== 4) throw new Error('Expected archive and output paths');
    await recordDockerArchiveBuild({ revision: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID,
      attempt: Number(process.env.GITHUB_RUN_ATTEMPT), service: process.env.BUILD_SERVICE, image: process.env.BUILD_IMAGE,
      dockerfile: process.env.BUILD_DOCKERFILE, platform: process.env.BUILD_PLATFORM,
      configImageId: process.env.BUILD_CONFIG_IMAGE_ID, buildReportedDigest: process.env.BUILD_REPORTED_DIGEST,
      metadata: process.env.BUILD_METADATA }, archive, output);
  } catch {
    // Do not serialize arbitrary metadata, build args, credentials, or filesystem errors.
    if (output && path.resolve(output) !== path.resolve(archive || '')) await rm(output, { force: true }).catch(() => {});
    console.error('Docker archive build record failed validation or recording');
    process.exitCode = 1;
  }
}
