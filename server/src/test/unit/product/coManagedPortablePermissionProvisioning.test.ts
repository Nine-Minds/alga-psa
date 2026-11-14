import { beforeEach, describe, expect, it, vi } from 'vitest';

// The tenant's permission catalog and the actor's grants, as a co_managed workspace has them:
// core/ticket permissions are provisioned; asset, project and workflow rows do not exist (the catalog scopes them to psa).
const state = vi.hoisted(() => ({ provisioned: new Set<string>(), held: new Set<string>() }));
vi.mock('../../../../../packages/co-managed/src/localPermission', () => ({
  isCoManagedPermissionProvisioned: async (_db: unknown, _tenant: string, resource: string, action: string) => state.provisioned.has(`${resource}.${action}`),
  hasCoManagedLocalPermission: async (_db: unknown, _actor: unknown, resource: string, action: string) => state.held.has(`${resource}.${action}`),
}));

import { createPortableContributorRegistry, type PortableContributor } from '../../../../../packages/co-managed/src/portableContributorRegistry';
import { CORE_PORTABLE_CONTRIBUTORS } from '../../../../../packages/co-managed/src/portableCoreRegistry';
import { assertPortableWorkspaceCurrent, collectPortableWorkspace } from '../../../../../packages/co-managed/src/portableWorkspaceGraph';
import { buildCoManagedPortableWorkspaceManifest, validateCoManagedPortableWorkspaceManifest } from '../../../../../packages/co-managed/src/portableWorkspaceManifest';
import { CoManagedSharedWorkError } from '../../../../../packages/co-managed/src/sharedWorkIdentity';
import { hasCoManagedLocalPermission } from '../../../../../packages/co-managed/src/localPermission';

const TENANT = '11111111-1111-4111-8111-111111111111', PACKAGE = '22222222-2222-4222-8222-222222222222';
const context = { packageId: PACKAGE, sourceTenant: TENANT, capturedAt: '2026-01-01T00:00:00.000Z' };
const actor = { kind: 'session', tenant: TENANT, userId: 'u', sessionId: 's' } as any;
const ctx = { db: {} as any, actor, packageId: PACKAGE, snapshot: { capturedAt: context.capturedAt } };

const calls: string[] = [];
const empty = (c: PortableContributor) => ({ records: Object.fromEntries(Object.keys(c.columns).map(t => [t, []])) });

/**
 * The REAL contributors' column, reference and permission declarations; only the database read is replaced. Each
 * replacement performs the same permission checks the real exporters do for the scopes the engine did not drop.
 */
// This file pins the L7b1 engine set; the L7b3 domains have their own provisioning cases (integration + coManagedPortableL7b3Provisioning).
const L7B1_IDS = ['core', 'work', 'assets', 'workflows', 'files'];
const L7B1_CONTRIBUTORS = CORE_PORTABLE_CONTRIBUTORS.filter(c => L7B1_IDS.includes(c.id));
const contributors = L7B1_CONTRIBUTORS.map((real): PortableContributor => {
  const run = async (id: string, notProvisioned?: ReadonlySet<string>) => {
    calls.push(id);
    for (const p of real.permissions ?? []) {
      if (p.tables?.every(t => notProvisioned?.has(t))) continue;
      if (!await hasCoManagedLocalPermission({} as any, actor, p.resource, p.action)) throw new CoManagedSharedWorkError();
    }
    return empty(real);
  };
  return { ...real, export: ctx => run(real.id, ctx.notProvisioned), retain: ctx => run(`retain:${real.id}`, ctx.notProvisioned), validate: () => {} };
});
const registry = () => createPortableContributorRegistry(contributors);

const coManagedProvisioned = ['ticket.read', 'ticket_settings.read', 'co_management.manage', 'user.read'];

beforeEach(() => {
  calls.length = 0;
  state.provisioned = new Set(coManagedProvisioned);
  state.held = new Set(coManagedProvisioned);
});

