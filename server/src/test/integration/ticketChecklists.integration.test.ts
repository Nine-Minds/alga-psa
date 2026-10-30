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
  updateChecklistTemplate,
  getChecklistTemplates,
  getChecklistTemplateApplyRules,
  deleteChecklistTemplateApplyRule,
  deleteChecklistTemplate,
  duplicateChecklistTemplateToClient,
  addChecklistTemplateItem,
  updateChecklistTemplateItem,
  deleteChecklistTemplateItem,
  createChecklistTemplateApplyRule as createPredicateRule,
  updateChecklistTemplateApplyRule as updatePredicateRule,
} from '../../../../packages/tickets/src/actions/checklists/checklistTemplateActions';
import { applyChecklistTemplate } from '../../../../packages/tickets/src/actions/checklists/applyChecklistTemplate';
import {
  deactivateClientScopedChecklistTemplates,
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

import { legacyChecklistRuleToPredicate } from '../../../migrations/utils/checklistRulePredicate.cjs';
import type { PredicateGroup } from '@alga-psa/predicates';
const legacyInput = (input: Record<string, unknown>) => ({
  where: legacyChecklistRuleToPredicate(input) as PredicateGroup,
  ...(typeof input.is_enabled === 'boolean' ? { is_enabled: input.is_enabled } : {}),
});
const createChecklistTemplateApplyRule = (id: string, input: Record<string, unknown>) => createPredicateRule(id, legacyInput(input));
const updateChecklistTemplateApplyRule = (id: string, input: Record<string, unknown>) => updatePredicateRule(id, legacyInput(input));

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
  let submissionId: string | undefined;
  if (options?.serviceRequest) {
    const definitionId = options.serviceRequest.definitionId;
    const version = await scopedDbFor(fixture.tenantId).table('service_request_definition_versions').where({ definition_id: definitionId }).first();
    if (!version) {
      const created = await insertServiceRequestDefinition(fixture.tenantId);
      options.serviceRequest.definitionId = created.definitionId;
    }
    const linkedVersion = await scopedDbFor(fixture.tenantId).table('service_request_definition_versions').where({ definition_id: options.serviceRequest.definitionId }).first();
    submissionId = uuidv4();
    await scopedDbFor(fixture.tenantId).table('service_request_submissions').insert({
      tenant: fixture.tenantId, submission_id: submissionId, definition_id: options.serviceRequest.definitionId,
      definition_version_id: linkedVersion.version_id, client_id: localFixture.clientId, request_name: 'Checklist fixture', submitted_payload: '{}',
    });
  }
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
      submissionId ? { serviceRequestSubmissionId: submissionId } : undefined
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
      tenant: seededUser.tenant,
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

      })
    );
    expect(applied).toBe(1);

    const wrongPriorityTicket = await insertTicket(db, localFixture);
    await scopedDbFor(localFixture.tenantId).table('tickets').where({ ticket_id: wrongPriorityTicket }).update({ priority_id: fixture.priorityId });
    const notApplied = await db.transaction((trx) =>
      applyMatchingChecklistTemplates(trx, localFixture.tenantId, {
        ticket_id: wrongPriorityTicket,

      })
    );
    expect(notApplied).toBe(0);
  });

  it('round-trips nested predicates through CRUD and maintains tag references transactionally', async () => {
    const templateId = await createTemplateWithItems([{ name: 'Nested' }]);
    const clientTag = uuidv4(), contactTag = uuidv4();
    await scopedDbFor(fixture.tenantId).table('tag_definitions').insert([
      { tenant: fixture.tenantId, tag_id: clientTag, tag_text: 'Reference client', tagged_type: 'client' },
      { tenant: fixture.tenantId, tag_id: contactTag, tag_text: 'Reference contact', tagged_type: 'contact' },
    ]);
    const where: PredicateGroup = { join: 'and', clauses: [{ join: 'or', clauses: [
      { path: 'client.tags', operator: 'in', value: [clientTag] },
      { path: 'contact.tags', operator: 'not_in', value: [contactTag] },
    ] }] };
    const rule = expectActionSuccess(await createPredicateRule(templateId, { where, is_enabled: false }));
    expect((await getChecklistTemplateApplyRules(templateId))[0].where).toEqual(where);
    const refs = () => scopedDbFor(fixture.tenantId).table('tag_references').where({ referrer_type: 'checklist_template_apply_rule', referrer_id: rule.apply_rule_id });
    expect((await refs()).map((row: any) => row.tag_id).sort()).toEqual([clientTag, contactTag].sort());
    expectActionSuccess(await updatePredicateRule(rule.apply_rule_id, { where: { join: 'and', clauses: [] }, is_enabled: false }));
    expect(await refs()).toHaveLength(0);
    expectActionSuccess(await updatePredicateRule(rule.apply_rule_id, { where, is_enabled: false }));
    await deleteChecklistTemplateApplyRule(rule.apply_rule_id);
    expect(await refs()).toHaveLength(0);
    const second = expectActionSuccess(await createPredicateRule(templateId, { where, is_enabled: false }));
    await deleteChecklistTemplate(templateId);
    expect(await scopedDbFor(fixture.tenantId).table('tag_references').where({ referrer_id: second.apply_rule_id })).toHaveLength(0);
  });

  it('rejects invalid predicate paths, values and versions on save', async () => {
    const templateId = await createTemplateWithItems([{ name: 'Validation' }]);
    for (const input of [
      { where: { join: 'and', clauses: [{ path: 'unknown.path', operator: 'equals', value: 'x' }] } },
      { where: { join: 'and', clauses: [{ path: 'board_id', operator: 'equals', value: 'not-a-uuid' }] } },
      { where_version: 2, where: { join: 'and', clauses: [] } },
    ]) {
      expect(await createPredicateRule(templateId, input as any)).toMatchObject({ messageKey: 'features/tickets:errors.checklist.predicateInvalid' });
    }
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
      expect(rule.where).toEqual(legacyChecklistRuleToPredicate({
        client_ids: [localFixture.clientId, localFixture.clientId], ticket_origins: ['api'],
        service_request_definition_id: definitionId, keywords: ['  Onboarding ', 'onboarding', ''],
      }));
      expect(rule.where_version).toBe(1);
    });

    it('card example: create-path service request context applies the checklist', async () => {
      const localFixture = await createCloseRulesFixture(db, fixture.tenantId, fixture.userId);
      const { definitionId } = await insertServiceRequestDefinition(fixture.tenantId);
      const templateId = await cardRule(localFixture, definitionId);

      // The model links the submission before evaluating the compiled rule.
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
      expect(rule.where).toEqual(legacyChecklistRuleToPredicate({ board_id: localFixture.boardId }));

      const ticketId = await createTicketViaModel(localFixture, { title: 'Anything at all' });
      expect(await appliedTemplateIds(ticketId)).toContain(templateId);
    });
  });

  describe('client-scoped templates', () => {
    async function createScopedTemplate(clientId: string | null, itemNames: string[] = ['Scoped step']): Promise<string> {
      const template = expectActionSuccess(
        await createChecklistTemplate({ name: `Scoped ${uuidv4().slice(0, 8)}`, client_id: clientId })
      );
      for (const name of itemNames) {
        expectActionSuccess(await addChecklistTemplateItem(template.template_id, { item_name: name }));
      }
      return template.template_id;
    }

    it('applies a scoped template on its own client\'s ticket', async () => {
      const ticketId = await insertTicket(db, fixture);
      const templateId = await createScopedTemplate(fixture.clientId);
      const result = await db.transaction((trx) =>
        applyChecklistTemplateToTicket(trx, fixture.tenantId, ticketId, templateId, 'template')
      );
      expect(result).toEqual({ applied: true, itemsAdded: 1 });
    });

    it('refuses a scoped template on another client\'s ticket (shared + manual action)', async () => {
      const other = await createCloseRulesFixture(db, fixture.tenantId, fixture.userId);
      const otherTicket = await insertTicket(db, other);
      const templateId = await createScopedTemplate(fixture.clientId);

      const shared = await db.transaction((trx) =>
        applyChecklistTemplateToTicket(trx, fixture.tenantId, otherTicket, templateId, 'template')
      );
      expect(shared).toEqual({ applied: false, itemsAdded: 0, reason: 'template-client-mismatch' });

      const manual = await applyChecklistTemplate(otherTicket, templateId);
      expect(manual).toMatchObject({ messageKey: 'features/tickets:errors.checklist.templateClientMismatch' });

      expect(await getTicketChecklistItems(otherTicket)).toHaveLength(0);
      const audits = await scopedDbFor(fixture.tenantId).table('ticket_audit_logs')
        .where({ ticket_id: otherTicket, event_type: 'TICKET_CHECKLIST_TEMPLATE_APPLIED' });
      expect(audits).toHaveLength(0);
    });

    describe('ownership vs rule client matchers', () => {
      it('rejects a rule on an owned template that names another client', async () => {
        const other = await createCloseRulesFixture(db, fixture.tenantId, fixture.userId);
        const templateId = await createScopedTemplate(fixture.clientId);
        expect(
          await createChecklistTemplateApplyRule(templateId, { client_ids: [fixture.clientId, other.clientId] })
        ).toMatchObject({ messageKey: 'features/tickets:errors.checklist.predicateClientOutsideScope' });

        const rule = expectActionSuccess(await createChecklistTemplateApplyRule(templateId, {}));
        expect(
          await updateChecklistTemplateApplyRule(rule.apply_rule_id, { client_ids: [other.clientId] })
        ).toMatchObject({ messageKey: 'features/tickets:errors.checklist.predicateClientOutsideScope' });
      });

      it('stores a rule naming only the owner as "any client", and it fires only on the owner\'s tickets', async () => {
        const owner = await createCloseRulesFixture(db, fixture.tenantId, fixture.userId);
        const other = await createCloseRulesFixture(db, fixture.tenantId, fixture.userId);
        const templateId = await createScopedTemplate(owner.clientId, ['Owner step']);
        const rule = expectActionSuccess(
          await createChecklistTemplateApplyRule(templateId, { client_ids: [owner.clientId], keywords: ['owner-only-kw'] })
        );
        expect(rule.where).toEqual(legacyChecklistRuleToPredicate({ keywords: ['owner-only-kw'] }));

        const ownerTicket = await createTicketViaModel(owner, { title: 'owner-only-kw request' });
        const otherTicket = await createTicketViaModel(other, { title: 'owner-only-kw request' });
        expect(await appliedTemplateIds(ownerTicket)).toContain(templateId);
        expect(await appliedTemplateIds(otherTicket)).not.toContain(templateId);
      });

      it('a rule naming another client can never apply an owned template there (rows written outside the actions)', async () => {
        const owner = await createCloseRulesFixture(db, fixture.tenantId, fixture.userId);
        const other = await createCloseRulesFixture(db, fixture.tenantId, fixture.userId);
        const templateId = await createScopedTemplate(owner.clientId);
        await scopedDbFor(fixture.tenantId).table('checklist_template_apply_rules').insert({
          tenant: fixture.tenantId,
          template_id: templateId,
          where: JSON.stringify({ join: 'and', clauses: [{ path: 'client.id', operator: 'in', value: [other.clientId] }] }),
          is_enabled: true,
        });
        const otherTicket = await createTicketViaModel(other, { title: 'Anything' });
        expect(await appliedTemplateIds(otherTicket)).not.toContain(templateId);
      });

      it('giving a template an owner resets owner-only rule clients and refuses rules naming other clients', async () => {
        const owner = await createCloseRulesFixture(db, fixture.tenantId, fixture.userId);
        const other = await createCloseRulesFixture(db, fixture.tenantId, fixture.userId);

        const ok = await createScopedTemplate(null);
        const okRule = expectActionSuccess(await createChecklistTemplateApplyRule(ok, { client_ids: [owner.clientId] }));
        expectActionSuccess(await updateChecklistTemplate(ok, { client_id: owner.clientId }));
        const okRuleAfter = await scopedDbFor(fixture.tenantId).table('checklist_template_apply_rules')
          .where({ apply_rule_id: okRule.apply_rule_id }).first();
        expect(okRuleAfter.where).toEqual({ join: 'and', clauses: [] });

        const blocked = await createScopedTemplate(null);
        expectActionSuccess(await createChecklistTemplateApplyRule(blocked, { client_ids: [owner.clientId, other.clientId] }));
        expect(await updateChecklistTemplate(blocked, { client_id: owner.clientId })).toMatchObject({
          messageKey: 'features/tickets:errors.checklist.predicateClientOutsideScope',
        });
        const unchanged = await scopedDbFor(fixture.tenantId).table('checklist_templates').where({ template_id: blocked }).first();
        expect(unchanged.client_id).toBeNull();
      });
    });

    it('auto-apply skips an out-of-scope template even when the rule matches', async () => {
      const ruleFixture = await createCloseRulesFixture(db, fixture.tenantId, fixture.userId);
      const otherClient = await createCloseRulesFixture(db, fixture.tenantId, fixture.userId);
      const scoped = await createScopedTemplate(otherClient.clientId);
      const wide = await createScopedTemplate(null, ['Wide step']);
      for (const templateId of [scoped, wide]) {
        expectActionSuccess(await createChecklistTemplateApplyRule(templateId, { board_id: ruleFixture.boardId }));
      }
      const ticketId = await insertTicket(db, ruleFixture);
      const applied = await db.transaction((trx) =>
        applyMatchingChecklistTemplates(trx, ruleFixture.tenantId, {
          ticket_id: ticketId,

        })
      );
      // Only the tenant-wide template applied; the scoped one was skipped without error.
      expect(applied).toBe(1);
      const items = await getTicketChecklistItems(ticketId);
      expect(items.map((i) => i.template_id)).toEqual([wide]);
    });

    it('a tenant-wide template still applies on every client', async () => {
      const other = await createCloseRulesFixture(db, fixture.tenantId, fixture.userId);
      const templateId = await createScopedTemplate(null);
      for (const f of [fixture, other]) {
        const ticketId = await insertTicket(db, f);
        const result = await db.transaction((trx) =>
          applyChecklistTemplateToTicket(trx, fixture.tenantId, ticketId, templateId, 'template')
        );
        expect(result.applied).toBe(true);
      }
    });

    it('the picker query excludes other clients\' templates', async () => {
      const other = await createCloseRulesFixture(db, fixture.tenantId, fixture.userId);
      const mine = await createScopedTemplate(fixture.clientId);
      const theirs = await createScopedTemplate(other.clientId);
      const wide = await createScopedTemplate(null);
      const ticketId = await insertTicket(db, fixture);

      const picker = (await getChecklistTemplates({ forTicketId: ticketId })).map((t) => t.template_id);
      expect(picker).toContain(mine);
      expect(picker).toContain(wide);
      expect(picker).not.toContain(theirs);

      const settingsList = (await getChecklistTemplates()).map((t) => t.template_id);
      expect(settingsList).toContain(theirs);
      const withName = (await getChecklistTemplates({ clientId: other.clientId }))[0];
      expect(withName).toMatchObject({ template_id: theirs, client_id: other.clientId });
      expect(withName.client_name).toBeTruthy();
    });

    it('rejects a client that does not belong to the tenant', async () => {
      const result = await createChecklistTemplate({ name: 'Bad client', client_id: uuidv4() });
      expect(result).toMatchObject({ messageKey: 'features/tickets:errors.checklist.templateClientInvalid' });
    });

    it('client deletion deactivates and detaches that client\'s scoped templates', async () => {
      const doomed = await createCloseRulesFixture(db, fixture.tenantId, fixture.userId);
      const scoped = await createScopedTemplate(doomed.clientId);
      const unrelated = await createScopedTemplate(fixture.clientId);

      const count = await db.transaction((trx) =>
        deactivateClientScopedChecklistTemplates(trx, fixture.tenantId, doomed.clientId)
      );
      expect(count).toBe(1);

      const row = await scopedDbFor(fixture.tenantId).table('checklist_templates').where({ template_id: scoped }).first();
      expect(row).toMatchObject({ is_active: false, client_id: null });
      expect(row.description).toContain('was deleted');
      const untouched = await scopedDbFor(fixture.tenantId).table('checklist_templates').where({ template_id: unrelated }).first();
      expect(untouched).toMatchObject({ is_active: true, client_id: fixture.clientId });
    });

    it('duplicate-to-client copies items and sets client_id', async () => {
      const other = await createCloseRulesFixture(db, fixture.tenantId, fixture.userId);
      const sourceId = await createTemplateWithItems([{ name: 'One' }, { name: 'Two', required: false }]);
      const copy = expectActionSuccess(await duplicateChecklistTemplateToClient(sourceId, other.clientId));
      expect(copy.template_id).not.toBe(sourceId);
      expect(copy.client_id).toBe(other.clientId);
      expect(copy.description).toContain('Copied from');

      const items = await scopedDbFor(fixture.tenantId).table('checklist_template_items')
        .where({ template_id: copy.template_id }).orderBy('order_number', 'asc');
      expect(items.map((i: any) => [i.item_name, i.is_required])).toEqual([['One', true], ['Two', false]]);
      const source = await scopedDbFor(fixture.tenantId).table('checklist_templates').where({ template_id: sourceId }).first();
      expect(source.client_id).toBeNull();
    });
  });
});
