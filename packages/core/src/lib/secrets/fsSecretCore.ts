/**
 * Hardened filesystem operations for the filesystem secret provider.
 *
 * `LazyFileSystemSecretProvider` (the `FileSystemSecretProvider` exported from
 * `@alga-psa/core/secrets`) imports this module statically, so bundlers always
 * include it — no runtime-dependent relative dynamic import can fail to resolve
 * in dist (ESM needs the `.js` extension) or in webpack source mode (a dynamic
 * import is hidden from the bundler and never emitted). To keep Node builtins
 * out of static Next client graphs, this module never imports a `node:`
 * specifier at the top level; `node:fs/promises`, `node:path`, and
 * `node:crypto` are loaded lazily at call time via `lazyBuiltin.ts`.
 *
 * The write path is implemented exactly once:
 *
 * - Directories are created with an explicit `0o700` (mkdir mode is masked by
 *   umask, so a post-create `chmod` is applied) and files are written with an
 *   explicit `0o600`, independent of the process umask.
 * - Writes are atomic: the value is written to an exclusively-created
 *   (`O_EXCL`) temp file in the same directory, fsynced, then `rename()`d over
 *   the target. A crash or injected failure mid-write never leaves a truncated
 *   file in place of a valid secret, and the temp file is cleaned up.
 * - Every path component derived from a tenant id or secret name is
 *   allowlist-validated, and the resolved path is verified to stay under the
 *   secret root.
 * - The secret root is validated before writes (real directory, not a symlink,
 *   owned by the running user, safe modes). Writes are refused with an
 *   actionable operator message when the location cannot be made safe; reads
 *   are unaffected.
 */

import { loadBuiltin } from './lazyBuiltin';
import type { FileHandle } from 'node:fs/promises';
import type { Dirent, Stats } from 'node:fs';

export const SECRET_DIR_MODE = 0o700;
export const SECRET_FILE_MODE = 0o600;
export const TENANTS_SUBDIR = 'tenants';
export const DOCKER_SECRETS_PATH = '/run/secrets';

const MAX_COMPONENT_LENGTH = 255;

let fsModulePromise: Promise<typeof import('node:fs/promises')> | null = null;
function getFs(): Promise<typeof import('node:fs/promises')> {
  fsModulePromise ??= loadBuiltin<typeof import('node:fs/promises')>('node:fs/promises');
  return fsModulePromise;
}

let pathModulePromise: Promise<typeof import('node:path')> | null = null;
function getPath(): Promise<typeof import('node:path')> {
  pathModulePromise ??= loadBuiltin<typeof import('node:path')>('node:path');
  return pathModulePromise;
}

let cryptoModulePromise: Promise<typeof import('node:crypto')> | null = null;
function getCrypto(): Promise<typeof import('node:crypto')> {
  cryptoModulePromise ??= loadBuiltin<typeof import('node:crypto')>('node:crypto');
  return cryptoModulePromise;
}

/**
 * Raised when a secret cannot be written because the filesystem location is
 * unsafe. `operatorMessage` is the single, actionable message meant for an
 * operator (exact path, expected owner/mode, and the command to fix it). It
 * never contains secret values.
 */
export class UnsafeSecretLocationError extends Error {
  readonly operatorMessage: string;

  constructor(operatorMessage: string) {
    super(operatorMessage);
    this.name = 'UnsafeSecretLocationError';
    this.operatorMessage = operatorMessage;
  }
}

/** Raised when a tenant id or secret name fails path-safety validation. */
export class InvalidSecretPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSecretPathError';
  }
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error;
}

function isEnoent(error: unknown): boolean {
  return isErrno(error) && error.code === 'ENOENT';
}

function runningUid(): number | undefined {
  return typeof process !== 'undefined' && typeof process.getuid === 'function'
    ? process.getuid()
    : undefined;
}

