/**
 * Gateway Registry Facade
 * Thin abstraction used by the API gateway to resolve:
 *  - tenant install: { version_id, content_hash }
 *  - manifest v2: { api: { endpoints: [...] } }
 *
 * Design:
 *  - Keep a seam for DB-backed registry wiring later.
 *  - In dev mode (NODE_ENV !== 'production'), provide a functional stub that
 *    returns a deterministic install and a simple manifest with endpoints
 *    to exercise the gateway.
 *
 * References:
 *  - ee/docs/extension-system/api-routing-guide.md
 *  - ee/server/src/lib/extensions/registry-v2.ts
 */

import type { Method } from './gateway-utils';

export interface ApiEndpointDef {
  method: Method;
  path: string;
  handler: string;
}

export interface ManifestV2 {
  api: {
    endpoints: ApiEndpointDef[];
  };
}

export interface TenantInstall {
  install_id: string;
  version_id: string;
  content_hash: string;
}

export interface RegistryFacade {
  getTenantInstall(tenantId: string, extensionId: string): Promise<TenantInstall | null>;
  getManifest(versionId: string): Promise<ManifestV2 | null>;
}

/**
 * Default (production) facade – placeholders returning null until DB wiring is ready.
 */
class NullRegistryFacade implements RegistryFacade {
  async getTenantInstall(_tenantId: string, _extensionId: string): Promise<TenantInstall | null> {
    // TODO: Implement with real DB/registry once available
    return null;
  }

  async getManifest(_versionId: string): Promise<ManifestV2 | null> {
    // TODO: Implement with real manifest loading (bundle metadata/registry)
    return null;
  }
}

/**
 * Dev facade – returns a basic install + manifest to demonstrate endpoint matching
 * Only active when NODE_ENV !== 'production'
 */
class DevRegistryFacade implements RegistryFacade {
  async getTenantInstall(tenantId: string, extensionId: string): Promise<TenantInstall | null> {
    // Provide a deterministic install to exercise local gateway without DB
    // We scope it for any tenant/extension to keep demo simple.
    return {
      install_id: `dev-install-${sanitize(tenantId)}-${sanitize(extensionId)}`,
      version_id: `v2-dev-${sanitize(extensionId)}`,
      content_hash: 'sha256:devcontenthash',
    };
  }

  async getManifest(versionId: string): Promise<ManifestV2 | null> {
    // Attempt to read a fixture manifest from example-integration if present in the future.
    // Current example manifests are UI-focused; provide a built-in API manifest for testing.
    // Endpoints cover: literal, param, and nested param routes per routing guide.

    const endpoints: ApiEndpointDef[] = [
      { method: 'GET', path: '/agreements', handler: 'dist/handlers/http/list-agreements' },
      { method: 'GET', path: '/agreements/:id', handler: 'dist/handlers/http/get-agreement' },
      { method: 'POST', path: '/agreements/sync', handler: 'dist/handlers/http/sync' },
      { method: 'PUT', path: '/agreements/:id', handler: 'dist/handlers/http/update-agreement' },
      { method: 'DELETE', path: '/agreements/:id', handler: 'dist/handlers/http/delete-agreement' },
    ];

    return { api: { endpoints } };
  }
}

function sanitize(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9\-_.]/g, '_');
}

/**
 * Obtain the facade for current environment.
 * - production: NullRegistryFacade (returns nulls)
 * - non-production: DevRegistryFacade (functional stub)
 */
export function getRegistryFacade(): RegistryFacade {
  if (process.env.NODE_ENV !== 'production') {
    return new DevRegistryFacade();
  }
  return new NullRegistryFacade();
}
