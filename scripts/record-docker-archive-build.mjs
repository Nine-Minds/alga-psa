import { createGunzip } from 'node:zlib';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { candidateBuildIdentity, candidateRecordHeader, candidateIdentityFromEnvironment, plain } from './lib/docker-build-identity.mjs';

// Archive transport: the build job exports the image to a gzip Docker archive
// and uploads it as a run artifact. Used when the run cannot push to the
// candidate registry (pull requests from forks); see record-docker-registry-build.mjs.
export async function recordDockerArchiveBuild(input, archivePath, outputPath) {
  if (!plain(outputPath)) throw new Error('Output path is required');
  if (path.resolve(archivePath || '') === path.resolve(outputPath)) throw new Error('Archive and output paths must differ');
  // A rejected new build must never leave the previous build's evidence usable.
  await mkdir(path.dirname(outputPath), { recursive: true });
  await rm(outputPath, { force: true });
  const identity = candidateBuildIdentity(input);
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
  const record = { ...candidateRecordHeader('docker-archive-build'), ...identity,
    archive: { filename: path.basename(archivePath), bytes, sha256: `sha256:${hash.digest('hex')}` } };
  await writeFile(outputPath, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
  return record;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [archive, output] = process.argv.slice(2);
  try {
    if (process.argv.length !== 4) throw new Error('Expected archive and output paths');
    await recordDockerArchiveBuild(candidateIdentityFromEnvironment(), archive, output);
  } catch {
    // Do not serialize arbitrary metadata, build args, credentials, or filesystem errors.
    if (output && path.resolve(output) !== path.resolve(archive || '')) await rm(output, { force: true }).catch(() => {});
    console.error('Docker archive build record failed validation or recording');
    process.exitCode = 1;
  }
}