/**
 * Validates a single path component derived from a tenant id or secret name.
 * Rejects empty components, `.`/`..`, NUL, and path separators (a component
 * containing a separator can never be a single path segment, so it would
 * traverse or escape).
 *
 * @returns The validated component.
 */
export function validateSecretComponent(component: string, label: string): string {
  if (typeof component !== 'string' || component.length === 0) {
    throw new InvalidSecretPathError(`${label} must be a non-empty string`);
  }
  if (component.length > MAX_COMPONENT_LENGTH) {
    throw new InvalidSecretPathError(`${label} must be at most ${MAX_COMPONENT_LENGTH} characters`);
  }
  if (component === '.' || component === '..') {
    throw new InvalidSecretPathError(`${label} must not be '.' or '..'`);
  }
  if (component.includes('/') || component.includes('\\') || component.includes('\0')) {
    throw new InvalidSecretPathError(`${label} must not contain path separators or NUL`);
  }
  return component;
}

/**
 * Builds `<base>/tenants/<tenantId>/<secretName>` after validating every
 * component, and verifies the resolved path stays under the secret root.
 */
export async function tenantSecretPath(basePath: string, tenantId: string, name: string): Promise<string> {
  validateSecretComponent(tenantId, 'tenantId');
  validateSecretComponent(name, 'secret name');

  const p = await getPath();
  const resolvedBase = p.resolve(basePath);
  const filePath = p.resolve(p.join(resolvedBase, TENANTS_SUBDIR, tenantId, name));

  // Defense in depth: the validated components cannot contain '..', but an
  // escape would otherwise be silent, so assert it.
  const rootPrefix = resolvedBase.endsWith(p.sep) ? resolvedBase : `${resolvedBase}${p.sep}`;
  if (filePath !== resolvedBase && !filePath.startsWith(rootPrefix)) {
    throw new InvalidSecretPathError('resolved secret path escapes the secret root');
  }

  return filePath;
}

/**
 * Builds `<base>/<name>` for an application-level secret after validating the
 * name, keeping it directly under the base path (the historical layout).
 */
export async function appSecretPath(basePath: string, name: string): Promise<string> {
  validateSecretComponent(name, 'app secret name');
  const p = await getPath();
  const resolvedBase = p.resolve(basePath);
  const filePath = p.resolve(p.join(resolvedBase, name));
  const rootPrefix = resolvedBase.endsWith(p.sep) ? resolvedBase : `${resolvedBase}${p.sep}`;
  if (filePath !== resolvedBase && !filePath.startsWith(rootPrefix)) {
    throw new InvalidSecretPathError('resolved secret path escapes the secret root');
  }
  return filePath;
}

export async function tenantsDir(basePath: string): Promise<string> {
  const p = await getPath();
  return p.join(p.resolve(basePath), TENANTS_SUBDIR);
}

export async function tenantDir(basePath: string, tenantId: string): Promise<string> {
  validateSecretComponent(tenantId, 'tenantId');
  const p = await getPath();
  return p.join(await tenantsDir(basePath), tenantId);
}

/**
 * Resolves the provider base path from `SECRET_FS_BASE_PATH`, falling back to
 * `/run/secrets` when present, then to `<cwd>/secrets` / `<cwd>/../secrets`.
 * Mirrors the historical resolution so reads keep working unchanged.
 */
export async function resolveBasePath(serverRoot: string): Promise<string> {
  const [fs, p] = await Promise.all([getFs(), getPath()]);
  const configured = process.env.SECRET_FS_BASE_PATH;
  if (configured && configured.trim() !== '') {
    return p.isAbsolute(configured) ? configured : p.resolve(serverRoot, configured);
  }

  try {
    await fs.access(DOCKER_SECRETS_PATH);
    return DOCKER_SECRETS_PATH;
  } catch {
    // Not running in a container / secrets not mounted.
  }

  const candidates = [
    p.resolve(serverRoot, 'secrets'),
    p.resolve(serverRoot, '../secrets'),
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Keep searching.
    }
  }

  return p.resolve(serverRoot, '../secrets');
}

