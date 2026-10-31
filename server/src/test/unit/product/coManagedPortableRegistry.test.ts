import { describe, expect, it } from 'vitest';
import { createPortableContributorRegistry, PortableContributorError, type PortableContributor } from '../../../../../packages/co-managed/src/portableContributorRegistry';
import { portableAssetContributor } from '../../../../../packages/co-managed/src/portableAssetExport';
import { CORE_PORTABLE_CONTRIBUTORS, createCorePortableRegistry } from '../../../../../packages/co-managed/src/portableCoreRegistry';
import { assertPortableWorkspaceCurrent, buildPortableReferenceEdges, collectPortableWorkspace, portableCanonicalJson }
  from '../../../../../packages/co-managed/src/portableWorkspaceGraph';
import { CoManagedSharedWorkError } from '../../../../../packages/co-managed/src/sharedWorkIdentity';

const TENANT = '11111111-1111-4111-8111-111111111111', PACKAGE = '22222222-2222-4222-8222-222222222222';
const ctx = { db: {} as any, actor: { kind: 'session', tenant: TENANT, userId: 'u', sessionId: 's' } as any, packageId: PACKAGE, snapshot: { capturedAt: '2026-01-01T00:00:00.000Z' } };

/** A stub domain: two tables, one in-domain edge, one external edge to an undelivered domain. */
function stub(overrides: Partial<PortableContributor> = {}, rows = { stub_parents: [{ parent_id: 'p1', name: 'A' }], stub_children: [{ child_id: 'c1', parent_id: 'p1', ticket_id: 't-external' }] }): PortableContributor {
  return {
    id: 'stub', version: 1, reason: 'test domain',
    columns: { stub_parents: ['parent_id', 'name'], stub_children: ['child_id', 'parent_id', 'ticket_id'] },
    references: [['stub_children', 'parent_id', 'stub_parents', 'parent_id'], ['stub_children', 'ticket_id', 'tickets', 'ticket_id']],
    export: async () => ({ records: structuredClone(rows), annotations: { note: 'x' } }),
    retain: async () => ({ records: structuredClone(rows) }),
    validate: () => {},
    ...overrides,
  };
}

describe('portable contributor registry contract', () => {
  it('registers a stub contributor and the real asset contributor', () => {
    const registry = createPortableContributorRegistry([stub(), portableAssetContributor]);
    expect(registry.list().map(c => c.id)).toEqual(['assets', 'stub']);
    expect(registry.owner('stub_parents')?.id).toBe('stub');
    expect(registry.owner('assets')?.id).toBe('assets');
    expect(registry.owner('nope')).toBeUndefined();
  });
  it('registers the core set with disjoint table ownership', () => {
    expect(CORE_PORTABLE_CONTRIBUTORS.map(c => c.id)).toEqual(['core', 'work', 'assets', 'workflows']);
    expect(createCorePortableRegistry().list()).toHaveLength(4);
  });
  const bad: [string, Partial<PortableContributor>][] = [
    ['bad id', { id: 'Bad Id' }], ['bad version', { version: 0 }], ['no reason', { reason: '' }],
    ['missing export', { export: undefined as any }], ['missing retain', { retain: undefined as any }], ['missing validate', { validate: undefined as any }],
    ['empty columns', { columns: {} }], ['reference from unowned table', { references: [['elsewhere', 'x', 'stub_parents', 'parent_id']] }],
    ['reference from unowned column', { references: [['stub_children', 'zzz', 'stub_parents', 'parent_id']] }],
    ['malformed reference', { references: [['stub_children', 'parent_id'] as any] }],
  ];
  it.each(bad)('rejects a bad contributor: %s', (_name, patch) => {
    const registry = createPortableContributorRegistry();
    expect(() => registry.register(stub(patch))).toThrow(PortableContributorError);
    expect(registry.list()).toHaveLength(0);
  });
  it('rejects duplicate ids and tables claimed by two contributors', () => {
    const registry = createPortableContributorRegistry([stub()]);
    expect(() => registry.register(stub())).toThrow(PortableContributorError);
    expect(() => registry.register(stub({ id: 'other' }))).toThrow(/stub_parents|already/i);
  });
  it('classifies edges as resolved or external from the registry alone', () => {
    const edges = buildPortableReferenceEdges(createPortableContributorRegistry([stub()]));
    expect(edges.map(e => [e.column, e.status]).sort()).toEqual([['parent_id', 'resolved'], ['ticket_id', 'external']]);
  });
  it('rejects a reference to an undeclared column of a registered parent', () => {
    const registry = createPortableContributorRegistry([stub(), stub({ id: 'second', columns: { second_t: ['id', 'ref'] },
      references: [['second_t', 'ref', 'stub_parents', 'nope']] })]);
    expect(() => buildPortableReferenceEdges(registry)).toThrow(PortableContributorError);
  });
});

