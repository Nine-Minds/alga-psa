// EE-only registry service v2 (scaffold)

export type RegistryId = string;
export type VersionId = string;

export interface ApiEndpointDef {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  handler: string; // e.g., "dist/handlers/http/sync#handle"
}

export interface UiDef {
  type: 'iframe';
  entry: string;
  routes?: { path: string; iframePath: string }[];
}

export interface RegistryEntry {
  id: RegistryId;
  publisher: string;
  name: string;
  displayName?: string;
  description?: string;
}

export interface VersionEntry {
  id: VersionId;
  registryId: RegistryId;
  version: string;
  runtime: string; // e.g., wasm-js@1
  mainEntry: string;
  api: { endpoints: ApiEndpointDef[] };
  ui?: UiDef;
  capabilities: string[];
}

export interface BundleDescriptor {
  id: string;
  versionId: VersionId;
  contentHash: string; // sha256:...
  signature?: string; // detached signature text
  precompiled?: Record<string, string>; // target -> path
}

// Placeholder DB client type to avoid importing CE DB here
type DB = any;

export class ExtensionRegistryServiceV2 {
  constructor(private db: DB) {}

  async createRegistryEntry(input: Omit<RegistryEntry, 'id'>): Promise<RegistryEntry> {
    // TODO: implement with EE DB
    return { id: crypto.randomUUID(), ...input } as RegistryEntry;
  }

  async listRegistryEntries(): Promise<RegistryEntry[]> {
    return [];
  }

  async getRegistryEntryByName(publisher: string, name: string): Promise<RegistryEntry | null> {
    return null;
  }

  async addVersion(entryId: RegistryId, v: Omit<VersionEntry, 'id' | 'registryId'>): Promise<VersionEntry> {
    return { id: crypto.randomUUID(), registryId: entryId, ...v } as VersionEntry;
  }

  async attachBundle(versionId: VersionId, b: Omit<BundleDescriptor, 'id' | 'versionId'>): Promise<BundleDescriptor> {
    return { id: crypto.randomUUID(), versionId, ...b } as BundleDescriptor;
  }
}

