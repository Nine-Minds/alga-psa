import type { ISecretProvider } from './ISecretProvider';

/**
 * The hardened filesystem secret core. Dynamically imported so Node's
 * fs/path modules never enter static Next client graphs; only the provider
 * that actually reads or writes filesystem secrets loads it.
 */
type FsSecretCore = typeof import('./fsSecretCore');

const runtimeImport = <TModule,>(specifier: string): Promise<TModule> => {
  const importer = new Function('specifier', 'return import(specifier)') as <T>(specifier: string) => Promise<T>;
  return importer<TModule>(specifier);
};

// Some sandboxed runtimes (e.g. vitest's VM-evaluated forks) provide no
// dynamic-import callback, so this provider can never load fs there. Treat it
// as "provider unavailable" once instead of erroring on every secret access.
// The raw TypeError Node throws ("A dynamic import callback was not
// specified") does not always carry the ERR_VM code, so match both shapes.
let warnedDynamicImportUnavailable = false;
function handleModulesUnavailable(error: unknown): boolean {
  const err = error as (NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException }) | undefined;
  const code = err?.code ?? err?.cause?.code;
  const messages = [err?.message, err?.cause?.message].filter(
    (m): m is string => typeof m === 'string'
  );
  const inMessage = messages.some(
    (m) =>
      m.includes('ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING') ||
      m.includes('A dynamic import callback was not specified')
  );
  if (code !== 'ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING' && !inMessage) {
    return false;
  }
  if (!warnedDynamicImportUnavailable) {
    warnedDynamicImportUnavailable = true;
    console.warn('FileSystemSecretProvider unavailable in this runtime (no dynamic import); falling back to other providers.');
  }
  return true;
}

function loadFsSecretCore(): Promise<FsSecretCore> {
  return runtimeImport<FsSecretCore>('./fsSecretCore');
}

/**
 * Filesystem-backed secret provider that keeps Node's fs/path modules out of
 * static Next client graphs. The Node modules are loaded only when an instance
 * actually reads or writes filesystem secrets.
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
  private corePromise: Promise<FsSecretCore> | null = null;
  private writeBasePathPromise: Promise<string> | null = null;
  private writeRefusalLogged = false;

  constructor() {
    this.serverRoot = typeof process !== 'undefined' && typeof process.cwd === 'function'
      ? process.cwd()
      : '.';
  }

  private getCore(): Promise<FsSecretCore> {
    this.corePromise ??= loadFsSecretCore();
    return this.corePromise;
  }

  private async getBasePath(): Promise<string> {
    if (!this.basePath) {
      const { resolveBasePath } = await this.getCore();
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
        const core = await this.getCore();
        return core.ensureWriteBasePath(await this.getBasePath());
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
    let core: FsSecretCore;
    try {
      core = await this.getCore();
    } catch (error) {
      if (handleModulesUnavailable(error)) return undefined;
      throw error;
    }
    try {
      core.validateSecretComponent(name, 'app secret name');
    } catch (error) {
      if (error instanceof Error && error.name === 'InvalidSecretPathError') {
        console.warn(`Potential path traversal attempt detected for app secret name: ${name}. Denying access.`);
        return undefined;
      }
      throw error;
    }
    const basePath = await this.getBasePath();
    const filePath = core.appSecretPath(basePath, name);
    return core.readFileContentSafe(filePath);
  }

  async getTenantSecret(tenantId: string, name: string): Promise<string | undefined> {
    let core: FsSecretCore;
    try {
      core = await this.getCore();
    } catch (error) {
      if (handleModulesUnavailable(error)) return undefined;
      throw error;
    }
    try {
      core.validateSecretComponent(tenantId, 'tenantId');
      core.validateSecretComponent(name, 'secret name');
    } catch (error) {
      if (error instanceof Error && error.name === 'InvalidSecretPathError') {
        console.warn(`Potential path traversal attempt detected for tenantId: ${tenantId}, name: ${name}. Denying access.`);
        return undefined;
      }
      throw error;
    }
    const basePath = await this.getBasePath();
    const filePath = core.tenantSecretPath(basePath, tenantId, name);
    console.debug(`Attempting to read tenant secret: ${filePath}`);
    return core.readFileContentSafe(filePath);
  }

  async setTenantSecret(tenantId: string, name: string, value: string | null): Promise<void> {
    let core: FsSecretCore;
    try {
      core = await this.getCore();
    } catch (error) {
      // Provider unavailable in this runtime; the write cannot be persisted.
      if (handleModulesUnavailable(error)) return;
      throw error;
    }
    core.validateSecretComponent(tenantId, 'tenantId');
    core.validateSecretComponent(name, 'secret name');

    const basePath = await this.ensureWritableBasePath();
    const filePath = core.tenantSecretPath(basePath, tenantId, name);

    if (value === null) {
      await this.deleteTenantSecret(tenantId, name);
      return;
    }

    try {
      await core.ensurePrivateDirectory(core.tenantDir(basePath, tenantId));
      await core.writeTenantSecretAtomic(filePath, value);
      console.debug(`Successfully wrote tenant secret: ${filePath}`);
    } catch (error: unknown) {
      const fsError = error as NodeJS.ErrnoException;
      console.error(`Error writing tenant secret file ${filePath}: ${fsError.message}`);
      throw new Error(`Failed to set tenant secret: ${fsError.message}`);
    }
  }

  async deleteTenantSecret(tenantId: string, name: string): Promise<void> {
    let core: FsSecretCore;
    try {
      core = await this.getCore();
    } catch (error) {
      // Provider unavailable in this runtime; nothing was persisted to delete.
      if (handleModulesUnavailable(error)) return;
      throw error;
    }
    core.validateSecretComponent(tenantId, 'tenantId');
    core.validateSecretComponent(name, 'secret name');

    const basePath = await this.getBasePath();
    const filePath = core.tenantSecretPath(basePath, tenantId, name);

    try {
      await core.unlinkSecret(filePath);
      console.debug(`Successfully deleted tenant secret file: ${filePath}`);
    } catch (error: unknown) {
      const fsError = error as NodeJS.ErrnoException;
      if (fsError.code === 'ENOENT') {
        console.debug(`Tenant secret file not found during delete (already deleted?): ${filePath}`);
        return;
      }

      console.error(`Error deleting tenant secret file ${filePath}: ${fsError.message}`);
      throw new Error(`Failed to delete tenant secret: ${fsError.message}`);
    }
  }
}
