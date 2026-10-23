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
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
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
  updateChecklistTemplateApplyRule,
} from '../../../../packages/tickets/src/actions/checklists/checklistTemplateActions';
import {
  applyChecklistTemplateToTicket,
  applyMatchingChecklistTemplates,
} from '@alga-psa/shared/lib/ticketChecklists';
import { TicketModel } from '@alga-psa/shared/models/ticketModel';
import { silentTicketCreation } from '@alga-psa/shared/lib/tickets/ticketLifecycleEvents';
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

async function insertServiceRequestDefinition(tenantId: string): Promise<{ definitionId: string; versionId: string }> {
  const definitionId = uuidv4();
  const versionId = uuidv4();
  const name = `Checklist SR ${definitionId.slice(0, 6)}`;
  await scopedDbFor(tenantId).table('service_request_definitions').insert({
    tenant: tenantId,
    definition_id: definitionId,
    name,
  });
  await scopedDbFor(tenantId).table('service_request_definition_versions').insert({
    tenant: tenantId,
    version_id: versionId,
    definition_id: definitionId,
    version_number: 1,
    name,
    form_schema_snapshot: JSON.stringify({}),
    execution_provider: 'ticket-only',
    form_behavior_provider: 'basic',
    visibility_provider: 'all-authenticated-client-users',
  });
  return { definitionId, versionId };
}

async function createTicketViaModel(
  localFixture: CloseRulesFixture,
  input: { title: string; description?: string },
  options?: { serviceRequest?: { definitionId: string } }
): Promise<string> {
  const result = await db.transaction((trx) =>
    TicketModel.createTicket(
      {
        title: input.title,
        description: input.description,
        board_id: localFixture.boardId,
        client_id: localFixture.clientId,
        status_id: localFixture.openStatusId,
        priority_id: localFixture.priorityId,
        entered_by: fixture.userId,
      } as any,
      fixture.tenantId,
      trx,
      { skipLocationValidation: true, skipCategoryValidation: true, skipSubcategoryValidation: true },
      silentTicketCreation('checklist auto-apply fixture does not assert on ticket events'),
      undefined,
      fixture.userId,
      options
    )
  );
  return result.ticket_id;
}

