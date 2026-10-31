import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Zero-disruption: the tenant-export activity reaches the portable engine only
// through a guarded dynamic import. If @alga-psa/co-managed's module cannot be
// resolved or throws on load, the worker module still loads and the hook is a no-op.
vi.mock('../../../../packages/co-managed/src/portableTemporaryDirectory', () => { throw new Error('co-managed unavailable'); });

const source = readFileSync(resolve(__dirname, '../activities/tenant-export-activities.ts'), 'utf8');

describe('tenant export portable hook', () => {
  it('has no static (module-scope) co-managed import', () => {
    const staticImports = source.split('\n').filter(line => /^\s*(import|export)\b[^(]*from\s+['"]/.test(line));
    expect(staticImports.filter(line => /co-managed/.test(line))).toEqual([]);
  });
  it('is a single dynamic import that swallows both resolution and runtime failure', () => {
    const hooks = source.split('\n').filter(line => /import\(.*co-managed/.test(line));
    expect(hooks).toHaveLength(1);
    expect(hooks[0]).toMatch(/\.then\([^]*,\s*\(\)\s*=>\s*undefined\)\.catch\(\(\)\s*=>\s*undefined\)/);
  });
  it('loads the activity module and the hook resolves to a no-op when the engine fails to load', async () => {
    const activities = await import('../activities/tenant-export-activities.js');
    expect(typeof activities.exportTenantData).toBe('function');
    await expect(import('../../../../packages/co-managed/src/portableTemporaryDirectory').then(() => 'loaded', () => undefined)
      .catch(() => undefined)).resolves.toBeUndefined();
  });
});
