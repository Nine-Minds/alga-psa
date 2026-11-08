/**
 * Integration tests for "Create workflow from ticket" (alga-2026-0002502; plan
 * docs/plans/2026-10-13-create-workflow-from-ticket-plan.md). Real database, real RBAC, real
 * authorization kernel, real workflow persistence/validation/publish; only the session seam,
 * the Temporal launcher, the event bus and the workflow-run permission check are replaced.
 *
 * Modelled on workflowDesignerGroupedPersistence.integration.test.ts (persistence) and
 * ticketDuplicate.integration.test.ts (ticket fixtures, narrowing bundle).
 *
 * "Running" the published workflow executes each published step in order through the real
 * action registry (inputMapping resolved by the runtime's own resolver). The Temporal engine
 * itself is not started.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { setupCommonMocks, createMockUser } from '../../../test-utils/testMocks';
import * as auth from '@alga-psa/auth';
import * as rbac from '@alga-psa/auth/rbac';
import {
  createAuthorizationBundle,
  createBundleAssignment,
  publishBundleRevision,
  upsertBundleRule,
} from '@alga-psa/authorization/bundles/service';
import { TestContext } from '../../../test-utils/testContext';
import { createUser } from '../../../test-utils/testDataFactory';
import { tenantDb } from '@alga-psa/db';
import { publishWorkflowDefinitionAction } from '@alga-psa/workflows/actions';
import { resolveInputMapping } from '../../../../shared/workflow/runtime/utils/mappingResolver';
import { getActionRegistryV2 } from '../../../../shared/workflow/runtime/registries/actionRegistry';
import { initializeWorkflowRuntimeV2 } from '../../../../shared/workflow/runtime/init';

vi.mock('@alga-psa/auth', async () => {
  const { createAuthModuleMock } = await import('../../../test-utils/authModuleMock');
  return createAuthModuleMock();
});

vi.mock('@alga-psa/workflows/lib/workflowRuntimeV2Temporal', () => ({
  startWorkflowRuntimeV2TemporalRun: vi.fn(),
  cancelWorkflowRuntimeV2TemporalRun: vi.fn(),
}));

// `isEnterprise` is evaluated at import time, so the edition must be set before any import runs.
const auditSpy = vi.hoisted(() => {
  process.env.EDITION = 'ee';
  return vi.fn();
});
vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    auditLog: vi.fn(async (...args: Parameters<typeof actual.auditLog>) => {
      auditSpy(...args);
      return actual.auditLog(...args);
    }),
  };
});

vi.mock('@alga-psa/event-bus/publishers', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/event-bus/publishers')>('@alga-psa/event-bus/publishers');
  return { ...actual, publishEvent: vi.fn(async () => undefined), publishWorkflowEvent: vi.fn(async () => undefined) };
});

// The published workflow's own runtime permission check is not under test here.
vi.mock('../../../../shared/workflow/runtime/actions/businessOperations/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../shared/workflow/runtime/actions/businessOperations/shared')>();
  return { ...actual, requirePermission: async () => undefined };
});

const HOOK_TIMEOUT = 900_000;
// Resolved on disk: a bare relative specifier in a dynamic import is resolved
// against the Vite root, which sits below the repository's ee/ directory.
const EE_ACTION_PATH = path.resolve(__dirname, '../../../../ee/server/src/workflows/createFromTicket/actions.server.ts');

async function loadEeAction() {
  return (await import(EE_ACTION_PATH)) as typeof import('../../../../ee/server/src/workflows/createFromTicket/actions.server');
}

describe('Create workflow from ticket (integration)', () => {
  const context = new TestContext({ runSeeds: true });
  let realPermissionCheck: typeof rbac.hasPermission;

  let tenantId: string;
  let clientId: string;
  let boardId: string;
  let statusId: string;
  let priorityId: string;
  let categoryId: string;
  let contactId: string;
  let ownerUser: string;
  let sourceTicketId: string;
  let templateId: string;

  let admin: any; // ticket:read + workflow:manage
  let noWorkflowUser: any; // ticket:read only
  let narrowedAdmin: any; // ticket:read (narrowed to own) + workflow:manage
  let clientPortalUser: any;

  const tt = (table: string) => tenantDb(context.db, tenantId).table(table);

  beforeAll(async () => {
    process.env.EDITION = 'ee';
    await context.initialize();
    realPermissionCheck = (await vi.importActual<typeof rbac>('@alga-psa/auth/rbac')).hasPermission;
    initializeWorkflowRuntimeV2();
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await context.cleanup();
  }, HOOK_TIMEOUT);

  async function grant(userId: string, grants: Array<{ resource: string; action: string }>) {
    const roleId = uuidv4();
    await tt('roles').insert({ tenant: tenantId, role_id: roleId, role_name: `CWFT ${roleId}`, msp: true, client: false });
    for (const g of grants) {
      let permission = await tt('permissions').where({ resource: g.resource, action: g.action, msp: true }).first();
      if (!permission) {
        const permission_id = uuidv4();
        await tt('permissions').insert({ tenant: tenantId, permission_id, resource: g.resource, action: g.action, msp: true, client: false });
        permission = { permission_id };
      }
      await tt('role_permissions').insert({ tenant: tenantId, role_id: roleId, permission_id: permission.permission_id });
    }
    await tt('user_roles').insert({ tenant: tenantId, role_id: roleId, user_id: userId });
  }

  async function loadUser(userId: string) {
    const query = tt('users').select('users.*').where('users.user_id', userId);
    tenantDb(context.db, tenantId).tenantJoin(query, 'user_roles', 'users.user_id', 'user_roles.user_id', { type: 'left' });
    tenantDb(context.db, tenantId).tenantJoin(query, 'roles', 'user_roles.role_id', 'roles.role_id', { type: 'left' });
    return query.first();
  }

  const actAs = (user: any) => vi.mocked(auth.getCurrentUser).mockResolvedValue(user);

  const request = (overrides: Record<string, unknown> = {}) => ({
    ticketId: sourceTicketId,
    name: 'Onboarding workflow',
    trigger: { type: 'manual' as const },
    include: { assignment: true, tags: true, customFields: true, checklist: true },
    ...overrides,
  });

  async function workflowCount(): Promise<number> {
    const row = await tt('workflow_definitions').count('* as n').first();
    return Number((row as any).n);
  }

  beforeEach(async () => {
    await context.reset();
    auditSpy.mockClear();
    tenantId = context.tenantId;
    clientId = context.clientId;

    const adminId = await createUser(context.db, tenantId, { username: 'cwft-admin', first_name: 'Ada', last_name: 'Admin', email: 'ada@example.com', user_type: 'internal' });
    const plainId = await createUser(context.db, tenantId, { username: 'cwft-plain', first_name: 'Pat', last_name: 'Plain', email: 'pat@example.com', user_type: 'internal' });
    const narrowedId = await createUser(context.db, tenantId, { username: 'cwft-narrow', first_name: 'Nora', last_name: 'Narrow', email: 'nora@example.com', user_type: 'internal' });
    const portalId = await createUser(context.db, tenantId, { username: 'cwft-portal', first_name: 'Pia', last_name: 'Portal', email: 'pia@example.com', user_type: 'client' });
    ownerUser = await createUser(context.db, tenantId, { username: 'cwft-owner', first_name: 'Owen', last_name: 'Owner', email: 'owen@example.com', user_type: 'internal' });

    boardId = uuidv4();
    await tt('boards').insert({ tenant: tenantId, board_id: boardId, board_name: 'CWFT Board' });
    contactId = uuidv4();
    await tt('contacts').insert({ tenant: tenantId, contact_name_id: contactId, full_name: 'CWFT Contact', email: 'contact@example.com', client_id: clientId });
    priorityId = (await tt('priorities').where({ item_type: 'ticket' }).first()).priority_id;
    categoryId = uuidv4();
    await tt('categories').insert({ tenant: tenantId, category_id: categoryId, category_name: 'CWFT Category', board_id: boardId, created_by: adminId });
    statusId = uuidv4();
    await tt('statuses').insert({
      tenant: tenantId, status_id: statusId, name: 'CWFT Open', board_id: boardId, status_type: 'ticket',
      is_closed: false, is_default: true, order_number: 9001, created_by: adminId,
    });

    setupCommonMocks({ tenantId, user: createMockUser('internal') });
    vi.mocked(rbac.hasPermission).mockImplementation(realPermissionCheck);
    vi.mocked(auth.hasPermission).mockImplementation(realPermissionCheck);

    await grant(adminId, [{ resource: 'ticket', action: 'read' }, { resource: 'workflow', action: 'manage' }, { resource: 'workflow', action: 'read' }, { resource: 'workflow', action: 'publish' }]);
    await grant(plainId, [{ resource: 'ticket', action: 'read' }]);
    await grant(narrowedId, [{ resource: 'ticket', action: 'read' }, { resource: 'workflow', action: 'manage' }, { resource: 'workflow', action: 'read' }]);
    admin = await loadUser(adminId);
    noWorkflowUser = await loadUser(plainId);
    narrowedAdmin = await loadUser(narrowedId);
    clientPortalUser = await loadUser(portalId);

    sourceTicketId = uuidv4();
    await tt('tickets').insert({
      tenant: tenantId, ticket_id: sourceTicketId, ticket_number: 'CWFT-1', title: 'Onboard new employee',
      board_id: boardId, client_id: clientId, contact_name_id: contactId, status_id: statusId,
      category_id: categoryId, priority_id: priorityId, assigned_to: ownerUser,
      entered_by: ownerUser, entered_at: new Date().toISOString(), is_closed: false,
      attributes: JSON.stringify({
        description: 'Original description',
        custom_fields: { shirt_size: 'L' },
        watch_list: [{ email: 'watcher@example.com' }],
      }),
    });

    const tagId = uuidv4();
    await tt('tag_definitions').insert({ tenant: tenantId, tag_id: tagId, tag_text: 'onboarding', tagged_type: 'ticket', background_color: '#112233', text_color: '#ffffff' });
    await tt('tag_mappings').insert({ tenant: tenantId, mapping_id: uuidv4(), tag_id: tagId, tagged_id: sourceTicketId, tagged_type: 'ticket' });

    templateId = uuidv4();
    await tt('checklist_templates').insert({ tenant: tenantId, template_id: templateId, name: 'Hardware', is_active: true });
    await tt('checklist_template_items').insert([
      { tenant: tenantId, template_item_id: uuidv4(), template_id: templateId, item_name: 'Order laptop', order_number: 0, is_required: true },
      { tenant: tenantId, template_item_id: uuidv4(), template_id: templateId, item_name: 'Image laptop', order_number: 1, is_required: false },
    ]);
    await tt('ticket_checklist_items').insert([
      { tenant: tenantId, ticket_id: sourceTicketId, item_name: 'Order laptop', order_number: 0, is_required: true, source: 'template', template_id: templateId, completed: true, completed_by: ownerUser, completed_at: new Date().toISOString() },
      { tenant: tenantId, ticket_id: sourceTicketId, item_name: 'Image laptop', order_number: 1, is_required: false, source: 'template', template_id: templateId },
      { tenant: tenantId, ticket_id: sourceTicketId, item_name: 'Print badge', order_number: 2, is_required: false, source: 'manual', created_by: ownerUser },
    ]);

    actAs(admin);
  }, HOOK_TIMEOUT);

  describe('happy path', () => {
    it('creates a clean draft with the right trigger/steps, no version rows, and an audit record', async () => {
      const { createWorkflowFromTicketAction } = await loadEeAction();

      // The harness runs everything inside one outer transaction, so a transaction-local
      // set_config made by any earlier savepoint would outlive it and mask a bare-knex audit.
      // Emulate pgbouncer transaction mode: the GUC is empty at start and is cleared whenever a
      // nested transaction() ends (as a real COMMIT would), so only set_config(..., true) inside
      // the audit's own trx can satisfy auditLog.
      const clearGuc = () => context.db.raw("select set_config('app.current_tenant', '', false)");
      const trxHost = context.db as any;
      const originalTransaction = trxHost.transaction;
      Object.defineProperty(trxHost, 'transaction', {
        configurable: true,
        writable: true,
        value: async (...args: any[]) => {
          try {
            return await originalTransaction.apply(trxHost, args);
          } finally {
            await clearGuc();
          }
        },
      });
      let result: any;
      try {
        await clearGuc();
        result = await createWorkflowFromTicketAction(request());
      } finally {
        Object.defineProperty(trxHost, 'transaction', { configurable: true, writable: true, value: originalTransaction });
      }
      expect(result).toEqual({ workflowId: expect.any(String) });

      const row: any = await tt('workflow_definitions').where({ workflow_id: result.workflowId }).first();
      expect(row.status).toBe('draft');
      expect(row.validation_status).toBe('valid');
      expect(row.is_visible).toBe(true);
      expect(row.name).toBe('Onboarding workflow');
      expect(await tt('workflow_definition_versions').where({ workflow_id: result.workflowId })).toHaveLength(0);

      const draft = typeof row.draft_definition === 'string' ? JSON.parse(row.draft_definition) : row.draft_definition;
      expect(draft.trigger).toBeUndefined();
      expect(draft.payloadSchemaRef).toBe('payload.Empty.v1');
      expect(draft.steps.map((s: any) => s.config.actionId)).toEqual([
        'tickets.create',
        'tickets.apply_checklist',
        'tickets.add_checklist_items',
      ]);
      expect(draft.steps[0].config.saveAs).toBe('createdTicket');
      expect(draft.steps[0].config.inputMapping.notify).toEqual({ internal: true, contact: false });
      expect(draft.steps[1].config.inputMapping.template_id).toBe(templateId);
      expect(draft.steps[2].config.inputMapping.items).toEqual([expect.objectContaining({ item_name: 'Print badge' })]);

      expect(auditSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          userId: admin.user_id,
          operation: 'workflow_definition_create_from_ticket',
          recordId: result.workflowId,
          changedData: expect.objectContaining({ sourceTicketId, triggerEventName: null }),
        })
      );

      // The spy proves the call; the row proves it was not silently skipped (see GUC emulation above).
      const bare = await context.db.raw("select current_setting('app.current_tenant', true) as tenant");
      expect((bare.rows ?? bare)[0].tenant || '').toBe('');

      const auditRows: any[] = await tt('audit_logs').where({
        record_id: result.workflowId,
        operation: 'workflow_definition_create_from_ticket',
      });
      expect(auditRows).toHaveLength(1);
      const changed = typeof auditRows[0].changed_data === 'string' ? JSON.parse(auditRows[0].changed_data) : auditRows[0].changed_data;
      expect(changed).toHaveProperty('sourceTicketId', sourceTicketId);
      expect(changed).toHaveProperty('include');
      expect(changed).toHaveProperty('triggerEventName', null);
    });

    it('resolves an event trigger server-side from the catalog', async () => {
      const { createWorkflowFromTicketAction } = await loadEeAction();
      const result: any = await createWorkflowFromTicketAction(request({ trigger: { type: 'event', eventName: 'TICKET_CREATED' } }));
      const row: any = await tt('workflow_definitions').where({ workflow_id: result.workflowId }).first();
      const trigger = typeof row.trigger === 'string' ? JSON.parse(row.trigger) : row.trigger;
      expect(trigger).toMatchObject({ type: 'event', eventName: 'TICKET_CREATED' });
      expect(row.validation_status).toBe('valid');
      expect(row.payload_schema_ref).toBeTruthy();
    });

    it('publishes without edits, and running the published workflow recreates the ticket (R1 fidelity)', async () => {
      const { createWorkflowFromTicketAction } = await loadEeAction();
      const created: any = await createWorkflowFromTicketAction(request());

      const publish: any = await publishWorkflowDefinitionAction({ workflowId: created.workflowId, version: 1 });
      expect(publish.ok).toBe(true);

      const versionRow: any = await tt('workflow_definition_versions').where({ workflow_id: created.workflowId, version: 1 }).first();
      const definition = typeof versionRow.definition_json === 'string' ? JSON.parse(versionRow.definition_json) : versionRow.definition_json;

      const runId = uuidv4();
      const now = new Date().toISOString();
      await tt('workflow_runs').insert({
        run_id: runId, workflow_id: created.workflowId, workflow_version: 1, tenant: tenantId, status: 'running',
        trigger_metadata_json: JSON.stringify({}), started_at: now, updated_at: now,
      });

      const vars: Record<string, unknown> = {};
      for (const step of definition.steps) {
        const action = getActionRegistryV2().get(step.config.actionId, step.config.version)!;
        expect(action).toBeDefined();
        const mapped = await resolveInputMapping(step.config.inputMapping, { expressionContext: { payload: {}, vars, meta: {} } });
        const out = await action.handler(action.inputSchema.parse(mapped), {
          runId, stepPath: `steps.${step.id}`, idempotencyKey: uuidv4(), attempt: 1,
          nowIso: () => new Date().toISOString(), env: {}, tenantId, knex: context.db,
        } as any);
        if (step.config.saveAs) vars[step.config.saveAs] = action.outputSchema.parse(out);
      }

      const newTicketId = (vars.createdTicket as any).ticket_id as string;
      const newTicket: any = await tt('tickets').where({ ticket_id: newTicketId }).first();
      expect(newTicket.title).toBe('Onboard new employee');
      expect(newTicket.board_id).toBe(boardId);
      expect(newTicket.category_id).toBe(categoryId);
      expect(newTicket.priority_id).toBe(priorityId);

      const attrs = (v: any) => (typeof v === 'string' ? JSON.parse(v) : v) ?? {};
      expect(attrs(newTicket.attributes).custom_fields).toEqual({ shirt_size: 'L' });
      // R1: the description the workflow stores renders the same as the source's.
      const source: any = await tt('tickets').where({ ticket_id: sourceTicketId }).first();
      expect(attrs(newTicket.attributes).description).toBe(attrs(source.attributes).description);

      const tags = await tt('tag_mappings').where({ tagged_id: newTicketId, tagged_type: 'ticket' });
      expect(tags).toHaveLength(1);

      const checklist: any[] = await tt('ticket_checklist_items').where({ ticket_id: newTicketId }).orderBy('order_number', 'asc');
      expect(checklist.map((c) => c.item_name)).toEqual(['Order laptop', 'Image laptop', 'Print badge']);
      expect(checklist.every((c) => !c.completed)).toBe(true);
    }, HOOK_TIMEOUT);
  });

  describe('permission gating', () => {
    it('denies a user without workflow:manage and writes nothing', async () => {
      actAs(noWorkflowUser);
      const { createWorkflowFromTicketAction } = await loadEeAction();
      const before = await workflowCount();
      const result: any = await createWorkflowFromTicketAction(request());
      expect(result.permissionError).toBeTruthy();
      expect(await workflowCount()).toBe(before);
      expect(auditSpy).not.toHaveBeenCalled();
    });

    it('denies manage rights without row-level read on the source ticket and writes nothing', async () => {
      const bundle = await createAuthorizationBundle(context.db, { tenant: tenantId, name: `own-only-${uuidv4()}`, actorUserId: admin.user_id });
      await upsertBundleRule(context.db, {
        tenant: tenantId, bundleId: bundle.bundleId, revisionId: bundle.revisionId,
        resourceType: 'ticket', action: 'read', templateKey: 'own', config: {}, actorUserId: admin.user_id,
      });
      await publishBundleRevision(context.db as any, { tenant: tenantId, bundleId: bundle.bundleId, revisionId: bundle.revisionId, actorUserId: admin.user_id });
      await createBundleAssignment(context.db, { tenant: tenantId, bundleId: bundle.bundleId, targetType: 'user', targetId: narrowedAdmin.user_id, actorUserId: admin.user_id });

      actAs(narrowedAdmin);
      const { createWorkflowFromTicketAction } = await loadEeAction();
      const before = await workflowCount();
      const result: any = await createWorkflowFromTicketAction(request());
      expect(result.permissionError).toMatch(/cannot view ticket/i);
      expect(await workflowCount()).toBe(before);
      expect(auditSpy).not.toHaveBeenCalled();
    });

    it('denies a client-portal user and writes nothing', async () => {
      actAs(clientPortalUser);
      const { createWorkflowFromTicketAction } = await loadEeAction();
      const before = await workflowCount();
      const result: any = await createWorkflowFromTicketAction(request());
      expect(result.permissionError).toMatch(/client portal|permission denied/i);
      expect(await workflowCount()).toBe(before);
    });

    it('fails fast outside the Enterprise edition and writes nothing', async () => {
      const previous = { EDITION: process.env.EDITION, NEXT_PUBLIC_EDITION: process.env.NEXT_PUBLIC_EDITION };
      process.env.EDITION = 'ce';
      delete process.env.NEXT_PUBLIC_EDITION;
      try {
        vi.resetModules();
        const { createWorkflowFromTicketAction } = await loadEeAction();
        const before = await workflowCount();
        await expect(createWorkflowFromTicketAction(request())).rejects.toThrow(/Enterprise/);
        expect(await workflowCount()).toBe(before);
      } finally {
        process.env.EDITION = previous.EDITION;
        if (previous.NEXT_PUBLIC_EDITION !== undefined) process.env.NEXT_PUBLIC_EDITION = previous.NEXT_PUBLIC_EDITION;
        vi.resetModules();
      }
    }, HOOK_TIMEOUT);
  });
});
