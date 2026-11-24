import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../../lib/api/openapi/registry';
import { registerPortalInvitationRoutes } from '../../../lib/api/openapi/routes/portalInvitations';
import { buildBaseRegistry } from '../../../lib/api/openapi';
import { resolveProductApiBehavior } from '../../../lib/productSurfaceRegistry';

const PATHS = [
  '/api/v1/clients/{id}/portal-invitations',
  '/api/v1/portal-invitations/bulk',
];

describe('portal invitations OpenAPI', () => {
  it('registers both paths as POST under user:invite and the generated spec builds', () => {
    const registry = createRegistry();
    registerPortalInvitationRoutes(registry);
    const routes = registry.getRegisteredRoutes();
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual(PATHS.map((p) => `post ${p}`));
    for (const route of routes) {
      expect(route.extensions?.['x-rbac-resource']).toBe('user');
      expect(route.extensions?.['x-rbac-action']).toBe('invite');
    }
    const doc = registry.buildDocument({ title: 't', version: 'test', edition: 'ee' }) as any;
    for (const p of PATHS) {
      expect(Object.keys(doc.paths[p])).toEqual(['post']);
      expect(Object.keys(doc.paths[p].post.responses)).toEqual(expect.arrayContaining(['200', '400', '401', '403']));
    }
  });

  it.each(['ClientPortalInvitationRequest', 'BulkPortalInvitationRequest'])('documents invitation-state selection on %s', (schema) => {
    const registry = createRegistry();
    registerPortalInvitationRoutes(registry);
    const doc = registry.buildDocument({ title: 't', version: 'test', edition: 'ee' }) as any;
    const body = doc.components.schemas[schema];

    expect(body.properties.invitation_states.items.enum).toEqual(['expired', 'pending']);
    expect(body.properties.invitation_states.description).toMatch(/expired/i);
    expect(body.required ?? []).not.toContain('invitation_states');

    // The documented rule is the one the query runs: the state of the
    // contact's LATEST invitation, and a narrowing of contact_ids rather than
    // something the endpoint ignores when they are given.
    expect(body.properties.invitation_states.description).toMatch(/latest invitation/i);
    expect(body.properties.invitation_states.description).toMatch(/used or revoked/i);
    expect(body.properties.invitation_states.description).toMatch(/narrows contact_ids/i);
    expect(body.properties.invitation_states.description).not.toMatch(/Ignored when contact_ids/i);
  });

  it('is wired into the base registry', () => {
    const doc = buildBaseRegistry().buildDocument({ title: 't', version: 'test', edition: 'ee' }) as any;
    for (const p of PATHS) expect(doc.paths[p]?.post).toBeTruthy();
  });

  it('requires approval before an agent mails a batch of contacts', () => {
    const registry = createRegistry();
    registerPortalInvitationRoutes(registry);
    for (const route of registry.getRegisteredRoutes()) {
      expect(route.extensions?.['x-chat-approval-required']).toBe(true);
    }

    // The spec nests route extensions, so the generated registries take the
    // flag from the curated override. Both have to agree.
    for (const registryPath of [
      '../../../lib/mcp/registry.generated.ts',
      '../../../../../ee/server/src/chat/registry/apiRegistry.generated.ts',
    ]) {
      const source = fs.readFileSync(path.resolve(__dirname, registryPath), 'utf8');
      const marker = 'ChatApiRegistryEntry[] = ';
      const start = source.indexOf(marker) + marker.length;
      const entries = JSON.parse(source.slice(start, source.lastIndexOf('];') + 1)) as Array<{
        method: string; path: string; approvalRequired?: boolean;
      }>;
      for (const p of PATHS) {
        const entry = entries.find((candidate) => candidate.method === 'post' && candidate.path === p);
        expect(entry, `${p} missing from ${registryPath}`).toBeTruthy();
        expect(entry!.approvalRequired).toBe(true);
      }
    }
  });

  it('is ruled in the product surface registry rather than riding the fallback', () => {
    for (const product of ['psa', 'algadesk'] as const) {
      expect(resolveProductApiBehavior(product, '/api/v1/portal-invitations/bulk')).toBe('allowed');
    }
  });
});
