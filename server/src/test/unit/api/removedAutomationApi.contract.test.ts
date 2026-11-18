import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runRegistrySearch } from '@alga-psa/agent-tooling';
import { buildBaseRegistry } from '../../../lib/api/openapi';
import { chatApiRegistry } from '../../../lib/mcp/registry.generated';

/**
 * Guard for alga-2026-0002708: the unfinished /api/v1/automation API was removed
 * because MCP clients kept picking its tools and hitting a 403 for an RBAC
 * resource no role can hold. Workflow definitions are the supported automation
 * surface. Fail fast if the dead prefix reappears in source, the OpenAPI
 * registry, or any checked-in generated artifact.
 */
const REMOVED_PREFIX = '/api/v1/automation';
const repoRoot = path.resolve(__dirname, '../../../../..');

const GENERATED_ARTIFACTS = [
  'docs/openapi/route-inventory.json',
  'docs/openapi/schema-coverage.json',
  'sdk/docs/openapi/alga-openapi.json',
  'sdk/docs/openapi/alga-openapi.ce.json',
  'sdk/docs/openapi/alga-openapi.ee.json',
  'server/src/lib/mcp/registry.generated.ts',
  'ee/server/src/chat/registry/apiRegistry.generated.ts',
];

describe('removed /api/v1/automation API', () => {
  it('has no route handlers under server/src/app/api/v1/automation', () => {
    expect(fs.existsSync(path.join(repoRoot, 'server/src/app/api/v1/automation'))).toBe(false);
  });

  it.each(['ce', 'ee'] as const)('is not registered in the %s OpenAPI registry', (edition) => {
    const document = buildBaseRegistry({ edition }).buildDocument({
      title: 'guard',
      version: 'test',
      edition,
    }) as { paths?: Record<string, unknown>; tags?: Array<{ name: string }> };

    const paths = Object.keys(document.paths ?? {});
    expect(paths.filter((p) => p.startsWith(REMOVED_PREFIX))).toEqual([]);
    expect(paths).toContain('/api/workflow-definitions');
    expect((document.tags ?? []).map((t) => t.name)).not.toContain('Automation');
  });

  it.each(GENERATED_ARTIFACTS)('is absent from %s', (relativePath) => {
    const content = fs.readFileSync(path.join(repoRoot, relativePath), 'utf-8');
    expect(content.includes(REMOVED_PREFIX)).toBe(false);
  });

  it('is not returned by MCP registry search while workflow definitions still are', () => {
    const automation = runRegistrySearch(chatApiRegistry, { query: 'automation rules', limit: 20 });
    expect(automation.ok).toBe(true);
    if (!automation.ok) return;
    expect(automation.data.results.filter((r) => r.path.startsWith(REMOVED_PREFIX))).toEqual([]);

    const workflows = runRegistrySearch(chatApiRegistry, { query: 'workflow definitions', limit: 20 });
    expect(workflows.ok).toBe(true);
    if (!workflows.ok) return;
    expect(workflows.data.results.some((r) => r.path === '/api/workflow-definitions')).toBe(true);
  });
});
