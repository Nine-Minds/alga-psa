import { constants } from 'node:fs';
import { lstat, readdir, mkdir, open, chmod, chown } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Only synthetic files created by e2e-fresh-install-tests.yaml are copied.
export const APP_SECRET_FILES = Object.freeze([
  'postgres_password', 'db_password_server', 'db_password_hocuspocus',
  'redis_password', 'alga_auth_key', 'crypto_key', 'token_secret_key',
  'nextauth_secret', 'credential_encryption_key', 'email_password',
  'google_oauth_client_id', 'google_oauth_client_secret',
]);

async function requireEmptyDirectory(directory) {
  let stat;
  try { stat = await lstat(directory); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (!stat.isDirectory() || stat.isSymbolicLink() || (await readdir(directory)).length) {
    throw new Error('Worker test state target must be an empty real directory');
  }
}

/** Initialize fresh job-owned volumes; never repair or reuse existing state. */
export async function initializeWorkerTestState({ sourceDirectory, secretsDirectory, filesDirectory, uid, gid }) {
  if (![uid, gid].every(value => Number.isSafeInteger(value) && value >= 0)) {
    throw new Error('Worker test state ownership must use valid numeric IDs');
  }
  const roots = [sourceDirectory, secretsDirectory, filesDirectory].map(value => {
    if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('Worker test state paths must be absolute');
    return path.resolve(value);
  });
  for (const [i, left] of roots.entries()) for (const right of roots.slice(i + 1)) {
    if (left === right || left.startsWith(right + path.sep) || right.startsWith(left + path.sep)) {
      throw new Error('Worker test state directories must be separate');
    }
  }
  const [source, secrets, files] = roots;
  const sourceStat = await lstat(source);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) throw new Error('Secret source must be a real directory');
  // Validate all sources and both destinations before changing any ownership.
  await requireEmptyDirectory(secrets);
  await requireEmptyDirectory(files);
  const contents = new Map();
  for (const name of APP_SECRET_FILES) {
    const handle = await open(path.join(source, name), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size === 0 || stat.size > 65536) throw new Error('Invalid worker test secret source');
      contents.set(name, await handle.readFile());
    } finally { await handle.close(); }
  }
  const privateDirectory = async directory => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chown(directory, uid, gid);
    await chmod(directory, 0o700);
  };
  await privateDirectory(secrets);
  await privateDirectory(files);
  await privateDirectory(path.join(secrets, 'tenants'));
  contents.set('DB_PASSWORD_ADMIN', contents.get('postgres_password'));
  for (const [name, content] of contents) {
    const handle = await open(path.join(secrets, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      await handle.writeFile(content);
      await handle.chown(uid, gid);
      await handle.chmod(0o600);
    } finally { await handle.close(); }
  }
  return { appSecretFiles: contents.size, uid, gid };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 2) throw new Error('No CLI overrides allowed');
    await initializeWorkerTestState({ sourceDirectory: '/run/secrets', secretsDirectory: '/data/secrets', filesDirectory: '/data/files', uid: 1000, gid: 1000 });
    console.log('Fresh worker test state initialized');
  } catch {
    // Never expose secret contents or raw filesystem errors to CI logs.
    console.error('Worker test state initialization failed; require complete synthetic sources and empty job-owned target directories');
    process.exitCode = 1;
  }
}
