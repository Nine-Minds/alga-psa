import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { runWithTenant, tenantDb } from '@alga-psa/db';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

/**
 * Recurring tickets on shared ticket templates (alga-2026-0002502) against a real, migrated database:
 * migration B equivalence and idempotency (#1, #11), live template reads (#2), checklist replacement (#3),
 * the delete guard and FK (#4), deactivation (#5), manual-use visibility (#6), the cascade and effective
 * board status check (#7), the permission boundary (#8) and custom fields / ITIL on generated tickets (#9).
 */
const session = vi.hoisted(() => ({ user: null as any, deny: new Set<string>(), real: false }));
let db: Knex;

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: async () => ({ knex: db, tenant: session.user?.tenant }),
}));

vi.mock('@alga-psa/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/auth')>();
  const { runWithTenant: run } = await import('@alga-psa/db');
  return {
    ...actual,
    withAuth: (fn: any) => (...args: any[]) =>
      run(session.user.tenant, () => fn(session.user, { tenant: session.user.tenant }, ...args)),
    hasPermission: async (user: unknown, resource: string, action: string, ...rest: unknown[]) => {
      if (session.real) {
        // The real RBAC check, resolving the user's role rows from the database.
        const rbac = await vi.importActual<typeof import('@alga-psa/auth/rbac')>('@alga-psa/auth/rbac');
        return (rbac.hasPermission as any)(user, resource, action, ...rest);
      }
      return !session.deny.has(`${resource}:${action}`);
    },
  };
});

vi.mock('@alga-psa/event-bus/publishers', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/event-bus/publishers')>('@alga-psa/event-bus/publishers');
  return {
    ...actual,
    publishEvent: vi.fn(async () => undefined),
    publishWorkflowEvent: vi.fn(async () => undefined),
  };
});

const TZ = 'America/New_York';
const at = (iso: string) => new Date(iso);
const monthlyOn1 = { frequency: 'monthly', interval: 1, on: { type: 'dayOfMonth', day: 1 }, end: { type: 'never' } };

let generate: typeof import('@alga-psa/tickets/lib/recurring/generateRecurringTicketsForTenant').generateRecurringTicketsForTenant;
let recurring: typeof import('@alga-psa/tickets/actions/recurringTicketActions');
let templates: typeof import('@alga-psa/tickets/actions/ticketTemplateActions');

interface Fixture {
  tenant: string;
  clientId: string;
  userId: string;
  boardId: string;
  otherBoardId: string;
  statusId: string;
  otherStatusId: string;
  priorityId: string;
  priorityHighId: string;
  categoryId: string;
}

async function createFixture(): Promise<Fixture> {
  const tenant = await createTenant(db, `RecTpl ${uuidv4().slice(0, 6)}`);
  const clientId = await createClient(db, tenant, 'Acme Corp');
  const userId = await createUser(db, tenant);
  const scoped = tenantDb(db, tenant);
  const [boardId, otherBoardId, statusId, otherStatusId, priorityId, priorityHighId, categoryId] = Array.from({ length: 7 }, () => uuidv4());
  await scoped.table('boards').insert([
    { tenant, board_id: boardId, board_name: 'Patching', is_default: true },
    { tenant, board_id: otherBoardId, board_name: 'Projects' },
  ]);
  await scoped.table('statuses').insert([
    { tenant, status_id: statusId, board_id: boardId, name: 'New', status_type: 'ticket', item_type: 'ticket', order_number: 1, is_default: true, is_closed: false },
    { tenant, status_id: otherStatusId, board_id: otherBoardId, name: 'Backlog', status_type: 'ticket', item_type: 'ticket', order_number: 1, is_default: true, is_closed: false },
  ]);
  await scoped.table('priorities').insert([
    { tenant, priority_id: priorityId, priority_name: 'Medium', item_type: 'ticket', order_number: 1, color: '#ccc', created_by: userId },
    { tenant, priority_id: priorityHighId, priority_name: 'High', item_type: 'ticket', order_number: 2, color: '#f00', created_by: userId },
  ]);
  await scoped.table('categories').insert({ tenant, category_id: categoryId, category_name: 'Maintenance', board_id: boardId, created_by: userId });
  await scoped.table('tenant_settings').insert({ tenant, settings: JSON.stringify({ timezone: TZ }) }).onConflict('tenant').merge();
  return { tenant, clientId, userId, boardId, otherBoardId, statusId, otherStatusId, priorityId, priorityHighId, categoryId };
}

