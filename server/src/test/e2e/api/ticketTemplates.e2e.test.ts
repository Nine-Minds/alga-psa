import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tenantDb } from '@alga-psa/db';
import {
  setupE2ETestEnvironment,
  createTestUserWithPermissions,
  E2ETestEnvironment,
} from '../utils/e2eTestSetup';
import {
  ApiTestClient,
  createTestApiKey,
  assertSuccess,
  assertError,
} from '../utils/apiTestHelpers';
import { v4 as uuidv4 } from 'uuid';

/**
 * Ticket templates over REST (alga-2026-0002965): the CRUD round trip, the client scope, and
 * instantiate — the one call that replaces "POST a ticket, then POST each checklist item".
 */
describe('Ticket Template API E2E Tests', () => {
  let env: E2ETestEnvironment;
  const API_BASE = '/api/v1/tickets/templates';
  let boardId: string;
  let defaultStatusId: string;
  let priorityId: string;
  let otherClientId: string;
  let otherBoardId: string;

  function tenantTable(table: string) {
    return tenantDb(env.db, env.tenant).table(table);
  }

  async function clientWithPermissions(permissions: string[]) {
    const userId = await createTestUserWithPermissions(env.db, env.tenant, permissions);
    const key = await createTestApiKey(env.db, userId, env.tenant);
    return new ApiTestClient({ baseUrl: env.apiClient['config'].baseUrl, apiKey: key.api_key });
  }

  function templateBody(overrides: Record<string, unknown> = {}) {
    return {
      name: `Case manager onboarding ${uuidv4()}`,
      title: 'Onboard a new case manager for {{client}}',
      description: 'Everything the new case manager needs on day one.',
      board_id: boardId,
      priority_id: priorityId,
      tags: ['onboarding'],
      checklist: [
        { item_name: 'Create accounts', is_required: true },
        { item_name: 'Order laptop', is_required: false },
      ],
      ...overrides,
    };
  }

  async function createTemplate(overrides: Record<string, unknown> = {}) {
    const response = await env.apiClient.post(API_BASE, templateBody(overrides));
    assertSuccess(response, 201);
    return response.data.data as { template_id: string; name: string; client_id: string | null };
  }

  beforeAll(async () => {
    env = await setupE2ETestEnvironment();

    const defaultBoard = await tenantTable('boards').where({ is_default: true }).first();
    boardId = defaultBoard?.board_id ?? uuidv4();
    if (!defaultBoard) {
      await tenantTable('boards').insert({
        board_id: boardId, board_name: 'Test Board', tenant: env.tenant, display_order: 99,
      });
    }

    const open = await tenantTable('statuses')
      .where({ board_id: boardId, name: 'New', status_type: 'ticket' }).first();
    defaultStatusId = open?.status_id ?? uuidv4();

    const priority = await tenantTable('priorities').where({ item_type: 'ticket' }).first();
    priorityId = priority?.priority_id ?? uuidv4();

    // A second client, to prove a client-bound template is refused for anyone else.
    otherClientId = uuidv4();
    await tenantTable('clients').insert({
      client_id: otherClientId, tenant: env.tenant, client_name: `Other client ${otherClientId}`,
      client_type: 'company', created_at: new Date(), updated_at: new Date(),
    });

    // A second board with its own status, to prove a status off the template's board is refused.
    otherBoardId = uuidv4();
    await tenantTable('boards').insert({
      board_id: otherBoardId, board_name: `Other board ${otherBoardId}`, tenant: env.tenant, display_order: 98,
    });
  });

  afterAll(async () => {
    if (env) {
      await tenantTable('ticket_templates').where({ client_id: otherClientId }).delete();
      await tenantTable('clients').where({ client_id: otherClientId }).delete();
      await tenantTable('statuses').where({ board_id: otherBoardId }).delete();
      await tenantTable('boards').where({ board_id: otherBoardId }).delete();
      await env.cleanup();
    }
  });

  describe('CRUD round trip', () => {
    it('creates, reads, lists, updates and deletes a template with its checklist', async () => {
      const body = templateBody();
      const created = await env.apiClient.post(API_BASE, body);
      assertSuccess(created, 201);
      const templateId = created.data.data.template_id;
      expect(created.data.data).toMatchObject({ name: body.name, title: body.title, client_id: null, is_active: true });
      expect(created.data.data.checklist.map((item: any) => item.item_name)).toEqual(['Create accounts', 'Order laptop']);
      expect(created.data.data.tags).toEqual(['onboarding']);

      const read = await env.apiClient.get(`${API_BASE}/${templateId}`);
      assertSuccess(read);
      expect(read.data.data.template_id).toBe(templateId);
      expect(read.data.data.checklist).toHaveLength(2);

      const listed = await env.apiClient.get(`${API_BASE}?limit=100`);
      assertSuccess(listed);
      expect(listed.data.data.some((row: any) => row.template_id === templateId)).toBe(true);
      expect(listed.data.pagination.total).toBeGreaterThan(0);

      const updated = await env.apiClient.put(`${API_BASE}/${templateId}`, {
        ...body,
        title: 'Onboard a case manager',
        checklist: [{ item_name: 'Create accounts', is_required: true }],
      });
      assertSuccess(updated);
      expect(updated.data.data.title).toBe('Onboard a case manager');
      // The checklist is replaced wholesale, not merged.
      expect(updated.data.data.checklist.map((item: any) => item.item_name)).toEqual(['Create accounts']);

      const deactivated = await env.apiClient.put(`${API_BASE}/${templateId}`, { ...body, is_active: false });
      assertSuccess(deactivated);
      expect(deactivated.data.data.is_active).toBe(false);
      const activeOnly = await env.apiClient.get(`${API_BASE}?limit=100`);
      expect(activeOnly.data.data.some((row: any) => row.template_id === templateId)).toBe(false);
      const inactiveOnly = await env.apiClient.get(`${API_BASE}?is_active=false&limit=100`);
      expect(inactiveOnly.data.data.some((row: any) => row.template_id === templateId)).toBe(true);

      const deleted = await env.apiClient.delete(`${API_BASE}/${templateId}`);
      expect(deleted.status).toBe(204);
      assertError(await env.apiClient.get(`${API_BASE}/${templateId}`), 404);
      expect(await tenantTable('ticket_template_checklist_items').where({ template_id: templateId }).first()).toBeUndefined();
    });

    it('refuses a second active template with the same name', async () => {
      const first = await createTemplate();
      const duplicate = await env.apiClient.post(API_BASE, templateBody({ name: first.name }));
      assertError(duplicate, 409);
    });

    it('refuses a board that does not exist, and an unknown template id', async () => {
      assertError(await env.apiClient.post(API_BASE, templateBody({ board_id: uuidv4() })), 400);
      assertError(await env.apiClient.get(`${API_BASE}/${uuidv4()}`), 404);
      assertError(await env.apiClient.get(`${API_BASE}/not-a-uuid`), 400);
    });
  });

  describe('Client scope', () => {
    it('lists tenant-wide templates plus the filtered client’s own', async () => {
      const tenantWide = await createTemplate();
      const mine = await createTemplate({ client_id: env.clientId });
      const theirs = await createTemplate({ client_id: otherClientId });

      const filtered = await env.apiClient.get(`${API_BASE}?client_id=${env.clientId}&limit=100`);
      assertSuccess(filtered);
      const ids = filtered.data.data.map((row: any) => row.template_id);
      expect(ids).toContain(tenantWide.template_id);
      expect(ids).toContain(mine.template_id);
      expect(ids).not.toContain(theirs.template_id);

      const scoped = filtered.data.data.find((row: any) => row.template_id === mine.template_id);
      expect(scoped.client_id).toBe(env.clientId);
      expect(scoped.client_name).toBeTruthy();
    });

    it('refuses a client_id that does not exist', async () => {
      assertError(await env.apiClient.post(API_BASE, templateBody({ client_id: uuidv4() })), 400);
    });
  });

  describe('Instantiate', () => {
    it('creates a ticket with the template’s checklist, tags and provenance', async () => {
      const template = await createTemplate();

      const response = await env.apiClient.post(`${API_BASE}/${template.template_id}/instantiate`, {
        client_id: env.clientId,
        status_id: defaultStatusId,
        due_date: '2026-12-01',
      });
      assertSuccess(response, 201);
      const ticket = response.data.data;
      expect(ticket.ticket_id).toBeDefined();
      expect(ticket.status_id).toBe(defaultStatusId);
      expect(ticket.ticket_number).toBeDefined();
      expect(ticket.client_id).toBe(env.clientId);
      expect(ticket.created_from_template_id).toBe(template.template_id);
      // {{client}} is filled in from the client the ticket is for.
      expect(ticket.title).toContain('Onboard a new case manager for');
      expect(ticket.title).not.toContain('{{client}}');

      const checklist = await tenantTable('ticket_checklist_items')
        .where({ ticket_id: ticket.ticket_id })
        .orderBy('order_number', 'asc');
      expect(checklist.map((item: any) => item.item_name)).toEqual(['Create accounts', 'Order laptop']);

      const tags = await tenantTable('tag_mappings').where({ tagged_id: ticket.ticket_id, tagged_type: 'ticket' });
      expect(tags).toHaveLength(1);
    });

    it('refuses a client-bound template used for another client, without a 500', async () => {
      const template = await createTemplate({ client_id: otherClientId });
      const response = await env.apiClient.post(`${API_BASE}/${template.template_id}/instantiate`, {
        client_id: env.clientId,
      });
      expect([400, 404]).toContain(response.status);
      expect(response.data.error.message).toMatch(/different client/i);
      expect(await tenantTable('tickets').where({ created_from_template_id: template.template_id }).first()).toBeUndefined();
    });

    it('refuses a status that does not belong to the template’s board, like POST /tickets does', async () => {
      const template = await createTemplate();
      const offBoardStatusId = uuidv4();
      await tenantTable('statuses').insert({
        status_id: offBoardStatusId, tenant: env.tenant, name: 'Off board',
        status_type: 'ticket', item_type: 'ticket', board_id: otherBoardId,
        order_number: 1, created_by: env.userId, created_at: new Date(),
        is_closed: false, is_default: false,
      });

      const response = await env.apiClient.post(`${API_BASE}/${template.template_id}/instantiate`, {
        client_id: env.clientId,
        status_id: offBoardStatusId,
      });
      assertError(response, 400);
      expect(await tenantTable('tickets').where({ created_from_template_id: template.template_id }).first()).toBeUndefined();
    });

    it('refuses an unknown template and an unknown client', async () => {
      const template = await createTemplate();
      assertError(await env.apiClient.post(`${API_BASE}/${uuidv4()}/instantiate`, { client_id: env.clientId }), 404);
      assertError(await env.apiClient.post(`${API_BASE}/${template.template_id}/instantiate`, { client_id: uuidv4() }), 404);
    });
  });

  describe('Permissions', () => {
    it('refuses every template endpoint without ticket_template grants', async () => {
      const template = await createTemplate();
      const denied = await clientWithPermissions([]);

      assertError(await denied.get(API_BASE), 403);
      assertError(await denied.get(`${API_BASE}/${template.template_id}`), 403);
      assertError(await denied.post(API_BASE, templateBody()), 403);
      assertError(await denied.put(`${API_BASE}/${template.template_id}`, templateBody()), 403);
      assertError(await denied.delete(`${API_BASE}/${template.template_id}`), 403);
      assertError(await denied.post(`${API_BASE}/${template.template_id}/instantiate`, { client_id: env.clientId }), 403);
      expect(await tenantTable('ticket_templates').where({ template_id: template.template_id }).first()).toBeTruthy();
    });

    it('lets a reader read but not write', async () => {
      const template = await createTemplate();
      const reader = await clientWithPermissions(['ticket_template:read']);

      assertSuccess(await reader.get(`${API_BASE}/${template.template_id}`));
      assertError(await reader.post(API_BASE, templateBody()), 403);
      assertError(await reader.delete(`${API_BASE}/${template.template_id}`), 403);
      // Instantiate needs ticket:create as well as template read.
      assertError(await reader.post(`${API_BASE}/${template.template_id}/instantiate`, { client_id: env.clientId }), 403);

      const creator = await clientWithPermissions(['ticket_template:read', 'ticket:create', 'ticket:read']);
      assertSuccess(await creator.post(`${API_BASE}/${template.template_id}/instantiate`, { client_id: env.clientId }), 201);
    });
  });
});
