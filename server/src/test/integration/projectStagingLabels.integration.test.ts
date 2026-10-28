/**
 * alga-2026-0002683 C6 - staging box labels, mixed bulk print and the packing manifest.
 *
 *  - T006 printing is read-only: box labels, a mixed bulk print (box + stock unit + client asset labels)
 *    and a manifest render issue only reads, change no watched table (stock, materials, staging, billing,
 *    documents, time, assets) and publish nothing.
 *  - T010 authorization: a missing box, a deleted box and a box on a project the caller may not read
 *    (record-level bundle narrowing, or no project:read) are the same null / uniform 404.
 *  - T011 labels: mixed items keep their order; the box label shows "Box n of m" and its identifier.
 *
 * Real RBAC, real bundle narrowing, real providers, real template resolution and the real renderers; the
 * only stub is the browser (it receives the real HTML and returns bytes). Fixtures are seeded here.
 */
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { asRequest, buildRealLabelDeps, seedLabelWorld, type LabelWorld } from './labelsFixtures';

const env = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? '/tmp'}/c6-staging-label-storage-${process.pid}`;
  process.env.DB_NAME_SERVER = process.env.TEST_DB_NAME || 'test_database';
  process.env.STORAGE_DEFAULT_PROVIDER = 'local';
  process.env.STORAGE_LOCAL_BASE_PATH = dir;
  return { dir };
});
const rec = vi.hoisted(() => ({
  on: false,
  statements: [] as Array<{ sql: string; instance: number }>,
  instances: 0,
  pages: [] as string[],
}));
const published = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: published, publishWorkflowEvent: published }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('knex', async (importOriginal) => {
  const actual = await importOriginal<{ default: any; knex?: any }>();
  const base = actual.default ?? actual.knex;
  const wrapped: any = (config: unknown) => {
    const instance = base(config);
    const id = ++rec.instances;
    instance.on('query', (q: { sql: string }) => {
      if (rec.on) rec.statements.push({ sql: q.sql, instance: id });
    });
    return instance;
  };
  Object.assign(wrapped, base);
  return { ...actual, default: wrapped, knex: wrapped };
});
vi.mock('../../../../packages/billing/src/services/browserPoolService', () => ({
  browserPoolService: {
    getBrowser: async () => ({
      newPage: async () => ({
        setContent: async (html: string) => {
          rec.pages.push(html);
        },
        pdf: async () => Buffer.from('%PDF-1.4 stub'),
        close: async () => undefined,
      }),
    }),
    releaseBrowser: async () => undefined,
  },
}));

let db: Knex;
let world: LabelWorld;
let staging: {
  projectA: string;
  projectANumber: string;
  projectB: string;
  boxA1: string;
  boxA2: string;
  boxB1: string;
  deletedBox: string;
  unitId: string;
  unitSerial: string;
};

const WATCHED_TABLES = [
  'stock_levels', 'stock_units', 'stock_movements', 'project_materials', 'project_staging_lines',
  'staging_containers', 'staging_container_members', 'invoices', 'invoice_charges', 'time_entries',
  'assets', 'asset_history', 'documents', 'document_associations', 'document_templates',
  'document_template_assignments', 'external_files', 'audit_logs',
];

async function snapshot(): Promise<Record<string, { count: number; maxUpdatedAt: string | null }>> {
  const out: Record<string, { count: number; maxUpdatedAt: string | null }> = {};
  for (const name of WATCHED_TABLES) {
    if (!(await db.schema.hasTable(name))) continue;
    const hasUpdated = await db.schema.hasColumn(name, 'updated_at');
    const row = await db(name)
      .count<{ count: string }[]>('* as count')
      .modify((q) => {
        if (hasUpdated) q.max({ max_updated: 'updated_at' });
      })
      .first();
    out[name] = {
      count: Number((row as { count: string }).count),
      maxUpdatedAt: hasUpdated ? String((row as { max_updated?: unknown }).max_updated ?? '') : null,
    };
  }
  return out;
}

const READ_ONLY = /^\s*(select|with|begin|commit|rollback|savepoint|release|set\s+(local\s+)?(search_path|statement_timeout|app\.))/i;
const SELECT_WITH_EFFECT = /\bfor\s+(no\s+key\s+)?(update|share|key\s+share)\b|\bnextval\s*\(|\bsetval\s*\(|\bpg_notify\s*\(|\bselect\b[^;]*\binto\s+\w/i;

async function grant(roleUserId: string, perms: Array<[string, string]>) {
  const { role_id } = await db('user_roles').where({ tenant: world.tenant, user_id: roleUserId }).first('role_id');
  for (const [resource, action] of perms) {
    const permission_id = randomUUID();
    await db('permissions').insert({ tenant: world.tenant, permission_id, resource, action, msp: true, client: false });
    await db('role_permissions').insert({ tenant: world.tenant, role_id, permission_id });
  }
}

async function seedStaging(): Promise<typeof staging> {
  const tenant = world.tenant;
  await grant(world.tech.user_id, [['project', 'read'], ['project', 'update'], ['inventory', 'read']]);

  // The restricted user's published bundle also narrows project reads to client A.
  const assignment = await db('authorization_bundle_assignments').where({ tenant, target_id: world.restricted.user_id }).first('bundle_id');
  const bundle = await db('authorization_bundles').where({ tenant, bundle_id: assignment.bundle_id }).first('published_revision_id');
  await db('authorization_bundle_rules').insert({
    tenant,
    bundle_id: assignment.bundle_id,
    revision_id: bundle.published_revision_id,
    resource_type: 'project',
    action: 'read',
    template_key: 'selected_clients',
    effect: 'narrow',
    config: JSON.stringify({ selectedClientIds: [world.clientA] }),
    position: 1,
  });

  const status = randomUUID();
  await db('statuses').insert({ tenant, status_id: status, name: 'Active', status_type: 'project', order_number: 1, is_closed: false });
  const project = async (clientId: string, n: string) => {
    const project_id = randomUUID();
    await db('projects').insert({ tenant, project_id, project_name: `Rollout ${n}`, client_id: clientId, status, wbs_code: `c6-${n}`, project_number: `PRJ-${n}` });
    return project_id;
  };
  const projectA = await project(world.clientA, 'A1');
  const projectB = await project(world.clientB, 'B1');

  // A serialized product with one unit in stock.
  const location_id = randomUUID();
  await db('stock_locations').insert({ tenant, location_id, name: 'Main', location_type: 'warehouse', is_default: true, is_active: true });
  const type = randomUUID();
  await db('service_types').insert({ tenant, id: type, name: 'Hardware', is_active: true, order_number: 1 });
  const service_id = randomUUID();
  await db('service_catalog').insert({ tenant, service_id, service_name: 'Managed switch', sku: 'SW-24', item_kind: 'product', billing_method: 'per_unit', default_rate: 10000, is_active: true, custom_service_type_id: type });
  await db('product_inventory_settings').insert({ tenant, service_id, track_stock: true, is_serialized: true, cost_currency: 'USD', default_location_id: location_id });
  const unitSerial = 'SN-SWITCH-0099887766';
  const unitId = randomUUID();
  await db('stock_units').insert({ tenant, unit_id: unitId, service_id, serial_number: unitSerial, status: 'in_stock', location_id, cost_currency: 'USD' });
  await db('stock_levels').insert({ tenant, service_id, location_id, quantity_on_hand: 1, reserved_quantity: 0, held_quantity: 0 });

  const lib = await import('@alga-psa/inventory/lib');
  const [unitLine] = await lib.reserveStagingLines(db, tenant, { project_id: projectA, service_id, quantity: 1, currency_code: 'USD' }, world.tech.user_id);
  const [assetLine, itemLine] = await lib.addClientLines(db, tenant, { project_id: projectA, items: [
    { kind: 'client_asset', asset_id: world.assets.a1 },
    { kind: 'client_item', description: 'Client patch cables', quantity: 12 },
  ] }, world.tech.user_id);
  const boxA1 = (await lib.createContainer(db, tenant, { project_id: projectA, name: 'Rack A' }, world.tech.user_id)).container_id;
  const deletedBox = (await lib.createContainer(db, tenant, { project_id: projectA }, world.tech.user_id)).container_id;
  const boxA2 = (await lib.createContainer(db, tenant, { project_id: projectA }, world.tech.user_id)).container_id;
  await lib.deleteContainer(db, tenant, deletedBox, world.tech.user_id);
  await lib.packLines(db, tenant, boxA1, [
    { staging_line_id: unitLine.staging_line_id },
    { staging_line_id: assetLine.staging_line_id },
    { staging_line_id: itemLine.staging_line_id, quantity: 10 },
  ], world.tech.user_id);
  await lib.sealContainer(db, tenant, boxA1, world.tech.user_id);
  const boxB1 = (await lib.createContainer(db, tenant, { project_id: projectB }, world.tech.user_id)).container_id;
  const projectANumber = 'PRJ-A1';
  return { projectA, projectANumber, projectB, boxA1, boxA2, boxB1, deletedBox, unitId, unitSerial };
}

async function buildDeps() {
  const base = (await buildRealLabelDeps()) as unknown as { providers: Record<string, unknown> };
  const { stockUnitLabelViewModelProvider } = await import('@alga-psa/inventory/lib/labelViewModelProvider');
  const { stagingContainerLabelViewModelProvider } = await import('@alga-psa/projects/lib/stagingLabelViewModelProvider');
  base.providers['stock-unit-identity'] = stockUnitLabelViewModelProvider;
  base.providers['staging-container'] = stagingContainerLabelViewModelProvider;
  return base as never;
}

async function renderManifest(user: LabelWorld['tech'], containerId: string) {
  const { getStagingManifestViewModel } = await import('@alga-psa/projects/lib/stagingManifestViewModelProvider');
  const { renderRegisteredDocumentPdf } = await import('@alga-psa/billing/services');
  return asRequest(world.tenant, async () => {
    const vm = await getStagingManifestViewModel({ tenant: world.tenant, user, baseUrl: 'https://psa.test' }, containerId);
    if (!vm) return null;
    return { vm, ...(await renderRegisteredDocumentPdf(world.tenant, 'staging-manifest', vm as never, { locale: 'en' })) };
  });
}

describe('C6 staging labels and manifests', () => {
  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: true });
    world = await seedLabelWorld(db, env.dir);
    staging = await seedStaging();
  }, 240_000);
  afterAll(async () => {
    await db?.destroy();
    fs.rmSync(env.dir, { recursive: true, force: true });
  });

  it('T006/T011: box labels, a mixed bulk print and a manifest are read-only, in order, and say "Box n of m"', async () => {
    const deps = await buildDeps();
    const { printLabels } = await import('../../lib/labels/printLabels');
    const caller = { user: world.tech, tenant: world.tenant, baseUrl: 'https://psa.test' };

    const before = await snapshot();
    rec.statements.length = 0;
    rec.pages.length = 0;
    rec.on = true;
    let boxes;
    let bulk;
    let manifest;
    try {
      boxes = await asRequest(world.tenant, () =>
        printLabels(deps, caller, { labelClass: 'staging-container', labels: [staging.boxA1, staging.boxA2].map((recordId) => ({ recordId })) })
      );
      bulk = await asRequest(world.tenant, () =>
        printLabels(deps, caller, {
          labels: [
            { labelClass: 'staging-container', recordId: staging.boxA1 },
            { labelClass: 'stock-unit-identity', recordId: staging.unitId },
            { labelClass: 'asset-identity', recordId: world.assets.a1 },
            { labelClass: 'staging-container', recordId: staging.boxA2 },
          ],
        })
      );
      manifest = await renderManifest(world.tech, staging.boxA1);
    } finally {
      rec.on = false;
    }
    const after = await snapshot();

    expect(boxes).toMatchObject({ ok: true, labels: 2, skipped: 0 });
    expect(bulk).toMatchObject({ ok: true, labels: 4, skipped: 0 });
    expect(manifest).not.toBeNull();

    const [boxHtml, bulkHtml, manifestHtml] = rec.pages;
    // Two live boxes (the deleted one does not count): 1 of 2 and 2 of 2, with the box identifier.
    expect(boxHtml).toContain('Box 1 of 2');
    expect(boxHtml).toContain('Box 2 of 2');
    expect(boxHtml).toContain(`${staging.projectANumber}-B01`);
    expect(boxHtml).toContain(`${staging.projectANumber}-B03`);
    // Mixed batch keeps request order: box, unit, asset, box.
    const order = [`${staging.projectANumber}-B01`, staging.unitSerial, 'TAG-A1', `${staging.projectANumber}-B03`].map((s) => bulkHtml.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Manifest: the unit's full serial, the client asset's tag and serial suffix only, the client item.
    expect(manifestHtml).toContain('PACKING MANIFEST');
    expect(manifestHtml).toContain(staging.unitSerial);
    expect(manifestHtml).toContain('TAG-A1');
    expect(manifestHtml).toContain('…5678');
    expect(manifestHtml).not.toContain(world.serials.a1);
    expect(manifestHtml).toContain('Client patch cables');
    expect(manifest!.vm.box.positionDisplay).toBe('1 / 2');
    expect(manifest!.vm.members.map((m) => m.quantity)).toEqual([1, 1, 10]);

    const sqls = rec.statements.map((s) => s.sql);
    expect(sqls.some((s) => /staging_containers/.test(s))).toBe(true);
    expect(sqls.some((s) => /staging_container_members/.test(s))).toBe(true);
    expect(rec.statements.length).toBeGreaterThan(0);
    expect(rec.statements.filter((s) => !READ_ONLY.test(s.sql))).toEqual([]);
    expect(rec.statements.filter((s) => SELECT_WITH_EFFECT.test(s.sql))).toEqual([]);
    expect(after).toEqual(before);
    expect(published).not.toHaveBeenCalled();
  }, 180_000);

  it('T010: missing, deleted, record-level-forbidden and no-permission boxes are indistinguishable', async () => {
    const { stagingContainerLabelViewModelProvider } = await import('@alga-psa/projects/lib/stagingLabelViewModelProvider');
    const { printLabels } = await import('../../lib/labels/printLabels');
    const deps = await buildDeps();
    const missing = '00000000-0000-4000-8000-000000000000';
    const ctx = (user: LabelWorld['tech']) => ({ tenant: world.tenant, user, baseUrl: 'https://psa.test' });

    const asTech = await asRequest(world.tenant, () =>
      stagingContainerLabelViewModelProvider.getLabelViewModels(ctx(world.tech), [staging.boxB1, missing, staging.deletedBox, staging.boxA1])
    );
    expect(asTech.map((vm) => vm?.recordId ?? null)).toEqual([staging.boxB1, null, null, staging.boxA1]);

    // Restricted: narrowed to client A, so project B's box reads exactly like a missing one.
    const asRestricted = await asRequest(world.tenant, () =>
      stagingContainerLabelViewModelProvider.getLabelViewModels(ctx(world.restricted), [staging.boxB1, missing, staging.boxA1])
    );
    expect(asRestricted.map((vm) => vm?.recordId ?? null)).toEqual([null, null, staging.boxA1]);

    for (const [user, id] of [[world.restricted, staging.boxB1], [world.restricted, missing], [world.noPerm, staging.boxA1], [world.tech, staging.deletedBox]] as const) {
      const label = await asRequest(world.tenant, () =>
        printLabels(deps, { user, tenant: world.tenant, baseUrl: 'https://psa.test' }, { labelClass: 'staging-container', labels: [{ recordId: id }] })
      );
      expect(label).toEqual({ ok: false, status: 404, message: 'Not found.' });
      expect(await renderManifest(user, id)).toBeNull();
    }
    expect(await renderManifest(world.restricted, staging.boxA1)).not.toBeNull();
  }, 120_000);
});