describe('portable export in a co_managed-shaped permission set', () => {
  it('declares the permissions each domain needs, so the engine never names a domain', () => {
    const declared = Object.fromEntries(L7B1_CONTRIBUTORS.map(c => [c.id, (c.permissions ?? []).map(p => `${p.resource}.${p.action}${p.tables ? '*' : ''}`)]));
    expect(declared).toEqual({ core: [], work: ['ticket.read', 'ticket_settings.read', 'project.read*'], assets: ['asset.read'], workflows: ['workflow.admin', 'workflow.read'], files: ['co_management.manage'] });
  });

  it('(a) completes, and (b) names an exclusion for each domain whose permission is not provisioned', async () => {
    const reg = registry();
    const collected = await collectPortableWorkspace(reg, ctx);
    expect(collected.sections.map(s => s.id).sort()).toEqual(['assets', 'core', 'files', 'work', 'workflows']);
    // Unprovisioned domains are not called at all; the partly provisioned one is, with its project scope declared empty.
    expect(calls.sort()).toEqual(['core', 'files', 'work']);
    const manifest = buildCoManagedPortableWorkspaceManifest({ context, collected, registry: reg });
    const missing = manifest.exclusions.filter(e => e.class === 'not_provisioned').map(e => e.name).sort();
    expect(missing).toEqual(['domain:assets', 'domain:work:project', 'domain:workflows']);
    expect(manifest.exclusions.every(e => e.reason.length > 0)).toBe(true);
    for (const id of ['assets', 'workflows']) expect(Object.values(manifest.sections.find(s => s.id === id)!.records).flat()).toEqual([]);
    // The archive passes its own manifest validation after a JSON round trip.
    expect(() => validateCoManagedPortableWorkspaceManifest(JSON.parse(JSON.stringify(manifest)), context, [], reg)).not.toThrow();
  });

  it('files are exported (and no files exclusion is named) when the export-admin permission is provisioned, and excluded when it is not', async () => {
    let reg = registry(), collected = await collectPortableWorkspace(reg, ctx);
    expect(calls).toContain('files');
    expect(buildCoManagedPortableWorkspaceManifest({ context, collected, registry: reg }).exclusions.map(e => e.name)).not.toContain('domain:files');
    calls.length = 0; state.provisioned.delete('co_management.manage');
    reg = registry(); collected = await collectPortableWorkspace(reg, ctx);
    expect(calls).not.toContain('files');
    expect(collected.files).toEqual([]);
    expect(buildCoManagedPortableWorkspaceManifest({ context, collected, registry: reg }).exclusions).toContainEqual(expect.objectContaining({ class: 'not_provisioned', name: 'domain:files' }));
  });

  it('retain agrees with export: the final current-source check does not flag an exclusion as changed', async () => {
    const reg = registry();
    const collected = await collectPortableWorkspace(reg, ctx);
    await expect(assertPortableWorkspaceCurrent(reg, collected, { trx: {} as any, actor, packageId: PACKAGE })).resolves.toBeUndefined();
    // If a permission becomes provisioned between export and retain, the source did change.
    state.provisioned.add('asset.read'); state.held.add('asset.read');
    await expect(assertPortableWorkspaceCurrent(reg, collected, { trx: {} as any, actor, packageId: PACKAGE })).rejects.toBeInstanceOf(CoManagedSharedWorkError);
  });

  it('(c) still throws when the permission row exists but the user lacks it', async () => {
    for (const denied of ['asset.read', 'workflow.admin', 'ticket.read']) {
      state.provisioned = new Set([...coManagedProvisioned, 'asset.read', 'workflow.admin', 'workflow.read', 'project.read']);
      state.held = new Set(state.provisioned); state.held.delete(denied);
      await expect(collectPortableWorkspace(registry(), ctx)).rejects.toBeInstanceOf(CoManagedSharedWorkError);
    }
  });

  it('a fully provisioned, fully granted workspace records no not_provisioned exclusion', async () => {
    state.provisioned = new Set([...coManagedProvisioned, 'asset.read', 'workflow.admin', 'workflow.read', 'project.read']);
    state.held = new Set(state.provisioned);
    const reg = registry(), collected = await collectPortableWorkspace(reg, ctx);
    expect(calls.sort()).toEqual(['assets', 'core', 'files', 'work', 'workflows']);
    expect(buildCoManagedPortableWorkspaceManifest({ context, collected, registry: reg }).exclusions.some(e => e.class === 'not_provisioned')).toBe(false);
  });

  it('refuses a contributor that returns rows for a table the engine declared not provisioned', async () => {
    const work = contributors.find(c => c.id === 'work')!;
    const rogue = { ...work, export: async () => ({ records: { ...empty(work).records, projects: [Object.fromEntries(work.columns.projects.map(c => [c, null]))] } }) };
    const reg = createPortableContributorRegistry(contributors.map(c => c.id === 'work' ? rogue : c));
    await expect(collectPortableWorkspace(reg, ctx)).rejects.toThrow(/must be empty/);
  });
});
