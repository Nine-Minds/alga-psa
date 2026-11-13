/**
 * T008 (alga-2026-0003211, S14, F010): creating a record for an out-of-scope client is refused.
 *
 * A client-restricted internal user (bundle read rules naming client A only) creates a ticket, contact,
 * interaction, time entry, document association, project and asset. For client C every create is refused and
 * no row is written; for client A every create succeeds. An unrestricted user in the same tenant creates for
 * client C as before. Real DB, real kernel, real bundle resolution; only the session (withAuth), the DB handle
 * and the coarse RBAC grant are stood in for, so the decision under test is the record-level one.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { runWithTenant } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../../test-utils/testDataFactory';
import {
  createAuthorizationBundle,
  createBundleAssignment,
  publishBundleRevision,
  upsertBundleRule,
} from '@alga-psa/authorization/bundles/service';

const ref = vi.hoisted(() => ({ knex: null as Knex | null, tenant: '', user: null as any }));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: ref.knex, tenant: ref.tenant })),
  getConnection: vi.fn(async () => ref.knex),
}));
vi.mock('@alga-psa/db/tenant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db/tenant')>()),
  createTenantKnex: vi.fn(async () => ({ knex: ref.knex, tenant: ref.tenant })),
}));
vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  withAuth: (action: any) => (...args: any[]) => action(ref.user, { tenant: ref.tenant }, ...args),
  hasPermission: vi.fn(async () => true),
  getApiKeyUserOverride: () => null,
  getSession: async () => null,
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
}));

import { addTicket } from '../../../../../packages/tickets/src/actions/ticketActions';
import { addContact } from '../../../../../packages/clients/src/actions/contact-actions/contactActions';
import { addInteraction } from '../../../../../packages/clients/src/actions/interactionActions';
import { saveTimeEntry } from '../../../../../packages/scheduling/src/actions/timeEntryCrudActions';
import { createDocumentAssociations } from '../../../../../packages/documents/src/actions/documentActions';
import { createProject } from '../../../../../packages/projects/src/actions/projectActions';
import { createAsset } from '../../../../../packages/assets/src/actions/assetActions';

/** Refused the way each create path already refuses an RBAC failure (thrown Error or a permission/action result). */
async function refusal(run: () => Promise<unknown>): Promise<string | null> {
  try {
    const value: any = await run();
    if (value && typeof value === 'object') {
      if ('permissionError' in value) return String(value.permissionError);
      if (value.success === false && typeof value.error === 'string') return value.error;
      if ('actionError' in value) return `action:${String(value.actionError)}`;
    }
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
const isPermissionDenied = (message: string | null) => Boolean(message && /Permission denied/i.test(message));

describe('T008: creating a record for an out-of-scope client is refused', () => {
  let db: Knex;
  let tenant: string;
  const mark = uuidv4().slice(0, 8);
  const ids = {
    clientA: uuidv4(), clientC: uuidv4(),
    board: uuidv4(), status: uuidv4(), priority: uuidv4(), projectStatus: uuidv4(),
    ticketA: uuidv4(), ticketC: uuidv4(),
    period: uuidv4(), sheetNarrowed: uuidv4(), sheetUnrestricted: uuidv4(),
    docA: uuidv4(), docB: uuidv4(), service: uuidv4(),
    admin: '', narrowed: '', unrestricted: '',
  };
  let interactionTypeId = '';

  const actAs = (userId: string) => { ref.user = { user_id: userId, user_type: 'internal', tenant, email: `${userId}@example.com` }; };
  const count = async (table: string, where: Record<string, unknown>) =>
    Number((await db(table).where({ tenant }).where(where).count('* as n').first() as any).n);

  beforeAll(async () => {
    db = await createTestDbConnection();
    ref.knex = db;
    tenant = await createTenant(db, `Create scope ${mark}`);
    ref.tenant = tenant;
    ids.admin = await createUser(db, tenant, { first_name: 'Ada', last_name: 'Admin' });
    ids.narrowed = await createUser(db, tenant, { user_type: 'internal', first_name: 'Nora', last_name: 'Narrowed' });
    ids.unrestricted = await createUser(db, tenant, { user_type: 'internal', first_name: 'Uma', last_name: 'Unrestricted' });

    for (const [clientId, name] of [[ids.clientA, 'A'], [ids.clientC, 'C']] as const) {
      await db('clients').insert({ tenant, client_id: clientId, client_name: `Client ${name} ${mark}`, billing_cycle: 'monthly', is_tax_exempt: false });
    }
    await db('boards').insert({ tenant, board_id: ids.board, board_name: 'Support', is_default: true, is_inactive: false });
    await db('priorities').insert({ tenant, priority_id: ids.priority, priority_name: 'High', item_type: 'ticket', color: '#EF4444', order_number: 10, created_by: ids.admin });
    await db('statuses').insert({ tenant, status_id: ids.status, board_id: ids.board, name: 'Open', status_type: 'ticket', is_closed: false, is_default: true, order_number: 10, created_by: ids.admin });
    await db('statuses').insert({ tenant, status_id: ids.projectStatus, name: 'Active', status_type: 'project', is_closed: false, is_default: true, order_number: 10, created_by: ids.admin });
    for (const [label, clientId, ticketId] of [['A', ids.clientA, ids.ticketA], ['C', ids.clientC, ids.ticketC]] as const) {
      await db('tickets').insert({
        tenant, ticket_id: ticketId, ticket_number: `T-${mark}-${label}`, title: `Ticket ${label} ${mark}`,
        client_id: clientId, board_id: ids.board, status_id: ids.status, priority_id: ids.priority, entered_by: ids.admin,
      });
    }

    interactionTypeId = (await db('system_interaction_types').first('type_id')).type_id;
    await db('statuses').insert({ tenant, status_id: uuidv4(), name: 'Logged', status_type: 'interaction', is_closed: false, is_default: true, order_number: 10, created_by: ids.admin });

    // Time entries: one period, one sheet per user, and a billable service.
    await db('time_periods').insert({ tenant, period_id: ids.period, start_date: '2026-01-05', end_date: '2026-01-12' });
    await db('time_sheets').insert({ tenant, id: ids.sheetNarrowed, user_id: ids.narrowed, period_id: ids.period, approval_status: 'DRAFT' });
    await db('time_sheets').insert({ tenant, id: ids.sheetUnrestricted, user_id: ids.unrestricted, period_id: ids.period, approval_status: 'DRAFT' });
    let serviceTypeId = (await db('service_types').where({ tenant }).first('id'))?.id;
    if (!serviceTypeId) {
      serviceTypeId = uuidv4();
      await db('service_types').insert({ id: serviceTypeId, tenant, name: `Svc type ${mark}`, is_active: true });
    }
    await db('service_catalog').insert({ tenant, service_id: ids.service, service_name: `Svc ${mark}`, billing_method: 'hourly', custom_service_type_id: serviceTypeId });

    // Two documents, both on client A, so the narrowed subject may read them.
    for (const documentId of [ids.docA, ids.docB]) {
      await db('documents').insert({ tenant, document_id: documentId, document_name: `Doc ${documentId.slice(0, 6)}`, user_id: ids.admin, created_by: ids.admin, order_number: 0 });
      await db('document_associations').insert({ tenant, association_id: uuidv4(), document_id: documentId, entity_id: ids.clientA, entity_type: 'client' });
    }

    // Narrowed subject: every resource limited to client A.
    const bundle = await createAuthorizationBundle(db, { tenant, name: `client-a-${mark}`, actorUserId: ids.admin });
    for (const resourceType of ['ticket', 'contact', 'interaction', 'time_entry', 'document', 'project', 'asset']) {
      await upsertBundleRule(db, {
        tenant, bundleId: bundle.bundleId, revisionId: bundle.revisionId,
        resourceType, action: 'read', templateKey: 'selected_clients', config: { selectedClientIds: [ids.clientA] }, actorUserId: ids.admin,
      });
    }
    await publishBundleRevision(db as any, { tenant, bundleId: bundle.bundleId, revisionId: bundle.revisionId, actorUserId: ids.admin });
    await createBundleAssignment(db, { tenant, bundleId: bundle.bundleId, targetType: 'user', targetId: ids.narrowed, actorUserId: ids.admin });
  }, 900_000);

  afterAll(async () => {
    if (!db) return;
    try {
      const { rows } = await db.raw(`SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
        WHERE c.table_schema = 'public' AND c.column_name = 'tenant'`);
      let pending: string[] = rows.map((r: any) => r.table_name);
      for (let pass = 0; pass < 12 && pending.length; pass++) {
        const blocked: string[] = [];
        for (const table of pending) {
          try { await db.raw('DELETE FROM ?? WHERE tenant = ?::uuid', [table, tenant]); } catch { blocked.push(table); }
        }
        if (blocked.length === pending.length) break;
        pending = blocked;
      }
    } catch {
      // best-effort cleanup of a disposable tenant
    }
    await db.destroy();
  }, 120_000);

  const run = <T>(fn: () => Promise<T>) => runWithTenant(tenant, fn);

  const ticketForm = (clientId: string, title: string) => {
    const form = new FormData();
    for (const [key, value] of Object.entries({
      title, description: 'created by T008', board_id: ids.board, client_id: clientId,
      status_id: ids.status, priority_id: ids.priority, assigned_to: '',
    })) form.append(key, value);
    return form;
  };

  const entryFor = (userId: string, sheetId: string, ticketId: string, notes: string) => ({
    entry_id: null, work_item_id: ticketId, work_item_type: 'ticket',
    start_time: '2026-01-06T10:00:00Z', end_time: '2026-01-06T11:00:00Z',
    created_at: '2026-01-06T10:00:00Z', updated_at: '2026-01-06T10:00:00Z',
    billable_duration: 60, notes, user_id: userId, approval_status: 'DRAFT',
    service_id: ids.service, time_sheet_id: sheetId,
  }) as any;

  describe('a client-restricted user (client A only)', () => {
    it('is refused a ticket for client C, with no row written, and may create one for client A', async () => {
      actAs(ids.narrowed);
      const refused = await refusal(() => run(() => addTicket(ticketForm(ids.clientC, `denied ticket ${mark}`))));
      expect(isPermissionDenied(refused)).toBe(true);
      expect(await count('tickets', { title: `denied ticket ${mark}` })).toBe(0);

      const created: any = await run(() => addTicket(ticketForm(ids.clientA, `allowed ticket ${mark}`)));
      expect(created?.ticket_id).toBeTruthy();
      expect(await count('tickets', { title: `allowed ticket ${mark}`, client_id: ids.clientA })).toBe(1);
    });

    it('is refused a contact for client C and may create one for client A', async () => {
      actAs(ids.narrowed);
      const refused = await refusal(() => run(() => addContact({ full_name: `Denied ${mark}`, email: `denied-${mark}@example.com`, client_id: ids.clientC } as any)));
      expect(isPermissionDenied(refused)).toBe(true);
      expect(await count('contacts', { email: `denied-${mark}@example.com` })).toBe(0);

      const created: any = await run(() => addContact({ full_name: `Allowed ${mark}`, email: `allowed-${mark}@example.com`, client_id: ids.clientA } as any));
      expect(created?.success).toBe(true);
      expect(await count('contacts', { email: `allowed-${mark}@example.com`, client_id: ids.clientA })).toBe(1);
    });

    it('is refused an interaction for client C and may log one for client A', async () => {
      actAs(ids.narrowed);
      const data = (clientId: string, title: string) => ({ type_id: interactionTypeId, title, user_id: ids.narrowed, client_id: clientId, notes: 'T008' }) as any;
      const refused = await refusal(() => run(() => addInteraction(data(ids.clientC, `denied interaction ${mark}`))));
      expect(isPermissionDenied(refused)).toBe(true);
      expect(await count('interactions', { title: `denied interaction ${mark}` })).toBe(0);

      const created: any = await run(() => addInteraction(data(ids.clientA, `allowed interaction ${mark}`)));
      expect(created?.interaction_id).toBeTruthy();
      expect(await count('interactions', { title: `allowed interaction ${mark}`, client_id: ids.clientA })).toBe(1);
    });

    it('is refused a time entry on client C work and may log time on client A work', async () => {
      actAs(ids.narrowed);
      const refused = await refusal(() => run(() => saveTimeEntry(entryFor(ids.narrowed, ids.sheetNarrowed, ids.ticketC, `denied entry ${mark}`))));
      expect(isPermissionDenied(refused)).toBe(true);
      expect(await count('time_entries', { notes: `denied entry ${mark}` })).toBe(0);

      const saved: any = await run(() => saveTimeEntry(entryFor(ids.narrowed, ids.sheetNarrowed, ids.ticketA, `allowed entry ${mark}`)));
      expect(saved?.entry_id ?? saved?.time_entry?.entry_id).toBeTruthy();
      expect(await count('time_entries', { notes: `allowed entry ${mark}`, work_item_id: ids.ticketA })).toBe(1);
    });

    it('is refused a document association with client C and may associate with client A', async () => {
      actAs(ids.narrowed);
      const refused = await refusal(() => run(() => createDocumentAssociations(ids.clientC, 'client', [ids.docA])));
      expect(isPermissionDenied(refused)).toBe(true);
      expect(await count('document_associations', { entity_id: ids.clientC })).toBe(0);

      const refusedViaTicket = await refusal(() => run(() => createDocumentAssociations(ids.ticketC, 'ticket', [ids.docA])));
      expect(isPermissionDenied(refusedViaTicket)).toBe(true);
      expect(await count('document_associations', { entity_id: ids.ticketC })).toBe(0);

      const created: any = await run(() => createDocumentAssociations(ids.ticketA, 'ticket', [ids.docB]));
      expect(created?.success).toBe(true);
      expect(await count('document_associations', { entity_id: ids.ticketA, document_id: ids.docB })).toBe(1);
    });

    it('is refused a project for client C and may create one for client A', async () => {
      actAs(ids.narrowed);
      const data = (clientId: string, name: string) => ({ project_name: name, client_id: clientId, status: ids.projectStatus, is_inactive: false, description: 'T008', start_date: new Date('2026-01-05'), end_date: new Date('2026-02-05') }) as any;
      const refused = await refusal(() => run(() => createProject(data(ids.clientC, `denied project ${mark}`))));
      expect(isPermissionDenied(refused)).toBe(true);
      expect(await count('projects', { project_name: `denied project ${mark}` })).toBe(0);

      const created: any = await run(() => createProject(data(ids.clientA, `allowed project ${mark}`)));
      expect(created?.project_id).toBeTruthy();
      expect(await count('projects', { project_name: `allowed project ${mark}`, client_id: ids.clientA })).toBe(1);
    });

    it('is refused an asset for client C and may create one for client A', async () => {
      actAs(ids.narrowed);
      const data = (clientId: string, name: string) => ({ asset_type: 'unknown', client_id: clientId, asset_tag: `T008-${name}-${mark}`, name, status: 'active', ownership: 'client' }) as any;
      const refused = await refusal(() => run(() => createAsset(data(ids.clientC, 'denied'))));
      expect(isPermissionDenied(refused)).toBe(true);
      expect(await count('assets', { name: 'denied', client_id: ids.clientC })).toBe(0);

      const created: any = await run(() => createAsset(data(ids.clientA, 'allowed')));
      expect(created?.asset_id).toBeTruthy();
      expect(await count('assets', { name: 'allowed', client_id: ids.clientA })).toBe(1);
    });
  });

  describe('an unrestricted internal user in the same tenant', () => {
    it('still creates for client C', async () => {
      actAs(ids.unrestricted);
      const ticket: any = await run(() => addTicket(ticketForm(ids.clientC, `free ticket ${mark}`)));
      expect(ticket?.ticket_id).toBeTruthy();
      const contact: any = await run(() => addContact({ full_name: `Free ${mark}`, email: `free-${mark}@example.com`, client_id: ids.clientC } as any));
      expect(contact?.success).toBe(true);
      const saved: any = await run(() => saveTimeEntry(entryFor(ids.unrestricted, ids.sheetUnrestricted, ids.ticketC, `free entry ${mark}`)));
      expect(saved).toBeTruthy();
      expect(await count('time_entries', { notes: `free entry ${mark}`, work_item_id: ids.ticketC })).toBe(1);
    });
  });
});