function unsafeLocation(pathLabel: string, reason: string): UnsafeSecretLocationError {
  const uid = runningUid();
  const ownerClause = typeof uid === 'number' ? `owned by uid ${uid}` : 'owned by the running user';
  const message =
    `Filesystem secret store at ${pathLabel} is not safe for secret writes: ${reason}. ` +
    `Expected a real directory ${ownerClause} with mode 0700. Refusing secret writes; reads continue. ` +
    `Fix with: sudo chown <running uid> ${pathLabel} && sudo chmod 700 ${pathLabel}, or run ` +
    `scripts/repair-secret-permissions.sh --apply --path ${pathLabel} (see docs/security/secrets_management.md).`;
  return new UnsafeSecretLocationError(message);
}

async function lstatOrNull(target: string): Promise<Stats | null> {
  const fs = await getFs();
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (isEnoent(error)) return null;
    throw error;
  }
}

async function createPrivateDir(target: string): Promise<void> {
  const fs = await getFs();
  // mkdir mode is umask-masked, so always follow with an explicit chmod.
  await fs.mkdir(target, { recursive: true, mode: SECRET_DIR_MODE });
  await fs.chmod(target, SECRET_DIR_MODE);
}

/**
 * Ensures `target` is a real (non-symlink) directory with `0o700` modes,
 * owned by the running user, creating it if absent. Used for the `tenants/`
 * directory and per-tenant directories, which live entirely inside the secret
 * store and are safe to correct.
 */
export async function ensurePrivateDirectory(target: string): Promise<void> {
  const fs = await getFs();
  let stat = await lstatOrNull(target);
  if (!stat) {
    await createPrivateDir(target);
    stat = await lstatOrNull(target);
    if (!stat) {
      throw unsafeLocation(target, 'could not create the directory');
    }
  }

  if (stat.isSymbolicLink()) {
    throw unsafeLocation(target, 'the path is a symlink; refusing to write through it');
  }
  if (!stat.isDirectory()) {
    throw unsafeLocation(target, 'the path is not a directory');
  }

  const uid = runningUid();
  if (typeof uid === 'number' && stat.uid !== uid) {
    throw unsafeLocation(target, `it is owned by uid ${stat.uid} and the process runs as uid ${uid}`);
  }

  if ((stat.mode & 0o777) !== SECRET_DIR_MODE) {
    await fs.chmod(target, SECRET_DIR_MODE);
    stat = await lstatOrNull(target);
    if (!stat || (stat.mode & 0o777) !== SECRET_DIR_MODE) {
      throw unsafeLocation(target, 'the directory mode could not be corrected');
    }
  }
}

/**
 * Validates the secret root and the `tenants/` directory for writes and
 * returns the resolved root.
 *
 * The root itself is validated strictly: a missing root is created with
 * `0o700`, but an existing root with the wrong mode, a foreign owner, or a
 * symlink refuses writes with an operator message. The root may be a shared or
 * mounted directory (e.g. the appliance hostPath), so its ownership/mode is a
 * deployment decision — changing it automatically could break other readers.
 */
export async function ensureWriteBasePath(basePath: string): Promise<string> {
  const p = await getPath();
  const root = p.resolve(basePath);
  let stat = await lstatOrNull(root);

  if (!stat) {
    try {
      await createPrivateDir(root);
    } catch (error) {
      throw unsafeLocation(root, `could not create it (${(error as Error).message})`);
    }
    stat = await lstatOrNull(root);
    if (!stat) {
      throw unsafeLocation(root, 'could not create it');
    }
  }

  if (stat.isSymbolicLink()) {
    throw unsafeLocation(root, 'the path is a symlink; refusing to write through it');
  }
  if (!stat.isDirectory()) {
    throw unsafeLocation(root, 'the path is not a directory');
  }

  const uid = runningUid();
  if (typeof uid === 'number' && stat.uid !== uid) {
    throw unsafeLocation(root, `it is owned by uid ${stat.uid} and the process runs as uid ${uid}`);
  }
  if ((stat.mode & 0o777) !== SECRET_DIR_MODE) {
    throw unsafeLocation(root, `it has mode ${(stat.mode & 0o777).toString(8)}`);
  }

  await ensurePrivateDirectory(await tenantsDir(root));
  return root;
}