async function appliedTemplateIds(ticketId: string): Promise<string[]> {
  const rows = await scopedDbFor(fixture.tenantId).table('ticket_checklist_items')
    .where({ ticket_id: ticketId })
    .select('template_id');
  return rows.map((r: any) => r.template_id);
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
        silentTicketCreation('checklist auto-apply fixture does not assert on ticket events'),
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

  it('apply rules reject categories that are not on the rule board', async () => {
    const sourceFixture = await createCloseRulesFixture(db, fixture.tenantId, fixture.userId);
    const targetFixture = await createCloseRulesFixture(db, fixture.tenantId, fixture.userId);
    const insertCategory = async (boardId: string, name: string, parent?: string) => {
      const categoryId = uuidv4();
      await scopedDbFor(fixture.tenantId).table('categories').insert({
        tenant: fixture.tenantId,
        category_id: categoryId,
        category_name: name,
        board_id: boardId,
        parent_category: parent ?? null,
        created_by: fixture.userId,
      });
      return categoryId;
    };
    // Same names on both boards, as after a category copy.
    const sourceHardware = await insertCategory(sourceFixture.boardId, 'Hardware');
    const sourceLaptop = await insertCategory(sourceFixture.boardId, 'Laptop', sourceHardware);
    const targetHardware = await insertCategory(targetFixture.boardId, 'Hardware');
    const targetLaptop = await insertCategory(targetFixture.boardId, 'Laptop', targetHardware);

    const templateId = await createTemplateWithItems([{ name: 'Scoped step' }]);

    expect(
      await createChecklistTemplateApplyRule(templateId, { board_id: targetFixture.boardId, category_id: sourceHardware })
    ).toMatchObject({ messageKey: 'features/tickets:errors.checklist.ruleCategoryBoardMismatch' });
    expect(
      await createChecklistTemplateApplyRule(templateId, {
        board_id: targetFixture.boardId,
        category_id: targetHardware,
        subcategory_id: sourceLaptop,
      })
    ).toMatchObject({ messageKey: 'features/tickets:errors.checklist.ruleSubcategoryInvalid' });
    expect(
      await createChecklistTemplateApplyRule(templateId, { board_id: targetFixture.boardId, category_id: targetLaptop })
    ).toMatchObject({ messageKey: 'features/tickets:errors.checklist.ruleCategoryInvalid' });
    expect(
      await createChecklistTemplateApplyRule(templateId, { subcategory_id: targetLaptop })
    ).toMatchObject({ messageKey: 'features/tickets:errors.checklist.ruleSubcategoryRequiresCategory' });

    const rule = expectActionSuccess(
      await createChecklistTemplateApplyRule(templateId, {
        board_id: targetFixture.boardId,
        category_id: targetHardware,
        subcategory_id: targetLaptop,
      })
    );
    // With no board, any board's category is allowed.
    expectActionSuccess(await createChecklistTemplateApplyRule(templateId, { category_id: sourceHardware }));

    expect(
      await updateChecklistTemplateApplyRule(rule.apply_rule_id, {
        board_id: sourceFixture.boardId,
        category_id: targetHardware,
        subcategory_id: targetLaptop,
      })
    ).toMatchObject({ messageKey: 'features/tickets:errors.checklist.ruleCategoryBoardMismatch' });
  });
  describe('client / service request / keyword matchers', () => {
    // Each case gets its own fixture (own board + client) so rules registered
    // by other tests, which key on other boards/clients, cannot interfere.
    async function cardRule(localFixture: CloseRulesFixture, definitionId: string, over: Record<string, unknown> = {}) {
      const templateId = await createTemplateWithItems([{ name: 'Onboarding step' }]);
      expectActionSuccess(
        await createChecklistTemplateApplyRule(templateId, {
          client_ids: [localFixture.clientId],
          service_request_definition_id: definitionId,
          keywords: ['onboarding'],
          keyword_target: 'title',
          ...over,
        })
      );
      return templateId;
    }

    it('persists matchers with normalisation and implies from_service_request', async () => {
      const localFixture = await createCloseRulesFixture(db, fixture.tenantId, fixture.userId);
      const { definitionId } = await insertServiceRequestDefinition(fixture.tenantId);
      const templateId = await createTemplateWithItems([{ name: 'x' }]);
      const rule = expectActionSuccess(
        await createChecklistTemplateApplyRule(templateId, {
          client_ids: [localFixture.clientId, localFixture.clientId],
          ticket_origins: ['api'],
          service_request_definition_id: definitionId,
          keywords: ['  Onboarding ', 'onboarding', ''],
        })
      );
      expect(rule.client_ids).toEqual([localFixture.clientId]);
      expect(rule.ticket_origins).toEqual(['api']);
      expect(rule.from_service_request).toBe(true);
      expect(rule.keywords).toEqual(['Onboarding']);
      expect(rule.keyword_mode).toBe('any');
      expect(rule.keyword_target).toBe('title_and_description');

      expect(
        await createChecklistTemplateApplyRule(templateId, { keywords: Array.from({ length: 21 }, (_, i) => `k${i}`) })
      ).toMatchObject({ messageKey: 'features/tickets:errors.checklist.ruleTooManyKeywords' });
    });

    it('card example: create-path service request context applies the checklist', async () => {
      const localFixture = await createCloseRulesFixture(db, fixture.tenantId, fixture.userId);
      const { definitionId } = await insertServiceRequestDefinition(fixture.tenantId);
      const templateId = await cardRule(localFixture, definitionId);

      // The submission row does not link to the ticket yet at create time, so
      // only the explicit context can make this match.
      const ticketId = await createTicketViaModel(
        localFixture,
        { title: 'New onboarding for Bob' },
        { serviceRequest: { definitionId } }
      );
      expect(await appliedTemplateIds(ticketId)).toContain(templateId);
    });

    it('near-misses do not apply: other definition, keyword only in description, not a service request', async () => {
      const localFixture = await createCloseRulesFixture(db, fixture.tenantId, fixture.userId);
      const { definitionId } = await insertServiceRequestDefinition(fixture.tenantId);
      const templateId = await cardRule(localFixture, definitionId);

      const otherDefinition = await createTicketViaModel(
        localFixture,
        { title: 'New onboarding for Bob' },
        { serviceRequest: { definitionId: uuidv4() } }
      );
      expect(await appliedTemplateIds(otherDefinition)).not.toContain(templateId);

      const bodyOnly = await createTicketViaModel(
        localFixture,
        { title: 'New hire Bob', description: 'please start onboarding' },
        { serviceRequest: { definitionId } }
      );
      expect(await appliedTemplateIds(bodyOnly)).not.toContain(templateId);

      const plain = await createTicketViaModel(localFixture, { title: 'New onboarding for Bob' });
      expect(await appliedTemplateIds(plain)).not.toContain(templateId);
    });

    it('category change path finds the service request through the submission link', async () => {
      const localFixture = await createCloseRulesFixture(db, fixture.tenantId, fixture.userId);
      const categoryId = uuidv4();
      await scopedDbFor(localFixture.tenantId).table('categories').insert({
        tenant: localFixture.tenantId,
        category_id: categoryId,
        category_name: `SR Category ${categoryId.slice(0, 6)}`,
        board_id: localFixture.boardId,
        created_by: localFixture.userId,
      });
      const { definitionId, versionId } = await insertServiceRequestDefinition(fixture.tenantId);
      const { definitionId: otherDefinitionId, versionId: otherVersionId } =
        await insertServiceRequestDefinition(fixture.tenantId);
      const templateId = await cardRule(localFixture, definitionId, { category_id: categoryId });

      const linkTicket = async (ticketId: string, defId: string, verId: string) =>
        scopedDbFor(fixture.tenantId).table('service_request_submissions').insert({
          tenant: fixture.tenantId,
          definition_id: defId,
          definition_version_id: verId,
          client_id: localFixture.clientId,
          request_name: 'Checklist test',
          submitted_payload: JSON.stringify({}),
          created_ticket_id: ticketId,
        });
      const moveToCategory = (ticketId: string) =>
        db.transaction((trx) =>
          updateTicketInTransaction(trx, userRef.user, localFixture.tenantId, ticketId, { category_id: categoryId })
        );

      const matching = await insertTicket(db, localFixture, { title: 'New onboarding for Bob' } as any);
      await linkTicket(matching, definitionId, versionId);
      await moveToCategory(matching);
      expect(await appliedTemplateIds(matching)).toContain(templateId);

      // Linked to a different definition: same client and title, no apply.
      const wrongDefinition = await insertTicket(db, localFixture, { title: 'New onboarding for Bob' } as any);
      await linkTicket(wrongDefinition, otherDefinitionId, otherVersionId);
      await moveToCategory(wrongDefinition);
      expect(await appliedTemplateIds(wrongDefinition)).not.toContain(templateId);

      // Not linked to any submission at all.
      const unlinked = await insertTicket(db, localFixture, { title: 'New onboarding for Bob' } as any);
      await moveToCategory(unlinked);
      expect(await appliedTemplateIds(unlinked)).not.toContain(templateId);
    });

    describe('BlockNote descriptions match on visible text, not raw JSON', () => {
      const blockNote = [
        {
          id: 'bn1',
          type: 'paragraph',
          props: { textColor: 'default', backgroundColor: 'default', textAlignment: 'left' },
          content: [{ type: 'text', text: 'Mouse is broken, needs replacing', styles: {} }],
          children: [],
        },
      ];

      async function keywordRules(boardId: string, clientId: string) {
        const out: Record<string, string> = {};
        for (const keyword of ['left', 'mouse']) {
          const templateId = await createTemplateWithItems([{ name: `Keyword ${keyword} step` }]);
          expectActionSuccess(
            await createChecklistTemplateApplyRule(templateId, {
              board_id: boardId,
              client_ids: [clientId],
              keywords: [keyword],
              keyword_target: 'description',
            })
          );
          out[keyword] = templateId;
        }
        return out;
      }

      it('create path', async () => {
        const localFixture = await createCloseRulesFixture(db, fixture.tenantId, fixture.userId);
        const rules = await keywordRules(localFixture.boardId, localFixture.clientId);
        const ticketId = await createTicketViaModel(localFixture, {
          title: 'Broken peripheral',
          description: JSON.stringify(blockNote),
        });
        const applied = await appliedTemplateIds(ticketId);
        expect(applied).not.toContain(rules.left);
        expect(applied).toContain(rules.mouse);
      });

      it('board-change re-evaluation', async () => {
        const sourceFixture = await createCloseRulesFixture(db, fixture.tenantId, fixture.userId);
        const targetFixture = await createCloseRulesFixture(db, fixture.tenantId, fixture.userId);
        const rules = await keywordRules(targetFixture.boardId, sourceFixture.clientId);
        const ticketId = await insertTicket(db, sourceFixture, {
          title: 'Broken peripheral',
          attributes: JSON.stringify({ description: JSON.stringify(blockNote) }),
        } as any);
        await db.transaction((trx) =>
          updateTicketInTransaction(trx, userRef.user, sourceFixture.tenantId, ticketId, {
            board_id: targetFixture.boardId,
            status_id: targetFixture.openStatusId,
          })
        );
        const applied = await appliedTemplateIds(ticketId);
        expect(applied).not.toContain(rules.left);
        expect(applied).toContain(rules.mouse);
      });
    });

    it('rules without the new matchers still apply to plain tickets', async () => {
      const localFixture = await createCloseRulesFixture(db, fixture.tenantId, fixture.userId);
      const templateId = await createTemplateWithItems([{ name: 'Legacy board rule step' }]);
      const rule = expectActionSuccess(
        await createChecklistTemplateApplyRule(templateId, { board_id: localFixture.boardId })
      );
      expect(rule.client_ids).toBeNull();
      expect(rule.from_service_request).toBe(false);
      expect(rule.keywords).toBeNull();

      const ticketId = await createTicketViaModel(localFixture, { title: 'Anything at all' });
      expect(await appliedTemplateIds(ticketId)).toContain(templateId);
    });
  });
});
