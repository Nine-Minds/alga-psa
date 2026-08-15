import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

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
