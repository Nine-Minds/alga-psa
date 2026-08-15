import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { chatApiRegistry } from '../../lib/mcp/registry.generated';

/**
 * Guards the extension gateway documentation against regressing to its old
 * "placeholder / no-op" access language. The canonical OpenAPI source and every
 * derived artifact (specs, MCP registry, chat registry) must describe the real
 * fail-closed posture instead.
 */
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');

const BANNED_GATEWAY_AUTHZ_PHRASES = [
  'placeholder access check',
  'does not enforce per-extension RBAC',
  'no-op access',
];

const ARTIFACTS = [
  'server/src/lib/api/openapi/routes/extensionGateway.ts',
  'sdk/docs/openapi/alga-openapi.ce.json',
  'sdk/docs/openapi/alga-openapi.ce.yaml',
  'sdk/docs/openapi/alga-openapi.ee.json',
  'sdk/docs/openapi/alga-openapi.ee.yaml',
  'sdk/docs/openapi/alga-openapi.json',
  'sdk/docs/openapi/alga-openapi.yaml',
  'server/src/lib/mcp/registry.generated.ts',
  'ee/server/src/chat/registry/apiRegistry.generated.ts',
];

describe('extension gateway OpenAPI/registry descriptions', () => {
  for (const artifact of ARTIFACTS) {
    it(`contains no placeholder/no-op authz language in ${path.relative(repoRoot, artifact)}`, () => {
      const absolute = path.resolve(repoRoot, artifact);
      expect(fs.existsSync(absolute), `missing artifact ${artifact}`).toBe(true);
      const content = fs.readFileSync(absolute, 'utf8');

      for (const phrase of BANNED_GATEWAY_AUTHZ_PHRASES) {
        expect(content, `banned phrase "${phrase}"`).not.toContain(phrase);
      }

      // The regenerated posture must actually be present, so this test fails
      // if the artifacts drift from the canonical source rather than just
      // passing on an empty file.
      expect(content).toContain('fails closed');
    });
  }
});

describe('extension gateway registry RBAC method mapping', () => {
  const GATEWAY_PATH = '/api/ext/{extensionId}/{path}';
  const READ_PHRASE = 'extension:read permission for GET/HEAD';
  const WRITE_PHRASE = 'extension:write permission for POST/PUT/PATCH/DELETE';

  /**
   * Both directions of the RBAC mapping must be pinned exactly: reads pair
   * with extension:read, mutations pair with extension:write. The swapped
   * pairings and the stale single-permission phrasing must never appear.
   */
  function assertMappingPhrasing(description: string, label: string) {
    expect(description, `${label}: read methods must map to extension:read`).toContain(READ_PHRASE);
    expect(description, `${label}: mutations must map to extension:write`).toContain(WRITE_PHRASE);
    expect(description, `${label}: extension:read must never pair with mutations`).not.toContain(
      'extension:read permission for POST/PUT/PATCH/DELETE',
    );
    expect(description, `${label}: extension:write must never pair with reads`).not.toContain(
      'extension:write permission for GET/HEAD',
    );
    expect(description, `${label}: stale single-permission phrasing must not survive`).not.toContain(
      'the extension read permission for MSP users',
    );
  }

  it('canonical OpenAPI source states the read/write mapping', () => {
    const source = fs.readFileSync(
      path.resolve(repoRoot, 'server/src/lib/api/openapi/routes/extensionGateway.ts'),
      'utf8',
    );
    assertMappingPhrasing(source, 'canonical source');
  });

  for (const spec of ['alga-openapi.ce.json', 'alga-openapi.ee.json', 'alga-openapi.json']) {
    it(`generated OpenAPI spec ${spec} documents the read/write mapping on every gateway method`, () => {
      const document = JSON.parse(
        fs.readFileSync(path.resolve(repoRoot, 'sdk/docs/openapi', spec), 'utf8'),
      );
      const gateway = document.paths?.[GATEWAY_PATH];
      expect(gateway, `${spec}: gateway path missing`).toBeDefined();
      for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
        expect(gateway[method], `${spec}: method ${method} missing`).toBeDefined();
        assertMappingPhrasing(gateway[method].description ?? '', `${spec} ${method}`);
      }
    });
  }

  it('MCP/chat registry entries for the gateway carry the read/write mapping', () => {
    const gatewayEntries = chatApiRegistry.filter((entry) => entry.path === GATEWAY_PATH);
    expect(gatewayEntries.length).toBe(5);
    for (const entry of gatewayEntries) {
      assertMappingPhrasing(entry.description ?? '', `registry ${entry.method} ${entry.path}`);
    }

    const eeChatRegistry = fs.readFileSync(
      path.resolve(repoRoot, 'ee/server/src/chat/registry/apiRegistry.generated.ts'),
      'utf8',
    );
    assertMappingPhrasing(eeChatRegistry, 'EE chat registry');
  });
});