describe('collecting through the registry', () => {
  it('collects sections with deterministic digests regardless of row order', async () => {
    const a = await collectPortableWorkspace(createPortableContributorRegistry([stub({}, { stub_parents: [{ parent_id: 'p1', name: 'A' }, { parent_id: 'p2', name: 'B' }], stub_children: [] })]), ctx);
    const b = await collectPortableWorkspace(createPortableContributorRegistry([stub({}, { stub_parents: [{ name: 'B', parent_id: 'p2' }, { name: 'A', parent_id: 'p1' }], stub_children: [] })]), ctx);
    expect(a.sections[0].sha256).toBe(b.sections[0].sha256);
    expect(portableCanonicalJson(a.sections[0].records)).toBe(portableCanonicalJson(b.sections[0].records));
  });
  it('refuses contributor output that violates its declaration', async () => {
    for (const records of [
      { stub_parents: [{ parent_id: 'p1' }], stub_children: [] },                     // missing column
      { stub_parents: [], stub_children: [], extra_table: [] },                        // undeclared table
      { stub_parents: [{ parent_id: 'p1', name: 'A', tenant: 'x' }], stub_children: [] }, // undeclared column
    ]) {
      const registry = createPortableContributorRegistry([stub({ export: async () => ({ records: records as any }) })]);
      await expect(collectPortableWorkspace(registry, ctx)).rejects.toBeInstanceOf(PortableContributorError);
    }
  });
  it('fails on a resolved edge whose parent row is missing, but carries external edges as-is', async () => {
    const dangling = { stub_parents: [], stub_children: [{ child_id: 'c1', parent_id: 'gone', ticket_id: 'anything' }] };
    await expect(collectPortableWorkspace(createPortableContributorRegistry([stub({}, dangling)]), ctx)).rejects.toThrow(PortableContributorError);
    await expect(collectPortableWorkspace(createPortableContributorRegistry([stub()]), ctx)).resolves.toBeTruthy();
  });
  it('wraps a throwing validate and disposes leases on failure', async () => {
    let disposed = 0;
    const registry = createPortableContributorRegistry([stub({
      export: async () => ({ records: { stub_parents: [], stub_children: [] }, files: { files: [], dispose: async () => { disposed++; } } }),
      validate: () => { throw new Error('boom'); } })]);
    await expect(collectPortableWorkspace(registry, ctx)).rejects.toBeInstanceOf(PortableContributorError);
    expect(disposed).toBe(1);
  });
  it('detects a changed source on retain by fingerprint', async () => {
    const registry = createPortableContributorRegistry([stub()]);
    const collected = await collectPortableWorkspace(registry, ctx);
    const rctx = { trx: {} as any, actor: ctx.actor, packageId: PACKAGE };
    await expect(assertPortableWorkspaceCurrent(registry, collected, rctx)).resolves.toBeUndefined();
    const changed = createPortableContributorRegistry([stub({}, { stub_parents: [{ parent_id: 'p1', name: 'CHANGED' }], stub_children: [] })]);
    await expect(assertPortableWorkspaceCurrent(changed, collected, rctx)).rejects.toBeInstanceOf(CoManagedSharedWorkError);
  });
});

import { resolveProductApiBehavior, resolveProductRouteBehavior as resolveRoute } from '../../../lib/productSurfaceRegistry';

describe('workspace export product surface', () => {
  it('resolves the page for each product', () => {
    expect(resolveRoute('psa', '/msp/co-management/export')).toBe('allowed');
    expect(resolveRoute('algadesk', '/msp/co-management/export')).toBe('not_found');
    expect(resolveRoute('co_managed', '/msp/co-management/export')).toBe('allowed');
  });
  it('resolves the API route for each product', () => {
    expect(resolveProductApiBehavior('psa', '/api/co-management/export')).toBe('allowed');
    expect(resolveProductApiBehavior('algadesk', '/api/co-management/export')).toBe('denied');
    expect(resolveProductApiBehavior('co_managed', '/api/co-management/export')).toBe('allowed');
  });
  it('does not open the rest of the co-management prefix for a customer', () => {
    expect(resolveRoute('co_managed', '/msp/co-management/tasks')).toBe('not_found');
  });
});
