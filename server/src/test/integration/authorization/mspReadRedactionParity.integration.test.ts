import { randomUUID } from 'crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestContext } from '../../../../test-utils/testContext';
import {
  createAuthorizationBundle,
  createBundleAssignment,
  publishBundleRevision,
  upsertBundleRule,
} from '@alga-psa/authorization/bundles/service';
import { tenantDb } from '@alga-psa/db';
import { insertTestAssets } from '../../../../../shared/test-utils/assetFixtures';
import { projectApiRecord } from '../../../lib/api/controllers/apiRecordProjection';

// T020: with a rule that redacts a field, the MSP ticket, project and asset reads omit that field
// as the REST projection does. Real DB, real kernel, real bundle resolution. Only the session
// (withAuth) and the coarse RBAC check are stubbed, so the bundle rule is the only thing that
// changes between the unrestricted read and the redacted one.

let currentUser: any;

vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  withAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: currentUser.tenant }, ...args),
  getCurrentUser: vi.fn(async () => currentUser),
  hasPermission: vi.fn(async () => true),
  checkPermission: vi.fn(async () => null),
}));
vi.mock('@alga-psa/auth/rbac', async () => ({
  ...(await import('../../../../test-utils/rbacStandIn')).rbacStandIn(vi.fn(async () => true)),
  checkPermission: vi.fn(async () => null),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const helpers = TestContext.createHelpers();
const HOOK_TIMEOUT = 900_000;

describe('T020: MSP reads omit redacted fields like REST', () => {
  let ctx: TestContext;
  const tenantTable = (table: string) => tenantDb(ctx.db, ctx.tenantId).table(table);

  beforeAll(async () => {
    ctx = await helpers.beforeAll({
      cleanupTables: [
        'authorization_bundle_assignments',
        'authorization_bundle_rules',
        'authorization_bundle_revisions',
        'authorization_bundles',
      ],
    });
  }, HOOK_TIMEOUT);
  afterAll(async () => { await helpers.afterAll(); }, HOOK_TIMEOUT);
  beforeEach(async () => {
    ctx = await helpers.beforeEach();
    currentUser = { ...ctx.user, user_type: 'internal', tenant: ctx.tenantId, roles: [] };
  }, HOOK_TIMEOUT);
  afterEach(async () => { await helpers.afterEach(); }, HOOK_TIMEOUT);

  /** A bundle that keeps the test client's records readable and redacts `redactedFields` on reads. */
  async function redactOnRead(resourceType: 'ticket' | 'project' | 'asset', redactedFields: string[]) {
    const created = await createAuthorizationBundle(ctx.db, {
      tenant: ctx.tenantId,
      name: `Bundle-${randomUUID()}`,
      actorUserId: ctx.user.user_id,
    });
    await upsertBundleRule(ctx.db, {
      tenant: ctx.tenantId,
      bundleId: created.bundleId,
      revisionId: created.revisionId,
      resourceType,
      action: 'read',
      templateKey: 'selected_clients',
      config: { selectedClientIds: [ctx.clientId], redactedFields },
      actorUserId: ctx.user.user_id,
    });
    await publishBundleRevision(ctx.db as any, {
      tenant: ctx.tenantId,
      bundleId: created.bundleId,
      revisionId: created.revisionId,
      actorUserId: ctx.user.user_id,
    });
    await createBundleAssignment(ctx.db, {
      tenant: ctx.tenantId,
      bundleId: created.bundleId,
      targetType: 'user',
      targetId: ctx.user.user_id,
      actorUserId: ctx.user.user_id,
    });
  }

  const keys = (record: Record<string, unknown> | null | undefined) => Object.keys(record ?? {}).sort();

  /** The redacted read carries exactly the keys the REST projection leaves on the unrestricted record. */
  function expectRestParity(
    resource: 'ticket' | 'project' | 'asset',
    unrestricted: Record<string, any>,
    redacted: Record<string, any>,
    redactedFields: string[],
    hidden: string[],
  ) {
    for (const field of hidden) {
      expect(unrestricted, `unrestricted ${resource} carries ${field}`).toHaveProperty(field);
      expect(redacted, `redacted ${resource} omits ${field}`).not.toHaveProperty(field);
    }
    const restProjection = projectApiRecord(resource, unrestricted, redactedFields);
    expect(restProjection).not.toBeNull();
    expect(keys(redacted)).toEqual(keys(restProjection));
  }

  it('ticket detail and list reads omit the redacted field', async () => {
    const { getTicketById } = await import('@alga-psa/tickets/actions/ticketActions');
    const { getConsolidatedTicketData, getTicketsForList, loadTicketListItemsByIds } = await import(
      '@alga-psa/tickets/actions/optimizedTicketActions'
    );

    // The list only shows tickets on a board; borrow a seeded ticket's board, status and priority.
    const seeded = await tenantTable('tickets').whereNotNull('board_id').whereNotNull('status_id').first();
    expect(seeded, 'seed data provides a ticket on a board').toBeDefined();
    const ticketId = randomUUID();
    await tenantTable('tickets').insert({
      board_id: seeded.board_id,
      status_id: seeded.status_id,
      priority_id: seeded.priority_id,
      tenant: ctx.tenantId,
      ticket_id: ticketId,
      ticket_number: `TIC-${ticketId.slice(0, 8)}`,
      title: 'Redaction parity fixture',
      client_id: ctx.clientId,
      entered_by: ctx.user.user_id,
      entered_at: new Date(),
    });
    const listFilters = { boardFilterState: 'all', showOpenOnly: false } as any;
    const listRow = async () => {
      const result: any = await getTicketsForList(listFilters, 1, 5000);
      expect(Array.isArray(result?.tickets), JSON.stringify(result)).toBe(true);
      return result.tickets.find((ticket: any) => ticket.ticket_id === ticketId);
    };

    const fullById: any = await getTicketById(ticketId);
    const fullBundle: any = await getConsolidatedTicketData(ticketId);
    const fullRow = await listRow();
    const fullHydrated: any = (await loadTicketListItemsByIds(listFilters, [ticketId]) as any).tickets[0];
    expect(fullById.client_id).toBe(ctx.clientId);
    expect(fullBundle.ticket.client_id).toBe(ctx.clientId);
    expect(fullRow.client_id).toBe(ctx.clientId);

    const redactedFields = ['client_id', 'title'];
    await redactOnRead('ticket', redactedFields);

    const byId: any = await getTicketById(ticketId);
    expectRestParity('ticket', fullById, byId, redactedFields, ['client_id', 'client_name', 'title']);

    const bundle: any = await getConsolidatedTicketData(ticketId);
    expectRestParity('ticket', fullBundle.ticket, bundle.ticket, redactedFields, ['client_id', 'title']);
    // The client record is derived from the hidden client_id.
    expect(bundle.client).toBeNull();

    const row = await listRow();
    expect(row).toBeDefined();
    expectRestParity('ticket', fullRow, row, redactedFields, ['client_id', 'client_name', 'title']);

    const hydrated: any = (await loadTicketListItemsByIds(listFilters, [ticketId]) as any).tickets[0];
    expectRestParity('ticket', fullHydrated, hydrated, redactedFields, ['client_id', 'client_name', 'title']);
  }, HOOK_TIMEOUT);

  it('project detail and list reads omit the redacted field', async () => {
    const { getProject, getProjects } = await import('@alga-psa/projects/actions/projectActions');

    const existingStatus = await tenantTable('statuses').where({ status_type: 'project' }).first();
    const statusId = existingStatus?.status_id ?? (await tenantTable('statuses')
      .insert({
        tenant: ctx.tenantId,
        name: 'Open',
        status_type: 'project',
        order_number: 1,
        created_by: ctx.user.user_id,
        is_closed: false,
        is_default: true,
      })
      .returning('status_id'))[0].status_id;
    const projectId = randomUUID();
    await tenantTable('projects').insert({
      tenant: ctx.tenantId,
      project_id: projectId,
      project_name: 'Redaction parity project',
      description: 'Sensitive description',
      client_id: ctx.clientId,
      status: statusId,
      wbs_code: `RP-${projectId.slice(0, 8)}`,
      project_number: `RP-${projectId.slice(0, 8)}`,
    });
    const listRow = async () => {
      const projects: any = await getProjects();
      expect(Array.isArray(projects), JSON.stringify(projects)).toBe(true);
      return projects.find((project: any) => project.project_id === projectId);
    };

    const fullProject: any = await getProject(projectId);
    const fullRow = await listRow();
    expect(fullProject.description).toBe('Sensitive description');
    expect(fullRow.description).toBe('Sensitive description');

    const redactedFields = ['description'];
    await redactOnRead('project', redactedFields);

    const project: any = await getProject(projectId);
    expectRestParity('project', fullProject, project, redactedFields, ['description']);

    const row = await listRow();
    expect(row).toBeDefined();
    expectRestParity('project', fullRow, row, redactedFields, ['description']);
  }, HOOK_TIMEOUT);

  it('asset detail and list reads omit the redacted field', async () => {
    const { getAsset, listAssets } = await import('@alga-psa/assets/actions/assetActions');

    const assetId = randomUUID();
    await insertTestAssets(ctx.db, {
      tenant: ctx.tenantId,
      asset_id: assetId,
      asset_type: 'unknown',
      client_id: ctx.clientId,
      asset_tag: `RP-${assetId.slice(0, 8)}`,
      name: 'Redaction parity asset',
      serial_number: `S-${assetId.slice(0, 8)}`,
      status: 'active',
    });
    const listRow = async () => {
      const result: any = await listAssets({ page: 1, limit: 50 } as any);
      expect(Array.isArray(result?.assets), JSON.stringify(result)).toBe(true);
      return result.assets.find((asset: any) => asset.asset_id === assetId);
    };

    const fullAsset: any = await getAsset(assetId);
    const fullRow = await listRow();
    expect(fullAsset.serial_number).toBe(`S-${assetId.slice(0, 8)}`);
    expect(fullRow.serial_number).toBe(`S-${assetId.slice(0, 8)}`);

    const redactedFields = ['serial_number'];
    await redactOnRead('asset', redactedFields);

    const asset: any = await getAsset(assetId);
    expectRestParity('asset', fullAsset, asset, redactedFields, ['serial_number']);

    const row = await listRow();
    expect(row).toBeDefined();
    expectRestParity('asset', fullRow, row, redactedFields, ['serial_number']);
  }, HOOK_TIMEOUT);
});
