import type { ISecretProvider } from './ISecretProvider';
import {
  appSecretPath,
  ensurePrivateDirectory,
  ensureWriteBasePath,
  readFileContentSafe,
  resolveBasePath,
  tenantDir,
  tenantSecretPath,
  unlinkTenantSecret,
  validateSecretComponent,
  writeTenantSecretAtomic,
} from './fsSecretCore';

/**
 * Filesystem-backed secret provider.
 *
 * The hardened write path lives in `fsSecretCore`, which is imported statically
 * so bundlers always include it (a relative dynamic import would fail to
 * resolve in dist ESM and would be invisible to webpack in source mode).
 * `fsSecretCore` itself lazily loads Node's `fs`/`path`/`crypto` builtins at
 * call time, so the `node:` specifiers never enter static Next client graphs
 * even though this module is part of the bundle.
 *
 * Secret storage is hardened:
 * - tenant directories are `0o700`, secret files are `0o600` regardless of
 *   umask or volume ownership,
 * - writes are atomic (exclusive temp file + fsync + rename) so a crash never
 *   leaves a truncated secret in place of a valid one,
 * - path components are allowlist-validated and symlinks are rejected on the
 *   write path,
 * - the secret root is validated before the first write; writes are refused
 *   with an actionable operator message when the location cannot be made safe.
 */
export class FileSystemSecretProvider implements ISecretProvider {
  private readonly serverRoot: string;
  private basePath: string | undefined;
  private writeBasePathPromise: Promise<string> | null = null;
  private writeRefusalLogged = false;

  constructor() {
    this.serverRoot = typeof process !== 'undefined' && typeof process.cwd === 'function'
      ? process.cwd()
      : '.';
  }

  private async getBasePath(): Promise<string> {
    if (!this.basePath) {
      this.basePath = await resolveBasePath(this.serverRoot);
    }
    return this.basePath;
  }

  /**
   * Validates the write location once per instance and returns the resolved
   * base path. The result is cached; if the location is unsafe, the precise
   * operator message is logged once and every write is refused.
   */
  private async ensureWritableBasePath(): Promise<string> {
    if (!this.writeBasePathPromise) {
      this.writeBasePathPromise = (async () => {
        return ensureWriteBasePath(await this.getBasePath());
      })();
      this.writeBasePathPromise.catch((error) => {
        if (error instanceof Error && !this.writeRefusalLogged) {
          this.writeRefusalLogged = true;
          console.error(error.message);
        }
      });
    }
    return this.writeBasePathPromise;
  }

  async getAppSecret(name: string): Promise<string | undefined> {
    try {
      validateSecretComponent(name, 'app secret name');
    } catch (error) {
      if (error instanceof Error && error.name === 'InvalidSecretPathError') {
        console.warn(`Potential path traversal attempt detected for app secret name: ${name}. Denying access.`);
        return undefined;
      }
      throw error;
    }
    const basePath = await this.getBasePath();
    const filePath = await appSecretPath(basePath, name);
    return readFileContentSafe(filePath);
  }

  async getTenantSecret(tenantId: string, name: string): Promise<string | undefined> {
    try {
      validateSecretComponent(tenantId, 'tenantId');
      validateSecretComponent(name, 'secret name');
    } catch (error) {
      if (error instanceof Error && error.name === 'InvalidSecretPathError') {
        console.warn(`Potential path traversal attempt detected for tenantId: ${tenantId}, name: ${name}. Denying access.`);
        return undefined;
      }
      throw error;
    }
    const basePath = await this.getBasePath();
    const filePath = await tenantSecretPath(basePath, tenantId, name);
    console.debug(`Attempting to read tenant secret: ${filePath}`);
    return readFileContentSafe(filePath);
  }

  async setTenantSecret(tenantId: string, name: string, value: string | null): Promise<void> {
    validateSecretComponent(tenantId, 'tenantId');
    validateSecretComponent(name, 'secret name');

    const basePath = await this.ensureWritableBasePath();
    const filePath = await tenantSecretPath(basePath, tenantId, name);

    if (value === null) {
      await this.deleteTenantSecret(tenantId, name);
      return;
    }

    try {
      await ensurePrivateDirectory(await tenantDir(basePath, tenantId));
      await writeTenantSecretAtomic(filePath, value);
      console.debug(`Successfully wrote tenant secret: ${filePath}`);
    } catch (error: unknown) {
      const fsError = error as NodeJS.ErrnoException;
      console.error(`Error writing tenant secret file ${filePath}: ${fsError.message}`);
      throw new Error(`Failed to set tenant secret: ${fsError.message}`);
    }
  }

  async deleteTenantSecret(tenantId: string, name: string): Promise<void> {
    validateSecretComponent(tenantId, 'tenantId');
    validateSecretComponent(name, 'secret name');

    const basePath = await this.getBasePath();

    try {
      // Validates the whole directory chain (root, tenants/, tenant dir) as
      // real non-symlink directories immediately before the unlink; a missing
      // component or file is an idempotent no-op. A symlinked component throws
      // InvalidSecretPathError (no ENOENT code), so it can never be swallowed
      // by the already-deleted branch below.
      await unlinkTenantSecret(basePath, tenantId, name);
      console.debug(`Successfully deleted tenant secret '${name}' for tenant ${tenantId}`);
    } catch (error: unknown) {
      const fsError = error as NodeJS.ErrnoException;
      if (fsError.code === 'ENOENT') {
        console.debug(`Tenant secret '${name}' for tenant ${tenantId} not found during delete (already deleted?)`);
        return;
      }

      console.error(`Error deleting tenant secret '${name}' for tenant ${tenantId}: ${fsError.message}`);
      throw new Error(`Failed to delete tenant secret: ${fsError.message}`);
    }
  }
}