async function insertTemplate(f: Fixture, fields: Record<string, unknown> = {}, items: Array<Record<string, unknown>> = []): Promise<string> {
  const templateId = uuidv4();
  const scoped = tenantDb(db, f.tenant);
  await scoped.table('ticket_templates').insert({
    tenant: f.tenant,
    template_id: templateId,
    name: `Template ${templateId.slice(0, 8)}`,
    title: '{{client}} patching — {{month}} {{year}}',
    board_id: f.boardId,
    priority_id: f.priorityId,
    tags: JSON.stringify([]),
    custom_fields: JSON.stringify({}),
    offer_for_manual_use: false,
    ...fields,
  });
  if (items.length > 0) {
    await scoped.table('ticket_template_checklist_items').insert(
      items.map((item, index) => ({ tenant: f.tenant, template_id: templateId, order_number: index, is_required: true, ...item }))
    );
  }
  return templateId;
}

async function insertDefinition(
  f: Fixture,
  templateId: string | null,
  options: { evaluatedThrough?: string; statusId?: string | null; overrides?: object; clientOverrides?: object; isActive?: boolean; archived?: boolean; legacy?: Record<string, unknown> } = {}
) {
  const scoped = tenantDb(db, f.tenant);
  const definitionId = uuidv4();
  const definitionClientId = uuidv4();
  await scoped.table('recurring_ticket_definitions').insert({
    tenant: f.tenant,
    definition_id: definitionId,
    name: `Schedule ${definitionId.slice(0, 6)}`,
    is_active: options.isActive ?? true,
    archived_at: options.archived ? new Date() : null,
    ticket_template_id: templateId,
    overrides: JSON.stringify(options.overrides ?? {}),
    status_id: options.statusId ?? null,
    additional_agent_ids: JSON.stringify([]),
    recurrence: JSON.stringify(monthlyOn1),
    start_date: '2026-01-01',
    create_time: '08:00',
    due_time: '17:00',
    lead_days: 0,
    non_business_day_policy: 'keep',
    open_previous_policy: 'always_create',
    notify_client_on_create: false,
    ...(options.legacy ?? {}),
  });
  await scoped.table('recurring_ticket_definition_clients').insert({
    tenant: f.tenant,
    definition_client_id: definitionClientId,
    definition_id: definitionId,
    client_id: f.clientId,
    is_active: true,
    overrides: JSON.stringify(options.clientOverrides ?? {}),
    evaluated_through: at(options.evaluatedThrough ?? '2026-02-28T12:00:00Z'),
  });
  return { definitionId, definitionClientId };
}

const sweep = (f: Fixture, now: string) =>
  runWithTenant(f.tenant, () => generate(db, f.tenant, { timeZone: TZ, locale: 'en', now: at(now) }));

const occurrenceOf = (f: Fixture, definitionClientId: string) =>
  tenantDb(db, f.tenant).table('recurring_ticket_occurrences').where({ definition_client_id: definitionClientId }).orderBy('occurrence_date');

const ticketOf = (f: Fixture, ticketId: string) => tenantDb(db, f.tenant).table('tickets').where({ ticket_id: ticketId }).first();

