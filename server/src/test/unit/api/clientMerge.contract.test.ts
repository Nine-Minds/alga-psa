import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(relative: string): string {
  return fs.readFileSync(path.resolve(__dirname, relative), 'utf8');
}

function readRegistryEntries(): Array<{ path: string; method: string; description?: string }> {
  const source = readSource('../../../lib/mcp/registry.generated.ts');
  const marker = 'ChatApiRegistryEntry[] = ';
  const start = source.indexOf(marker) + marker.length;
  const end = source.lastIndexOf('];');
  return JSON.parse(source.slice(start, end + 1));
}

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
    // Declared even though the current generator does not forward it to the
    // registry — the merge is irreversible and must never run unattended.
    expect(source).toContain("'x-chat-approval-required': true");
  });

  it('surfaces the endpoints in the generated MCP registry', () => {
    const entries = readRegistryEntries();
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
    }
  });
});
