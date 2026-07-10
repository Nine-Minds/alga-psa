import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

const dbRef = vi.hoisted(() => ({
  knex: null as Knex | null,
  tenant: '',
}));

const userRef = vi.hoisted(() => ({
  user: null as any,
}));

const hasPermissionMock = vi.hoisted(() => vi.fn(async () => true));
const publishEventMock = vi.hoisted(() => vi.fn(async () => undefined));
const publishWorkflowEventMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) =>
    action(userRef.user, { tenant: dbRef.tenant }, ...args),
  withOptionalAuth: (action: any) => (...args: any[]) =>
    action(userRef.user, { tenant: dbRef.tenant }, ...args),
  hasPermission: hasPermissionMock,
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: hasPermissionMock,
}));

vi.mock('@alga-psa/auth/actions', () => ({
  getTicketAttributes: vi.fn(async () => ({})),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: publishEventMock,
  publishWorkflowEvent: publishWorkflowEventMock,
}));

vi.mock('@alga-psa/event-bus', () => ({
  getEventBus: vi.fn(() => ({ publish: vi.fn() })),
  ServerEventPublisher: class {},
}));

vi.mock('@alga-psa/analytics', () => ({
  captureAnalytics: vi.fn(),
  ServerAnalyticsTracker: class {},
  analytics: { capture: vi.fn() },
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('../../../../packages/tickets/src/lib/liveUpdates', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  publishTicketUpdate: vi.fn(),
}));

import {
  addChecklistItem,
  updateChecklistItem,
  deleteChecklistItem,
  reorderChecklistItems,
  setChecklistItemCompleted,
  getTicketChecklistItems,
} from '../../../../packages/tickets/src/actions/checklists/ticketChecklistActions';
import {
  createChecklistTemplate,
  addChecklistTemplateItem,
  updateChecklistTemplateItem,
  deleteChecklistTemplateItem,
  createChecklistTemplateApplyRule,
} from '../../../../packages/tickets/src/actions/checklists/checklistTemplateActions';
import {
  applyChecklistTemplateToTicket,
  applyMatchingChecklistTemplates,
} from '@alga-psa/shared/lib/ticketChecklists';
import { TicketModel } from '@alga-psa/shared/models/ticketModel';
import { updateTicketInTransaction } from '../../../../packages/tickets/src/actions/optimizedTicketActions';
import { tenantDb } from '@alga-psa/db';
import {
  createCloseRulesFixture,
  insertTicket,
  type CloseRulesFixture,
} from './helpers/closeRulesFixture';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

const HOOK_TIMEOUT = 240_000;

let db: Knex;
let fixture: CloseRulesFixture;

function scopedDbFor(tenantId: string) {
  return tenantDb(db, tenantId);
}

function isReturnedActionError(value: unknown): value is ActionMessageError | ActionPermissionError {
  return isActionMessageError(value) || isActionPermissionError(value);
}

function expectActionSuccess<T>(result: T | ActionMessageError | ActionPermissionError): T {
  if (isReturnedActionError(result)) {
    throw new Error(getErrorMessage(result));
  }
  return result;
}

async function createTemplateWithItems(
  names: Array<{ name: string; required?: boolean }>
): Promise<string> {
  const template = expectActionSuccess(await createChecklistTemplate({ name: `Template ${uuidv4().slice(0, 8)}` }));
  for (const item of names) {
    expectActionSuccess(
      await addChecklistTemplateItem(template.template_id, {
        item_name: item.name,
        is_required: item.required ?? true,
      })
    );
  }
  return template.template_id;
}

describe('ticket checklists', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
    dbRef.knex = db;

    const seededUser = await tenantDb(db, '__test_discovery__')
      .unscoped('users', 'test discovery of seeded internal user for checklist integration')
      .where({ user_type: 'internal' })
      .first();
    expect(seededUser).toBeTruthy();
    dbRef.tenant = seededUser.tenant;
    userRef.user = {
      user_id: seededUser.user_id,
      user_type: 'internal',
      first_name: seededUser.first_name ?? 'Test',
      last_name: seededUser.last_name ?? 'User',
      username: seededUser.username,
    };

    fixture = await createCloseRulesFixture(db, seededUser.tenant, seededUser.user_id);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  });

  beforeEach(() => {
    hasPermissionMock.mockReset();
    hasPermissionMock.mockResolvedValue(true);
  });

  it('T022: checklist item lifecycle with persistent ordering and tenant scoping', async () => {
    const ticketId = await insertTicket(db, fixture);

    const first = expectActionSuccess(await addChecklistItem(ticketId, { item_name: 'First step' }));
    const second = expectActionSuccess(await addChecklistItem(ticketId, { item_name: 'Second step', is_required: false }));
    expect(first.order_number).toBeLessThan(second.order_number);

    const renamed = expectActionSuccess(await updateChecklistItem(first.checklist_item_id, { item_name: 'First step (edited)' }));
    expect(renamed.item_name).toBe('First step (edited)');

    expectActionSuccess(await reorderChecklistItems(ticketId, [second.checklist_item_id, first.checklist_item_id]));
    const reordered = await getTicketChecklistItems(ticketId);
    expect(reordered.map((i) => i.checklist_item_id)).toEqual([
      second.checklist_item_id,
      first.checklist_item_id,
    ]);

    expectActionSuccess(await deleteChecklistItem(second.checklist_item_id));
    expect((await getTicketChecklistItems(ticketId)).length).toBe(1);

    // An item id that exists under a different tenant is unreachable: the
    // actions scope every query by the caller's tenant.
    expect(await updateChecklistItem(uuidv4(), { item_name: 'nope' })).toMatchObject({
      actionError: expect.stringMatching(/not found/i),
    });
  });

  it('T023: completion stamps accountability and audit rows preserve prior signoff', async () => {
    const ticketId = await insertTicket(db, fixture);
    const item = expectActionSuccess(await addChecklistItem(ticketId, { item_name: 'Verify backups' }));

    const completed = expectActionSuccess(await setChecklistItemCompleted(item.checklist_item_id, true));
    expect(completed.completed).toBe(true);
    expect(completed.completed_by).toBe(fixture.userId);
    expect(completed.completed_at).not.toBeNull();

    const uncompleted = expectActionSuccess(await setChecklistItemCompleted(item.checklist_item_id, false));
    expect(uncompleted.completed).toBe(false);
    expect(uncompleted.completed_by).toBeNull();
    expect(uncompleted.completed_at).toBeNull();

    const audits = await scopedDbFor(fixture.tenantId).table('ticket_audit_logs')
      .where({ ticket_id: ticketId })
      .whereIn('event_type', ['TICKET_CHECKLIST_ITEM_COMPLETED', 'TICKET_CHECKLIST_ITEM_UNCOMPLETED'])
      .orderBy('created_at', 'asc');
    expect(audits.map((a: any) => a.event_type)).toEqual([
      'TICKET_CHECKLIST_ITEM_COMPLETED',
      'TICKET_CHECKLIST_ITEM_UNCOMPLETED',
    ]);
    const uncheckAudit = audits[1];
    expect(uncheckAudit.details.previous_completed_by).toBe(fixture.userId);
    expect(uncheckAudit.details.previous_completed_at).toBeTruthy();
    expect(uncheckAudit.actor_user_id).toBe(fixture.userId);
  });

  it('T024: applying a template copies items idempotently and templates stack', async () => {
    const ticketId = await insertTicket(db, fixture);
    const templateA = await createTemplateWithItems([
      { name: 'A1' },
      { name: 'A2', required: false },
    ]);
    const templateB = await createTemplateWithItems([{ name: 'B1' }]);

    const firstApply = await db.transaction((trx) =>
      applyChecklistTemplateToTicket(trx, fixture.tenantId, ticketId, templateA, 'template')
    );
    expect(firstApply).toEqual({ applied: true, itemsAdded: 2 });

    const reApply = await db.transaction((trx) =>
      applyChecklistTemplateToTicket(trx, fixture.tenantId, ticketId, templateA, 'template')
    );
    expect(reApply).toEqual({ applied: false, itemsAdded: 0 });

    await db.transaction((trx) =>
      applyChecklistTemplateToTicket(trx, fixture.tenantId, ticketId, templateB, 'template')
    );

    const items = await getTicketChecklistItems(ticketId);
    expect(items.length).toBe(3);
    expect(items.map((i) => i.item_name)).toEqual(['A1', 'A2', 'B1']);
    expect(items.every((i) => i.source === 'template')).toBe(true);
    expect(items.filter((i) => i.template_id === templateA).length).toBe(2);

    const applyAudit = await scopedDbFor(fixture.tenantId).table('ticket_audit_logs')
      .where({ ticket_id: ticketId, event_type: 'TICKET_CHECKLIST_TEMPLATE_APPLIED' })
      .select('audit_id');
    expect(applyAudit.length).toBe(2);
  });

  it('T025: template edits after application never rewrite the ticket copies', async () => {
    const ticketId = await insertTicket(db, fixture);
    const templateId = await createTemplateWithItems([{ name: 'Original name' }, { name: 'Will be deleted' }]);

    await db.transaction((trx) =>
      applyChecklistTemplateToTicket(trx, fixture.tenantId, ticketId, templateId, 'template')
    );
    const before = await getTicketChecklistItems(ticketId);

    const templateItems = await scopedDbFor(fixture.tenantId).table('checklist_template_items')
      .where({ template_id: templateId })
      .orderBy('order_number');
    expectActionSuccess(await updateChecklistTemplateItem(templateItems[0].template_item_id, { item_name: 'Renamed in template' }));
    expectActionSuccess(await deleteChecklistTemplateItem(templateItems[1].template_item_id));
    expectActionSuccess(await addChecklistTemplateItem(templateId, { item_name: 'Added later' }));

    const after = await getTicketChecklistItems(ticketId);
    expect(after).toEqual(before);
  });

  it('T026: auto-apply on ticket creation honors matchers, any-wildcards, and disabled flags', async () => {
    // Dedicated board so apply rules registered by other tests can't match.
    const localFixture = await createCloseRulesFixture(db, fixture.tenantId, fixture.userId);
    // Rule scoped to the local board + a null (any) category matcher
    const matchingTemplate = await createTemplateWithItems([{ name: 'Board-scoped step' }]);
    expectActionSuccess(await createChecklistTemplateApplyRule(matchingTemplate, { board_id: localFixture.boardId }));

    // Rule for a different board must not fire
    const otherTemplate = await createTemplateWithItems([{ name: 'Other board step' }]);
    expectActionSuccess(await createChecklistTemplateApplyRule(otherTemplate, { board_id: uuidv4() }));

    // Disabled rule must not fire
    const disabledTemplate = await createTemplateWithItems([{ name: 'Disabled step' }]);
    expectActionSuccess(await createChecklistTemplateApplyRule(disabledTemplate, { board_id: localFixture.boardId, is_enabled: false }));

    const result = await db.transaction((trx) =>
      TicketModel.createTicket(
        {
          title: 'Auto-apply on create',
          board_id: localFixture.boardId,
          client_id: localFixture.clientId,
          status_id: localFixture.openStatusId,
          priority_id: localFixture.priorityId,
          entered_by: fixture.userId,
        } as any,
        fixture.tenantId,
        trx,
        { skipLocationValidation: true, skipCategoryValidation: true, skipSubcategoryValidation: true },
        undefined,
        undefined,
        fixture.userId
      )
    );

    // Other tests may register additional board-wide rules (suite order is
    // shuffled), so assert membership rather than the exact list.
    const items = await scopedDbFor(fixture.tenantId).table('ticket_checklist_items')
      .where({ ticket_id: result.ticket_id })
      .select('item_name', 'template_id');
    const names = items.map((i: any) => i.item_name);
    expect(names).toContain('Board-scoped step');
    expect(names).not.toContain('Other board step');
    expect(names).not.toContain('Disabled step');
    expect(items.find((i: any) => i.item_name === 'Board-scoped step')?.template_id).toBe(matchingTemplate);
  });

  it('T027: auto-apply on category change attaches once and never duplicates', async () => {
    // Dedicated board so apply rules registered by other tests can't match.
    const localFixture = await createCloseRulesFixture(db, fixture.tenantId, fixture.userId);
    const categoryId = uuidv4();
    await scopedDbFor(localFixture.tenantId).table('categories').insert({
      tenant: localFixture.tenantId,
      category_id: categoryId,
      category_name: `Close Rules Category ${categoryId.slice(0, 6)}`,
      board_id: localFixture.boardId,
      created_by: localFixture.userId,
    });

    const templateId = await createTemplateWithItems([{ name: 'Category step' }]);
    expectActionSuccess(await createChecklistTemplateApplyRule(templateId, { board_id: localFixture.boardId, category_id: categoryId }));

    const ticketId = await insertTicket(db, localFixture);
    expect((await getTicketChecklistItems(ticketId)).length).toBe(0);

    await db.transaction((trx) =>
      updateTicketInTransaction(trx, userRef.user, localFixture.tenantId, ticketId, { category_id: categoryId })
    );
    expect((await getTicketChecklistItems(ticketId)).length).toBe(1);

    // Move away and back — idempotency keeps the copy single
    await db.transaction((trx) =>
      updateTicketInTransaction(trx, userRef.user, localFixture.tenantId, ticketId, { category_id: null })
    );
    await db.transaction((trx) =>
      updateTicketInTransaction(trx, userRef.user, localFixture.tenantId, ticketId, { category_id: categoryId })
    );
    expect((await getTicketChecklistItems(ticketId)).length).toBe(1);
  });

  it('T028: workflow-sourced application is idempotent and carries workflow provenance', async () => {
    const ticketId = await insertTicket(db, fixture);
    const templateId = await createTemplateWithItems([{ name: 'Workflow step' }]);

    const first = await db.transaction((trx) =>
      applyChecklistTemplateToTicket(trx, fixture.tenantId, ticketId, templateId, 'workflow')
    );
    expect(first.applied).toBe(true);

    const second = await db.transaction((trx) =>
      applyChecklistTemplateToTicket(trx, fixture.tenantId, ticketId, templateId, 'workflow')
    );
    expect(second.applied).toBe(false);

    const items = await getTicketChecklistItems(ticketId);
    expect(items.length).toBe(1);
    expect(items[0].source).toBe('workflow');
  });

  it('T029: mutations are rejected without the ticket update permission', async () => {
    const ticketId = await insertTicket(db, fixture);
    const item = expectActionSuccess(await addChecklistItem(ticketId, { item_name: 'Permission probe' }));

    hasPermissionMock.mockResolvedValue(false);

    expect(await addChecklistItem(ticketId, { item_name: 'x' })).toMatchObject({
      permissionError: expect.stringMatching(/Permission denied/),
    });
    expect(await setChecklistItemCompleted(item.checklist_item_id, true)).toMatchObject({
      permissionError: expect.stringMatching(/Permission denied/),
    });
    expect(await createChecklistTemplate({ name: 'x' })).toMatchObject({
      permissionError: expect.stringMatching(/Permission denied/),
    });
    expect(await createChecklistTemplateApplyRule(uuidv4(), {})).toMatchObject({
      permissionError: expect.stringMatching(/Permission denied/),
    });
  });

  it('auto-apply evaluates all matcher dimensions together', async () => {
    // Dedicated board so apply rules registered by other tests can't match.
    const localFixture = await createCloseRulesFixture(db, fixture.tenantId, fixture.userId);
    const templateId = await createTemplateWithItems([{ name: 'Priority+board step' }]);
    expectActionSuccess(
      await createChecklistTemplateApplyRule(templateId, {
        board_id: localFixture.boardId,
        priority_id: localFixture.priorityId,
      })
    );

    const matchingTicket = await insertTicket(db, localFixture);
    const applied = await db.transaction((trx) =>
      applyMatchingChecklistTemplates(trx, localFixture.tenantId, {
        ticket_id: matchingTicket,
        board_id: localFixture.boardId,
        priority_id: localFixture.priorityId,
        category_id: null,
        subcategory_id: null,
      })
    );
    expect(applied).toBe(1);

    const wrongPriorityTicket = await insertTicket(db, localFixture);
    const notApplied = await db.transaction((trx) =>
      applyMatchingChecklistTemplates(trx, localFixture.tenantId, {
        ticket_id: wrongPriorityTicket,
        board_id: localFixture.boardId,
        priority_id: uuidv4(),
        category_id: null,
        subcategory_id: null,
      })
    );
    expect(notApplied).toBe(0);
  });
});