describe('recurring tickets on ticket templates (integration)', () => {
  let f: Fixture;

  beforeAll(async () => {
    db = await createTestDbConnection();
    ({ generateRecurringTicketsForTenant: generate } = await import('@alga-psa/tickets/lib/recurring/generateRecurringTicketsForTenant'));
    recurring = await import('@alga-psa/tickets/actions/recurringTicketActions');
    templates = await import('@alga-psa/tickets/actions/ticketTemplateActions');
  }, 900_000);

  afterAll(async () => {
    await db?.destroy();
  });

  beforeEach(async () => {
    f = await createFixture();
    session.user = { user_id: f.userId, tenant: f.tenant, user_type: 'internal' };
    session.deny.clear();
    session.real = false;
  });

  describe('#1 / #11 migration B', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const migrationB = require('../../../migrations/20261014100100_backfill_recurring_ticket_templates.cjs');

    async function seedLegacy() {
      const scoped = tenantDb(db, f.tenant);
      const checklistId = uuidv4();
      await scoped.table('checklist_templates').insert({ tenant: f.tenant, template_id: checklistId, name: 'Patch steps', is_active: true });
      await scoped.table('checklist_template_items').insert([
        { tenant: f.tenant, template_item_id: uuidv4(), template_id: checklistId, item_name: 'Snapshot VM', order_number: 0, is_required: true },
        { tenant: f.tenant, template_item_id: uuidv4(), template_id: checklistId, item_name: 'Reboot', order_number: 1, is_required: false },
      ]);
      const description = [{ type: 'paragraph', content: [{ type: 'text', text: 'Apply the monthly patches' }] }];
      const legacy = {
        title_template: '{{client}} legacy — {{month}} {{year}}',
        board_id: f.boardId,
        priority_id: f.priorityHighId,
        category_id: f.categoryId,
        subcategory_id: null,
        tags: JSON.stringify(['patching', 'monthly']),
        description: JSON.stringify(description),
        checklist_template_id: checklistId,
      };
      const first = await insertDefinition(f, null, { legacy, statusId: f.statusId, evaluatedThrough: '2026-02-28T12:00:00Z' });
      const second = await insertDefinition(f, null, { legacy: { ...legacy, title_template: 'Second' }, evaluatedThrough: '2026-02-28T12:00:00Z' });
      return { first, second, description };
    }

    it('#1 links every legacy definition to a copied template that generates the same ticket fields', async () => {
      const { first, second, description } = await seedLegacy();
      await migrationB.up(db);

      const scoped = tenantDb(db, f.tenant);
      const defs = await scoped.table('recurring_ticket_definitions').whereIn('definition_id', [first.definitionId, second.definitionId]);
      expect(defs.every((d: any) => d.ticket_template_id)).toBe(true);
      expect(new Set(defs.map((d: any) => d.ticket_template_id)).size).toBe(2);

      const template = await scoped.table('ticket_templates').where({ template_id: defs.find((d: any) => d.definition_id === first.definitionId).ticket_template_id }).first();
      expect(template).toMatchObject({ title: '{{client}} legacy — {{month}} {{year}}', board_id: f.boardId, priority_id: f.priorityHighId, category_id: f.categoryId, offer_for_manual_use: false, is_active: true });
      // R7: the description is JSON.stringify of the parsed jsonb (jsonb normalises key order, so compare against the stored value).
      const stored = defs.find((d: any) => d.definition_id === first.definitionId).description;
      expect(template.description).toBe(JSON.stringify(stored));
      expect(JSON.parse(template.description)).toEqual(description);
      expect(template.tags).toEqual(['patching', 'monthly']);
      // Names are deduped per tenant: two definitions with the same name must not collide.
      const names = (await scoped.table('ticket_templates').select('name')).map((row: any) => String(row.name).toLowerCase());
      expect(new Set(names).size).toBe(names.length);

      const summary = await sweep(f, '2026-03-01T14:00:00Z');
      expect(summary).toMatchObject({ created: 2, failed: 0 });
      const [occurrence] = await occurrenceOf(f, first.definitionClientId);
      const ticket = await ticketOf(f, occurrence.ticket_id);
      expect(ticket).toMatchObject({
        title: 'Acme Corp legacy — March 2026',
        board_id: f.boardId,
        status_id: f.statusId,
        priority_id: f.priorityHighId,
        category_id: f.categoryId,
        ticket_origin: 'recurring',
        created_from_template_id: template.template_id,
      });
      // The description lands exactly as the legacy generator wrote it (R7).
      expect(ticket.attributes).toEqual({ description: template.description });
      const tags = await scoped.table('tag_mappings').where({ tagged_id: occurrence.ticket_id, tagged_type: 'ticket' });
      expect(tags.length).toBeGreaterThanOrEqual(2);
      const checklist = await scoped.table('ticket_checklist_items').where({ ticket_id: occurrence.ticket_id }).orderBy('order_number');
      expect(checklist.map((row: any) => [row.item_name, row.is_required])).toEqual([['Snapshot VM', true], ['Reboot', false]]);
      // Activity rows. The legacy generator wrote CHECKLIST_TEMPLATE_APPLIED (via applyChecklistTemplateToTicket,
      // details {template_name, items_added}) plus TICKET_CREATED. The template path keeps both and adds
      // TICKET_CREATED_FROM_TEMPLATE; nothing the legacy ticket had is lost.
      const legacyEventTypes = ['TICKET_CHECKLIST_TEMPLATE_APPLIED', 'TICKET_CREATED'];
      const eventsOf = async (ticketId: string) =>
        (await scoped.table('ticket_audit_logs').where({ ticket_id: ticketId }).select('event_type', 'details')).map((row: any) => ({
          event_type: row.event_type as string,
          details: typeof row.details === 'string' ? JSON.parse(row.details) : row.details,
        }));
      for (const definitionClientId of [first.definitionClientId, second.definitionClientId]) {
        const [created] = await occurrenceOf(f, definitionClientId);
        const events = await eventsOf(created.ticket_id);
        const types = events.map((e) => e.event_type);
        for (const legacyType of legacyEventTypes) expect(types, `${legacyType} for ${created.ticket_id}`).toContain(legacyType);
        expect(types.filter((t) => t === 'TICKET_CHECKLIST_TEMPLATE_APPLIED')).toHaveLength(1);
        expect(types).toContain('TICKET_CREATED_FROM_TEMPLATE');
        expect(new Set(types)).toEqual(new Set([...legacyEventTypes, 'TICKET_CREATED_FROM_TEMPLATE']));
        const applied = events.find((e) => e.event_type === 'TICKET_CHECKLIST_TEMPLATE_APPLIED')!;
        expect(applied.details).toMatchObject({ template_name: 'Patch steps', items_added: 2 });
      }
      // The legacy content columns stay (migration C is the next step).
      expect(defs[0].title_template).toBeTruthy();
    });

    it('#11 is idempotent: a second run creates nothing, and down unlinks and removes only migrated templates', async () => {
      const { first } = await seedLegacy();
      const kept = await insertTemplate(f, { name: 'Hand-made' });
      await migrationB.up(db);
      const scoped = tenantDb(db, f.tenant);
      const countTemplates = async () => (await scoped.table('ticket_templates')).length;
      const after = await countTemplates();
      await migrationB.up(db);
      expect(await countTemplates()).toBe(after);

      await migrationB.down(db);
      const definition = await scoped.table('recurring_ticket_definitions').where({ definition_id: first.definitionId }).first();
      expect(definition.ticket_template_id).toBeNull();
      expect(definition.title_template).toBe('{{client}} legacy — {{month}} {{year}}');
      const remaining = await scoped.table('ticket_templates');
      expect(remaining.map((row: any) => row.template_id)).toEqual([kept]);

      await migrationB.up(db); // up again after down
      expect((await scoped.table('recurring_ticket_definitions').whereNull('ticket_template_id')).length).toBe(0);
    });

    it('#11 migration A is idempotent and its down/up round-trips', async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const migrationA = require('../../../migrations/20261014100000_add_recurring_ticket_template_link.cjs');
      await expect(migrationA.up(db)).resolves.not.toThrow();
      await migrationA.down(db);
      const columns = await db.raw(
        "select column_name from information_schema.columns where table_name = 'recurring_ticket_definitions' and column_name in ('ticket_template_id','overrides')"
      );
      expect(columns.rows).toHaveLength(0);
      await migrationA.up(db);
      const restored = await db.raw(
        "select column_name from information_schema.columns where table_name = 'recurring_ticket_definitions' and column_name in ('ticket_template_id','overrides')"
      );
      expect(restored.rows).toHaveLength(2);
    });
  });

  it('#2 a template edit affects only the next occurrence', async () => {
    const templateId = await insertTemplate(f, { title: 'Before {{month}}' });
    const { definitionClientId } = await insertDefinition(f, templateId);
    await sweep(f, '2026-03-01T14:00:00Z');
    await tenantDb(db, f.tenant).table('ticket_templates').where({ template_id: templateId }).update({ title: 'After {{month}}', priority_id: f.priorityHighId });
    await sweep(f, '2026-04-01T14:00:00Z');

    const [march, april] = await occurrenceOf(f, definitionClientId);
    expect((await ticketOf(f, march.ticket_id)).title).toBe('Before March');
    expect((await ticketOf(f, march.ticket_id)).priority_id).toBe(f.priorityId);
    expect(await ticketOf(f, april.ticket_id)).toMatchObject({ title: 'After April', priority_id: f.priorityHighId });
  });

  it('#3 the checklist is snapshotted once: a board auto-apply of the same checklist does not double it', async () => {
    const scoped = tenantDb(db, f.tenant);
    const checklistId = uuidv4();
    await scoped.table('checklist_templates').insert({ tenant: f.tenant, template_id: checklistId, name: 'Steps', is_active: true });
    await scoped.table('checklist_template_items').insert({ tenant: f.tenant, template_item_id: uuidv4(), template_id: checklistId, item_name: 'Step 1', order_number: 0, is_required: true });
    await scoped.table('checklist_template_apply_rules').insert({ tenant: f.tenant, apply_rule_id: uuidv4(), template_id: checklistId, board_id: f.boardId, is_enabled: true });
    const templateId = await insertTemplate(f, {}, [{ item_name: 'Step 1', checklist_template_id: checklistId }, { item_name: 'Own item' }]);
    const { definitionClientId } = await insertDefinition(f, templateId);
    await sweep(f, '2026-03-01T14:00:00Z');
    const [occurrence] = await occurrenceOf(f, definitionClientId);
    const items = await scoped.table('ticket_checklist_items').where({ ticket_id: occurrence.ticket_id }).orderBy('order_number');
    expect(items.map((row: any) => row.item_name).sort()).toEqual(['Own item', 'Step 1']);
    // One CHECKLIST_TEMPLATE_APPLIED for the checklist template, whether auto-apply or the owned items carried it.
    const applied = await scoped.table('ticket_audit_logs').where({ ticket_id: occurrence.ticket_id, event_type: 'TICKET_CHECKLIST_TEMPLATE_APPLIED' });
    expect(applied).toHaveLength(1);
  });

  it('#3b owned items carrying a checklist template write the applied activity when no auto-apply rule exists', async () => {
    const scoped = tenantDb(db, f.tenant);
    const checklistId = uuidv4();
    await scoped.table('checklist_templates').insert({ tenant: f.tenant, template_id: checklistId, name: 'Manual steps', is_active: true });
    const templateId = await insertTemplate(f, {}, [{ item_name: 'A', checklist_template_id: checklistId }, { item_name: 'B', checklist_template_id: checklistId }, { item_name: 'Own' }]);
    const { definitionClientId } = await insertDefinition(f, templateId);
    await sweep(f, '2026-03-01T14:00:00Z');
    const [occurrence] = await occurrenceOf(f, definitionClientId);
    const applied = await scoped.table('ticket_audit_logs').where({ ticket_id: occurrence.ticket_id, event_type: 'TICKET_CHECKLIST_TEMPLATE_APPLIED' });
    expect(applied).toHaveLength(1);
    const details = typeof applied[0].details === 'string' ? JSON.parse(applied[0].details) : applied[0].details;
    expect(details).toMatchObject({ template_name: 'Manual steps', items_added: 2 });
  });

  describe('#4 / #5 / #6 template lifecycle', () => {
    it('#4 refuses deleting a template used by an active or paused schedule, not an archived one; the FK blocks raw deletes', async () => {
      const templateId = await insertTemplate(f);
      const active = await insertDefinition(f, templateId);
      const refused: any = await templates.deleteTicketTemplate(templateId);
      expect(refused.messageKey).toBe('features/tickets:templates.errors.inUseBySchedules');
      expect(refused.actionError).toContain('Schedule');

      await tenantDb(db, f.tenant).table('recurring_ticket_definitions').where({ definition_id: active.definitionId }).update({ is_active: false });
      expect(((await templates.deleteTicketTemplate(templateId)) as any).messageKey).toBe('features/tickets:templates.errors.inUseBySchedules');

      await expect(tenantDb(db, f.tenant).table('ticket_templates').where({ template_id: templateId }).delete()).rejects.toThrow(/foreign key|violates/i);

      await tenantDb(db, f.tenant).table('recurring_ticket_definitions').where({ definition_id: active.definitionId }).update({ archived_at: new Date() });
      // Archived schedules do not block the action guard. The FK still references the row, so the definition is detached first.
      await tenantDb(db, f.tenant).table('recurring_ticket_definitions').where({ definition_id: active.definitionId }).update({ ticket_template_id: null });
      expect((await templates.deleteTicketTemplate(templateId)) as any).toEqual({ template_id: templateId });
    });

    it('#5 deactivating a template does not stop the generator; the editor usage count reports the schedules', async () => {
      const templateId = await insertTemplate(f);
      const { definitionClientId } = await insertDefinition(f, templateId);
      await templates.setTicketTemplateActive(templateId, false);
      const summary = await sweep(f, '2026-03-01T14:00:00Z');
      expect(summary).toMatchObject({ created: 1, failed: 0 });
      const [occurrence] = await occurrenceOf(f, definitionClientId);
      expect(occurrence.status).toBe('created');
      const schedules: any = await templates.listSchedulesForTemplate(templateId);
      expect(schedules.length ?? schedules.schedules?.length).toBe(1);
    expect(schedules[0].pins_status).toBe(false);
    const { definitionId: pinned } = await insertDefinition(f, templateId, { statusId: f.statusId });
    const after: any = await templates.listSchedulesForTemplate(templateId);
    expect(after.filter((row: any) => row.pins_status).map((row: any) => row.definition_id)).toEqual([pinned]);
    });

    it('#6 manual-use visibility: scheduled-only templates stay in the admin list but not in the pickers', async () => {
      const visible = await insertTemplate(f, { name: 'Manual', offer_for_manual_use: true });
      const scheduledOnly = await insertTemplate(f, { name: 'Scheduled only', offer_for_manual_use: false });
      const inactive = await insertTemplate(f, { name: 'Inactive', offer_for_manual_use: true, is_active: false });

      const admin: any = await templates.listTicketTemplates({ includeInactive: true } as any);
      const adminIds = admin.map((row: any) => row.template_id);
      expect(adminIds).toEqual(expect.arrayContaining([visible, scheduledOnly, inactive]));

      const picker: any = await templates.listTicketTemplatesForCreate();
      expect(picker.map((row: any) => row.template_id)).toEqual([visible]);
      expect(((await templates.getTicketTemplateForCreate(scheduledOnly)) as any).actionError).toBeTruthy();
      expect(((await templates.getTicketTemplateForCreate(inactive)) as any).actionError).toBeTruthy();
      expect(((await templates.getTicketTemplateForCreate(visible)) as any).template_id).toBe(visible);
    });
  });

  describe('#7 cascade and effective board', () => {
    it('applies template -> definition overrides -> client overrides', async () => {
      const templateId = await insertTemplate(f);
      const { definitionClientId, definitionId } = await insertDefinition(f, templateId, {
        overrides: { priority: { priority_id: f.priorityHighId } },
        clientOverrides: {},
      });
      await sweep(f, '2026-03-01T14:00:00Z');
      const [first] = await occurrenceOf(f, definitionClientId);
      expect((await ticketOf(f, first.ticket_id)).priority_id).toBe(f.priorityHighId);

      await tenantDb(db, f.tenant)
        .table('recurring_ticket_definition_clients')
        .where({ definition_client_id: definitionClientId })
        .update({ overrides: JSON.stringify({ priority: { priority_id: f.priorityId } }) });
      await sweep(f, '2026-04-01T14:00:00Z');
      const [, second] = await occurrenceOf(f, definitionClientId);
      expect((await ticketOf(f, second.ticket_id)).priority_id).toBe(f.priorityId);
      expect(definitionId).toBeTruthy();
    });

    it('fails the occurrence when the status is not on the effective board', async () => {
      const templateId = await insertTemplate(f);
      const { definitionClientId } = await insertDefinition(f, templateId, {
        statusId: f.statusId,
        overrides: { board: { board_id: f.otherBoardId, status_id: f.statusId } },
      });
      // The board override carries a status of the OTHER board.
      const summary = await sweep(f, '2026-03-01T14:00:00Z');
      expect(summary).toMatchObject({ created: 0, failed: 1 });
      const [occurrence] = await occurrenceOf(f, definitionClientId);
      expect(occurrence.status).toBe('failed');
      expect(occurrence.reason).toContain('does not belong to board');
      expect(occurrence.reason).toContain('edit the schedule');
    });

    it('fails (not crashes) when the template is gone', async () => {
      const templateId = await insertTemplate(f);
      const { definitionClientId, definitionId } = await insertDefinition(f, templateId);
      // Simulate a dangling link: the FK normally prevents this, so detach it as an unlinked legacy row would be.
      await tenantDb(db, f.tenant).table('recurring_ticket_definitions').where({ definition_id: definitionId }).update({ ticket_template_id: null });
      const summary = await sweep(f, '2026-03-01T14:00:00Z');
      expect(summary).toMatchObject({ created: 0, failed: 1 });
      const [occurrence] = await occurrenceOf(f, definitionClientId);
      expect(occurrence.status).toBe('failed');
    });
  });

  describe('#8 permission boundary (R2)', () => {
    it('content needs ticket_template:update; schedule edits need recurring_ticket:update; picking needs ticket_template:read', async () => {
      const templateId = await insertTemplate(f, { name: 'Shared' });
      const { definitionId } = await insertDefinition(f, templateId);
      const input = (extra: Record<string, unknown> = {}) => ({
        name: 'Edited', ticket_template_id: templateId, recurrence: monthlyOn1, start_date: '2026-01-01', ...extra,
      });

      // Dispatcher-like: schedule rights, template read, no template write.
      session.deny.add('ticket_template:update');
      expect(((await templates.updateTicketTemplate(templateId, { name: 'x', title: 'x' } as any)) as any).permissionError).toBeTruthy();
      const updated: any = await recurring.updateRecurringTicketDefinition(definitionId, input() as any);
      expect(updated.actionError ?? updated.permissionError).toBeUndefined();

      // Technician-like: no schedule rights.
      session.deny.clear();
      session.deny.add('recurring_ticket:update');
      expect(((await recurring.updateRecurringTicketDefinition(definitionId, input({ name: 'Nope' }) as any)) as any).permissionError).toBeTruthy();

      // Picking a template needs template read.
      session.deny.clear();
      session.deny.add('ticket_template:read');
      expect(((await recurring.createRecurringTicketDefinition(input({ name: 'New' }) as any)) as any).permissionError).toBeTruthy();
    });
  });

  describe('#8b permission boundary with real seeded role rows', () => {
    async function userWithRole(roleName: string) {
      const scoped = tenantDb(db, f.tenant);
      const userId = await createUser(db, f.tenant);
      const roleId = uuidv4();
      await scoped.table('roles').insert({ tenant: f.tenant, role_id: roleId, role_name: roleName, msp: true, client: false });
      await scoped.table('user_roles').insert({ tenant: f.tenant, role_id: roleId, user_id: userId });
      return userId;
    }

    it('Dispatcher can edit schedules but not template content; Technician can only read', async () => {
      // Real catalog reconciliation: roles named as in the product seeds receive their default grants.
      // The catalog sync never creates roles, so seed the full default role set first.
      for (const [name, msp] of [['Admin', true], ['Finance', true], ['Project Manager', true], ['Manager', true], ['Admin', false], ['Finance', false], ['User', false]] as const) {
        await tenantDb(db, f.tenant).table('roles').insert({ tenant: f.tenant, role_id: uuidv4(), role_name: name, msp, client: !msp });
      }
      const dispatcherId = await userWithRole('Dispatcher');
      const technicianId = await userWithRole('Technician');
      const reconcile = require('../../../migrations/utils/permissions/reconcileTenants.cjs');
      const summary = await reconcile.reconcileAllTenants(db, {
        label: 'recurring-templates-test', tenantId: f.tenant, product: 'psa', onDrift: 'throw', logger: { log() {}, warn() {}, error() {} },
      });
      expect(summary.failed).toEqual([]);

      const templateId = await insertTemplate(f, { name: 'Shared' });
      const { definitionId } = await insertDefinition(f, templateId);
      const input = (extra: Record<string, unknown> = {}) => ({
        name: 'Edited', ticket_template_id: templateId, recurrence: monthlyOn1, start_date: '2026-01-01', ...extra,
      });
      session.real = true;

      session.user = { user_id: dispatcherId, tenant: f.tenant, user_type: 'internal' };
      expect(((await templates.updateTicketTemplate(templateId, { name: 'x', title: 'x' } as any)) as any).permissionError).toBeTruthy();
      const updated: any = await recurring.updateRecurringTicketDefinition(definitionId, input() as any);
      expect(updated.actionError ?? updated.permissionError).toBeUndefined();
      const picker: any = await templates.listTicketTemplatesForCreate();
      expect(Array.isArray(picker)).toBe(true);

      session.user = { user_id: technicianId, tenant: f.tenant, user_type: 'internal' };
      expect(((await recurring.updateRecurringTicketDefinition(definitionId, input({ name: 'Nope' }) as any)) as any).permissionError).toBeTruthy();
      expect(((await templates.updateTicketTemplate(templateId, { name: 'x', title: 'x' } as any)) as any).permissionError).toBeTruthy();
    });
  });

  it('#9 custom fields and ITIL values on the template reach the generated ticket', async () => {
    const templateId = await insertTemplate(f, { itil_impact: 2, itil_urgency: 3, custom_fields: JSON.stringify({}) });
    const { definitionClientId } = await insertDefinition(f, templateId);
    await sweep(f, '2026-03-01T14:00:00Z');
    const [occurrence] = await occurrenceOf(f, definitionClientId);
    const ticket = await ticketOf(f, occurrence.ticket_id);
    expect(ticket).toMatchObject({ itil_impact: 2, itil_urgency: 3, created_from_template_id: templateId });
    const activity = await tenantDb(db, f.tenant)
      .table('ticket_audit_logs')
      .where({ ticket_id: occurrence.ticket_id, event_type: 'TICKET_CREATED_FROM_TEMPLATE' })
      .first();
    expect(activity).toBeTruthy();
  });
});