/**
 * Reads a secret file's content. Returns `undefined` when the file is absent.
 * Symlinks are followed for reads to stay compatible with Docker/Kubernetes
 * secret mounts. Never logs secret values — only the file path.
 */
export async function readFileContentSafe(filePath: string): Promise<string | undefined> {
  const fs = await getFs();
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return content.trim();
  } catch (error: unknown) {
    if (isEnoent(error)) return undefined;
    const fsError = error as NodeJS.ErrnoException;
    console.error(`Error reading secret file ${filePath}: ${fsError.message}`);
    return undefined;
  }
}

/**
 * Verifies, at write time, that the target is absent or a regular file — not a
 * symlink, directory, or device — narrowing the TOCTOU window before the
 * rename that replaces it.
 */
async function assertRegularTarget(filePath: string): Promise<void> {
  const stat = await lstatOrNull(filePath);
  if (!stat) return;
  if (stat.isSymbolicLink()) {
    throw new InvalidSecretPathError(`secret file ${filePath} is a symlink; refusing to replace it`);
  }
  if (!stat.isFile()) {
    throw new InvalidSecretPathError(`secret file ${filePath} is not a regular file; refusing to replace it`);
  }
}

/**
 * Atomically writes `value` to `filePath`:
 *
 * 1. verifies the target is absent or a regular file,
 * 2. writes to an exclusively-created temp file in the same directory with
 *    explicit `0o600`,
 * 3. fsyncs and closes the temp file,
 * 4. re-verifies the temp file's type, then renames it over the target.
 *
 * The rename preserves the temp file's inode and therefore its `0o600` mode,
 * so a rewrite always ends with the file at `0o600` regardless of the
 * pre-existing file's modes. On any failure the temp file is removed and the
 * previous content is left intact. Never logs secret values.
 */
