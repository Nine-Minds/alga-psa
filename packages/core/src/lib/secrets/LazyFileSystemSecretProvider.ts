import type { ISecretProvider } from './ISecretProvider';

const DOCKER_SECRETS_PATH = '/run/secrets';

interface NodePathModule {
  basename(path: string): string;
  isAbsolute(path: string): boolean;
  join(...paths: string[]): string;
  resolve(...paths: string[]): string;
}

interface NodeFsPromisesModule {
  access(path: string): Promise<void>;
  mkdir(path: string, options: { recursive: boolean }): Promise<unknown>;
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  unlink(path: string): Promise<void>;
  writeFile(path: string, data: string, encoding: BufferEncoding): Promise<void>;
}

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

async function loadNodeFileSystemModules(): Promise<{
  fs: NodeFsPromisesModule;
  path: NodePathModule;
}> {
  const [fs, path] = await Promise.all([
    runtimeImport<NodeFsPromisesModule>('node:fs/promises'),
    runtimeImport<NodePathModule>('node:path'),
  ]);

  return { fs, path };
}

/**
 * Filesystem-backed secret provider that keeps Node's fs/path modules out of
 * static Next client graphs. The Node modules are loaded only when an instance
 * actually reads or writes filesystem secrets.
 */
export class FileSystemSecretProvider implements ISecretProvider {
  private readonly serverRoot: string;
  private basePath: string | undefined;
  private modulesPromise: Promise<{ fs: NodeFsPromisesModule; path: NodePathModule }> | null = null;

  constructor() {
    this.serverRoot = typeof process !== 'undefined' ? process.cwd() : '.';
  }

  private getModules(): Promise<{ fs: NodeFsPromisesModule; path: NodePathModule }> {
    this.modulesPromise ??= loadNodeFileSystemModules();
    return this.modulesPromise;
  }

  private async resolveBasePath(): Promise<string> {
    const { fs, path } = await this.getModules();
    const configured = process.env.SECRET_FS_BASE_PATH;

    if (configured && configured.trim() !== '') {
      return path.isAbsolute(configured) ? configured : path.resolve(this.serverRoot, configured);
    }

    try {
      await fs.access(DOCKER_SECRETS_PATH);
      return DOCKER_SECRETS_PATH;
    } catch {
      // Not running in a container / secrets not mounted.
    }

    const candidates = [
      path.resolve(this.serverRoot, 'secrets'),
      path.resolve(this.serverRoot, '../secrets'),
    ];

    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // Keep searching.
      }
    }

    return path.resolve(this.serverRoot, '../secrets');
  }

  async getBasePath(): Promise<string> {
    if (!this.basePath) {
      this.basePath = await this.resolveBasePath();
    }

    return this.basePath;
  }

  private async readFileContent(filePath: string): Promise<string | undefined> {
    const { fs } = await this.getModules();

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return content.trim();
    } catch (error: unknown) {
      const fsError = error as NodeJS.ErrnoException;
      if (fsError.code !== 'ENOENT') {
        console.error(`Error reading secret file ${filePath}: ${fsError.message}`);
      }
      return undefined;
    }
  }

  async getAppSecret(name: string): Promise<string | undefined> {
    let path: NodePathModule;
    try {
      ({ path } = await this.getModules());
    } catch (error) {
      if (handleModulesUnavailable(error)) return undefined;
      throw error;
    }
    const safeName = path.basename(name);

    if (safeName !== name) {
      console.warn(`Potential path traversal attempt detected for app secret name: ${name}. Denying access.`);
      return undefined;
    }

    return this.readFileContent(path.join(await this.getBasePath(), safeName));
  }

  async getTenantSecret(tenantId: string, name: string): Promise<string | undefined> {
    let path: NodePathModule;
    try {
      ({ path } = await this.getModules());
    } catch (error) {
      if (handleModulesUnavailable(error)) return undefined;
      throw error;
    }
    const safeTenantId = path.basename(tenantId);
    const safeName = path.basename(name);

    if (safeTenantId !== tenantId || safeName !== name) {
      console.warn(`Potential path traversal attempt detected for tenantId: ${tenantId}, name: ${name}. Denying access.`);
      return undefined;
    }

    const filePath = path.join(await this.getBasePath(), 'tenants', safeTenantId, safeName);
    console.debug(`Attempting to read tenant secret: ${filePath}`);
    return this.readFileContent(filePath);
  }

  async setTenantSecret(tenantId: string, name: string, value: string | null): Promise<void> {
    let fs: NodeFsPromisesModule;
    let path: NodePathModule;
    try {
      ({ fs, path } = await this.getModules());
    } catch (error) {
      // Provider unavailable in this runtime; the write cannot be persisted.
      if (handleModulesUnavailable(error)) return;
      throw error;
    }
    const safeTenantId = path.basename(tenantId);
    const safeName = path.basename(name);

    if (safeTenantId !== tenantId || safeName !== name) {
      console.warn(`Potential path traversal attempt detected for setTenantSecret (tenantId: ${tenantId}, name: ${name}). Aborting.`);
      throw new Error('Invalid tenantId or secret name.');
    }

    const tenantDirPath = path.join(await this.getBasePath(), 'tenants', safeTenantId);
    const filePath = path.join(tenantDirPath, safeName);

    if (value === null) {
      await this.deleteTenantSecret(tenantId, name);
      return;
    }

    try {
      await fs.mkdir(tenantDirPath, { recursive: true });
      await fs.writeFile(filePath, value, 'utf-8');
      console.debug(`Successfully wrote tenant secret: ${filePath}`);
    } catch (error: unknown) {
      const fsError = error as NodeJS.ErrnoException;
      console.error(`Error writing tenant secret file ${filePath}: ${fsError.message}`);
      throw new Error(`Failed to set tenant secret: ${fsError.message}`);
    }
  }

  async deleteTenantSecret(tenantId: string, name: string): Promise<void> {
    let fs: NodeFsPromisesModule;
    let path: NodePathModule;
    try {
      ({ fs, path } = await this.getModules());
    } catch (error) {
      // Provider unavailable in this runtime; nothing was persisted to delete.
      if (handleModulesUnavailable(error)) return;
      throw error;
    }
    const safeTenantId = path.basename(tenantId);
    const safeName = path.basename(name);

    if (safeTenantId !== tenantId || safeName !== name) {
      console.warn(`Potential path traversal attempt detected for deleteTenantSecret (tenantId: ${tenantId}, name: ${name}). Aborting.`);
      throw new Error('Invalid tenantId or secret name.');
    }

    const filePath = path.join(await this.getBasePath(), 'tenants', safeTenantId, safeName);

    try {
      await fs.unlink(filePath);
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
