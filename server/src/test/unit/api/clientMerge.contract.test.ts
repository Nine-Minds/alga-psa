import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(relative: string): string {
  return fs.readFileSync(path.resolve(__dirname, relative), 'utf8');
}

interface RegistryEntry {
  path: string;
  method: string;
  description?: string;
  rbacResource?: string;
  approvalRequired?: boolean;
}

function readRegistryEntries(relative: string): RegistryEntry[] {
  const source = readSource(relative);
  const marker = 'ChatApiRegistryEntry[] = ';
  const start = source.indexOf(marker) + marker.length;
  const end = source.lastIndexOf('];');
  return JSON.parse(source.slice(start, end + 1));
}

const REGISTRIES = {
  ce: '../../../lib/mcp/registry.generated.ts',
  ee: '../../../../../ee/server/src/chat/registry/apiRegistry.generated.ts',
} as const;

describe('client merge API contract', () => {
  it('exposes merge, merge preview and profile contacts as v1 routes', () => {
    expect(readSource('../../../app/api/v1/clients/[id]/merge/route.ts'))
      .toContain('controller.merge()');
    expect(readSource('../../../app/api/v1/clients/[id]/merge/preview/route.ts'))
      .toContain('controller.mergePreview()');

    const contacts = readSource(
      '../../../app/api/v1/clients/[id]/billing-profiles/[profileId]/contacts/route.ts'
    );
    expect(contacts).toContain('controller.getBillingProfileContacts()');
    expect(contacts).toContain('controller.setBillingProfileContacts()');
  });

  it('requires delete as well as update to run a merge', () => {
    // A merge retires the source client. An API key that may only edit clients
    // must not be able to retire one through this route.
    const controller = readSource('../../../lib/api/controllers/ApiClientController.ts');
    const merge = controller.slice(controller.indexOf('  merge() {'));
    expect(merge).toContain("this.options.permissions?.update || 'update'");
    expect(merge).toContain("this.options.permissions?.delete || 'delete'");
  });

  it('documents the routes in the OpenAPI registry with real metadata', () => {
    const source = readSource('../../../lib/api/openapi/routes/clientsContacts.ts');

    expect(source).toContain("path: '/api/v1/clients/{id}/merge/preview'");
    expect(source).toContain("path: '/api/v1/clients/{id}/merge'");
    expect(source).toContain("path: '/api/v1/clients/{id}/billing-profiles/{profileId}/contacts'");
    expect(source).toContain("'x-chat-approval-required': true");
  });

  it.each(Object.entries(REGISTRIES))(
    'surfaces the endpoints in the generated %s MCP registry',
    (_edition, registryPath) => {
      const entries = readRegistryEntries(registryPath);
      const byKey = new Map(entries.map((entry) => [`${entry.method}::${entry.path}`, entry]));

      for (const key of [
        'post::/api/v1/clients/{id}/merge/preview',
        'post::/api/v1/clients/{id}/merge',
        'get::/api/v1/clients/{id}/billing-profiles/{profileId}/contacts',
        'put::/api/v1/clients/{id}/billing-profiles/{profileId}/contacts',
      ]) {
        const entry = byKey.get(key);
        expect(entry, `${key} missing from the MCP registry`).toBeDefined();
        // Route-inventory placeholders are dropped at emit time; a real
        // description is what proves this entry was curated rather than inferred.
        expect(entry!.description).toBeTruthy();
        expect(entry!.description).not.toContain('generated automatically from the route inventory');
        expect(entry!.rbacResource).toBe('client');
      }
    },
  );

  it.each(Object.entries(REGISTRIES))(
    'gates the irreversible merge behind approval in the %s registry',
    (_edition, registryPath) => {
      // The OpenAPI extension alone does not reach the registry — the spec
      // generator nests route extensions under `extensions`, so the flag is
      // carried by the curated override in ee/docs/api-registry/clients.json.
      // Asserting on the emitted entry (not the source string) is what keeps a
      // regenerated registry from silently dropping the gate and letting an
      // agent retire a client unattended.
      const entries = readRegistryEntries(registryPath);
      const approval = Object.fromEntries(
        entries
          .filter(
            (entry) =>
              entry.path.startsWith('/api/v1/clients/{id}/merge') ||
              entry.path === '/api/v1/clients/{id}/billing-profiles/{profileId}/contacts',
          )
          .map((entry) => [`${entry.method} ${entry.path}`, entry.approvalRequired]),
      );

      expect(approval).toEqual({
        'post /api/v1/clients/{id}/merge': true,
        'post /api/v1/clients/{id}/merge/preview': false,
        'get /api/v1/clients/{id}/billing-profiles/{profileId}/contacts': false,
        'put /api/v1/clients/{id}/billing-profiles/{profileId}/contacts': false,
      });
    },
  );
});