export async function writeTenantSecretAtomic(filePath: string, value: string): Promise<void> {
  const [fs, p, { randomBytes }] = await Promise.all([getFs(), getPath(), getCrypto()]);
  await assertRegularTarget(filePath);

  const tempPath = `${filePath}.tmp-${randomBytes(6).toString('hex')}`;
  let handle: FileHandle | null = null;
  try {
    // O_CREAT|O_EXCL|O_WRONLY: exclusive creation never overwrites. O_NOFOLLOW
    // is added where the platform provides it so the temp path cannot be a
    // symlink even if an attacker races the lstat checks above; on platforms
    // without O_NOFOLLOW the post-open lstat re-validation below still covers
    // the same ground.
    const noFollow = (fs.constants?.O_NOFOLLOW ?? 0) as number;
    handle = await fs.open(tempPath, noFollow | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, SECRET_FILE_MODE);
    await handle.writeFile(value, 'utf-8');
    await handle.sync();
    await handle.close();
    handle = null;

    // Explicit chmod: open() mode is umask-masked, and this is also the mode
    // the rename carries onto the target inode.
    await fs.chmod(tempPath, SECRET_FILE_MODE);

    const tempStat = await lstatOrNull(tempPath);
    if (!tempStat || tempStat.isSymbolicLink() || !tempStat.isFile()) {
      throw new InvalidSecretPathError('temporary secret file is not a regular file; aborting write');
    }

    await fs.rename(tempPath, filePath);

    // Best-effort durability of the rename itself: fsync the parent directory
    // so a crash right after this point cannot roll the directory entry back
    // to the pre-rename state. Directory fsync is not supported everywhere
    // (e.g. some Windows/FUSE filesystems raise EINVAL/EISDIR), so failures
    // are ignored — the file contents are already durable.
    await fsyncDirectory(p.dirname(filePath));
  } catch (error: unknown) {
    if (handle) {
      await handle.close().catch(() => undefined);
    }
    await fs.unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

/**
 * Opens a directory read-only and fsyncs it. Used after an atomic rename to
 * make the rename durable. Failures are swallowed: several platforms and
 * filesystems do not support fsync on directories.
 */
async function fsyncDirectory(dirPath: string): Promise<void> {
  const fs = await getFs();
  let dirHandle: FileHandle | null = null;
  try {
    dirHandle = await fs.open(dirPath, 'r');
    await dirHandle.sync();
  } catch {
    // Not supported on this platform/filesystem; the file fsync is still done.
  } finally {
    if (dirHandle) {
      await dirHandle.close().catch(() => undefined);
    }
  }
}

/**
 * Removes a tenant secret. Missing files are tolerated (idempotent). A symlink
 * or non-file target is rejected rather than deleted.
 */
export async function unlinkSecret(filePath: string): Promise<void> {
  const stat = await lstatOrNull(filePath);
  if (!stat) return;
  if (stat.isSymbolicLink()) {
    throw new InvalidSecretPathError(`secret file ${filePath} is a symlink; refusing to delete it`);
  }
  if (!stat.isFile()) {
    throw new InvalidSecretPathError(`secret file ${filePath} is not a regular file; refusing to delete it`);
  }
  const fs = await getFs();
  await fs.unlink(filePath);
}

/**
 * Verifies, immediately before a deletion, that a directory component the
 * deletion traverses is a real (non-symlink) directory. Returns `false` when
 * the component is absent — there is nothing to delete — and throws when it is
 * a symlink or not a directory, so a redirected component can never carry an
 * unlink outside the secret store.
 */
async function isRealDirectoryForDelete(target: string): Promise<boolean> {
  const stat = await lstatOrNull(target);
  if (!stat) return false;
  if (stat.isSymbolicLink()) {
    throw new InvalidSecretPathError(`secret store path ${target} is a symlink; refusing to delete through it`);
  }
  if (!stat.isDirectory()) {
    throw new InvalidSecretPathError(`secret store path ${target} is not a directory; refusing to delete through it`);
  }
  return true;
}

/**
 * Removes `<base>/tenants/<tenantId>/<name>` after validating every component
 * and re-checking, at deletion time, that the resolved root, `tenants/`, and
 * the per-tenant directory are all real (non-symlink) directories — the same
 * component checks the write path performs, so a symlinked directory cannot
 * redirect the unlink outside the store. A missing directory or file means
 * there is nothing to delete (idempotent). The final target itself must be a
 * regular file (`unlinkSecret`).
 */
export async function unlinkTenantSecret(basePath: string, tenantId: string, name: string): Promise<void> {
  const p = await getPath();
  const filePath = await tenantSecretPath(basePath, tenantId, name);
  const root = p.resolve(basePath);
  const chain = [root, await tenantsDir(root), await tenantDir(root, tenantId)];
  for (const dir of chain) {
    if (!(await isRealDirectoryForDelete(dir))) {
      return;
    }
  }
  await unlinkSecret(filePath);
}

/**
 * Walks the secret store under `basePath` and reports every directory and file
 * whose modes are not the expected `0o700`/`0o600`. Never reads or rewrites
 * secret contents. Used by the repair path.
 */
export interface PermissionIssue {
  /** One of 'dir' | 'file' | 'unsafe'. */
  kind: 'dir' | 'file' | 'unsafe';
  /** Absolute path of the entry. */
  path: string;
  /** Current mode (dirs/files) or a description of the unsafe condition. */
  current: string;
  /** Mode that would be applied (dirs/files), if any. */
  expected?: string;
}

export async function scanSecretStoreModes(basePath: string): Promise<PermissionIssue[]> {
  const p = await getPath();
  const root = p.resolve(basePath);
  const issues: PermissionIssue[] = [];

  const rootStat = await lstatOrNull(root);
  if (!rootStat) {
    issues.push({ kind: 'unsafe', path: root, current: 'missing (would be created with mode 0700)' });
    return issues;
  }
  if (rootStat.isSymbolicLink()) {
    issues.push({ kind: 'unsafe', path: root, current: 'is a symlink; manual intervention required' });
    return issues;
  }
  if (!rootStat.isDirectory()) {
    issues.push({ kind: 'unsafe', path: root, current: 'is not a directory' });
    return issues;
  }
  if ((rootStat.mode & 0o777) !== SECRET_DIR_MODE) {
    issues.push({
      kind: 'dir',
      path: root,
      current: (rootStat.mode & 0o777).toString(8),
      expected: SECRET_DIR_MODE.toString(8),
    });
  }

  const tenants = p.join(root, TENANTS_SUBDIR);
  const tenantsStat = await lstatOrNull(tenants);
  if (tenantsStat) {
    if (tenantsStat.isSymbolicLink()) {
      issues.push({ kind: 'unsafe', path: tenants, current: 'is a symlink; manual intervention required' });
    } else if (tenantsStat.isDirectory()) {
      if ((tenantsStat.mode & 0o777) !== SECRET_DIR_MODE) {
        issues.push({
          kind: 'dir',
          path: tenants,
          current: (tenantsStat.mode & 0o777).toString(8),
          expected: SECRET_DIR_MODE.toString(8),
        });
      }
      await scanDirectory(tenants, issues);
    }
  }

  return issues;
}

async function scanDirectory(dirPath: string, issues: PermissionIssue[]): Promise<void> {
  const fs = await getFs();
  const p = await getPath();
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = p.join(dirPath, entry.name);
    if (entry.isSymbolicLink()) {
      issues.push({ kind: 'unsafe', path: entryPath, current: 'is a symlink; manual intervention required' });
      continue;
    }
    // Dirent exposes `mode` only on some platforms (Linux/Windows); elsewhere
    // fall back to a stat so the scan never reports wrong modes.
    const mode = (entry as Dirent & { mode?: number }).mode ?? (await lstatOrNull(entryPath))?.mode ?? 0;
    if (entry.isDirectory()) {
      if ((mode & 0o777) !== SECRET_DIR_MODE) {
        issues.push({
          kind: 'dir',
          path: entryPath,
          current: (mode & 0o777).toString(8),
          expected: SECRET_DIR_MODE.toString(8),
        });
      }
      await scanDirectory(entryPath, issues);
    } else if (entry.isFile()) {
      if ((mode & 0o777) !== SECRET_FILE_MODE) {
        issues.push({
          kind: 'file',
          path: entryPath,
          current: (mode & 0o777).toString(8),
          expected: SECRET_FILE_MODE.toString(8),
        });
      }
    }
  }
}

/**
 * Applies mode-only fixes (chmod `0o700`/`0o600`) for the issues reported by
 * `scanSecretStoreModes`. Never deletes files or rewrites contents. Only the
 * running user's own entries are touched; `unsafe` issues require operator
 * intervention and are reported, not modified.
 */
export async function repairSecretStoreModes(basePath: string): Promise<PermissionIssue[]> {
  const p = await getPath();
  const fs = await getFs();
  const root = p.resolve(basePath);
  const rootStat = await lstatOrNull(root);
  if (!rootStat) {
    await createPrivateDir(root);
  }

  const issues = await scanSecretStoreModes(root);
  const fixed: PermissionIssue[] = [];

  for (const issue of issues) {
    if (issue.kind === 'unsafe') continue;
    try {
      await fs.chmod(issue.path, issue.kind === 'dir' ? SECRET_DIR_MODE : SECRET_FILE_MODE);
      fixed.push(issue);
    } catch {
      // Leave to the operator; the issue is already reported.
    }
  }

  return fixed;
}
