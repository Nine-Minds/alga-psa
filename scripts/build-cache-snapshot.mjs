#!/usr/bin/env node
// Build caches travel through the container registry the way candidate images
// do: one OCI artifact per reference holding a zstd tarball of cache
// directories, pushed and pulled with `oras`.
//
//   node scripts/build-cache-snapshot.mjs restore --reference <registry/repo:tag> --path <dir> [--path <dir>...]
//   node scripts/build-cache-snapshot.mjs save    --reference <registry/repo:tag> --path <dir> [--path <dir>...]
//
// Paths are relative to the repository root and are the only tar members
// extracted, so an artifact cannot write anywhere else. Restore is best
// effort: a missing artifact, a missing `oras` or a bad archive leaves the
// build cold and exits 0, reporting `restored=false`; the build itself stays
// correct because webpack and Nx validate what they find in their caches.
// Save fails loudly, and the workflow decides whether that fails the job.
//
// Trust: a cache can shape build output (webpack serves compiled modules from
// it), so only runs of the default branch write snapshots. Pull requests pull
// them and never push.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ARCHIVE_NAME = 'build-cache.tar.zst';
export const MEDIA_TYPE = 'application/vnd.nineminds.build-cache.tar+zstd';

export function parseArguments(argv) {
  const [command, ...rest] = argv;
  if (!['restore', 'save'].includes(command)) throw new Error('usage: build-cache-snapshot.mjs restore|save --reference <ref> --path <dir>...');
  const options = { command, reference: null, paths: [] };
  for (let index = 0; index < rest.length; index += 2) {
    const [flag, value] = [rest[index], rest[index + 1]];
    if (value === undefined) throw new Error(`Missing value for ${flag}`);
    if (flag === '--reference') options.reference = value;
    else if (flag === '--path') options.paths.push(value);
    else throw new Error(`Unknown option ${flag}`);
  }
  if (!/^[a-z0-9.-]+(:[0-9]+)?(\/[a-z0-9._-]+)+:[A-Za-z0-9._-]{1,128}$/.test(options.reference ?? '')) {
    throw new Error('A registry reference with a tag is required, e.g. ghcr.io/org/repo/build-cache:enterprise');
  }
  if (!options.paths.length) throw new Error('At least one --path is required');
  for (const candidate of options.paths) {
    if (path.isAbsolute(candidate) || candidate.split(/[\\/]/).some(part => part === '..' || part === '')) {
      throw new Error(`Cache path must be relative and inside the repository: ${candidate}`);
    }
  }
  return options;
}

const run = (command, args, options = {}) => spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
const seconds = started => ((Date.now() - started) / 1000).toFixed(1);
const size = file => { try { return statSync(file).size; } catch { return 0; } };
const megabytes = bytes => `${(bytes / 1024 / 1024).toFixed(0)} MB`;

export function restore({ reference, paths, root, log = console.log, output = process.env.GITHUB_OUTPUT }) {
  const started = Date.now();
  const report = restored => {
    if (output) appendFileSync(output, `restored=${restored}\n`);
    return restored;
  };
  const scratch = mkdtempSync(path.join(tmpdir(), 'build-cache-restore-'));
  try {
    const pull = run('oras', ['pull', reference, '--output', scratch]);
    if (pull.error || pull.status !== 0) {
      log(`build-cache: no snapshot restored from ${reference} (${pull.error ? pull.error.code : `oras exit ${pull.status}`}); building cold`);
      return report(false);
    }
    const archive = path.join(scratch, ARCHIVE_NAME);
    if (!existsSync(archive)) {
      log(`build-cache: snapshot at ${reference} holds no ${ARCHIVE_NAME} (members: ${readdirSync(scratch).join(', ') || 'none'}); building cold`);
      return report(false);
    }
    // Only the named members leave the archive, under the repository root.
    const extract = run('tar', ['--zstd', '-xf', archive, '-C', root, '--no-same-owner', '--no-same-permissions', '--', ...paths]);
    if (extract.status !== 0) {
      log(`build-cache: snapshot at ${reference} could not be extracted (tar exit ${extract.status}); building cold`);
      for (const candidate of paths) rmSync(path.join(root, candidate), { recursive: true, force: true });
      return report(false);
    }
    log(`build-cache: restored ${megabytes(size(archive))} from ${reference} in ${seconds(started)}s`);
    for (const candidate of paths) log(`  ${candidate}: ${existsSync(path.join(root, candidate)) ? 'present' : 'not in snapshot'}`);
    return report(true);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

export function save({ reference, paths, root, annotations = {}, log = console.log }) {
  const started = Date.now();
  const present = paths.filter(candidate => existsSync(path.join(root, candidate)));
  if (!present.length) throw new Error(`build-cache: none of ${paths.join(', ')} exist; nothing to save`);
  const scratch = mkdtempSync(path.join(tmpdir(), 'build-cache-save-'));
  try {
    const archive = path.join(scratch, ARCHIVE_NAME);
    const pack = run('tar', ['--zstd', '-cf', archive, '-C', root, '--', ...present], { env: { ...process.env, ZSTD_CLEVEL: '3', ZSTD_NBTHREADS: '0' } });
    if (pack.status !== 0) throw new Error(`build-cache: tar exit ${pack.status}: ${pack.stderr}`);
    log(`build-cache: packed ${present.join(', ')} into ${megabytes(size(archive))} in ${seconds(started)}s`);
    const annotate = Object.entries(annotations).flatMap(([key, value]) => ['--annotation', `${key}=${value}`]);
    const push = run('oras', ['push', reference, ...annotate, `${ARCHIVE_NAME}:${MEDIA_TYPE}`], { cwd: scratch });
    if (push.error || push.status !== 0) throw new Error(`build-cache: oras push failed (${push.error ? push.error.code : `exit ${push.status}`}): ${push.stderr ?? ''}`);
    log(`build-cache: pushed ${reference} in ${seconds(started)}s`);
    return { reference, bytes: size(archive), paths: present };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const options = parseArguments(process.argv.slice(2));
  if (options.command === 'restore') restore({ ...options, root });
  else {
    const annotations = { 'org.opencontainers.image.revision': process.env.GITHUB_SHA ?? '', 'org.opencontainers.image.created': new Date().toISOString(),
      'com.nineminds.build-cache.run': process.env.GITHUB_RUN_ID ?? '' };
    save({ ...options, root, annotations: Object.fromEntries(Object.entries(annotations).filter(([, value]) => value)) });
  }
}
