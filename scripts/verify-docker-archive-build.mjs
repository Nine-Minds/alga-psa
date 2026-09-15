import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const digest = /^sha256:[a-f0-9]{64}$/;
export function verifyBuildRecord(record, expected) {
  if (!/^[a-f0-9]{40}$/.test(expected.revision ?? '') || !/^[1-9][0-9]*$/.test(String(expected.runId ?? ''))
    || !Number.isSafeInteger(expected.attempt) || expected.attempt < 1 || !expected.service) throw new Error('Expected candidate identity is required');
  if (record?.schemaVersion !== 1 || record.kind !== 'docker-archive-build' || record.registryPublication !== false
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

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [mode, inputPath, recordPath, service] = process.argv.slice(2);
    if (process.argv.length !== 6 || !['archive', 'loaded'].includes(mode)) throw new Error('Invalid arguments');
    const record = JSON.parse(await readFile(recordPath, 'utf8'));
    const expected = { revision: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID,
      attempt: Number(process.env.GITHUB_RUN_ATTEMPT), service };
    if (mode === 'archive') await verifyDockerArchive(record, inputPath, expected);
    else verifyLoadedDockerImage(record, JSON.parse(await readFile(inputPath, 'utf8')), expected);
  } catch {
    console.error('Candidate Docker archive or loaded image identity verification failed');
    process.exitCode = 1;
  }
}
