import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tenantDb } from '@alga-psa/db';
import { generateRecurringTicketsForTenant } from '@alga-psa/tickets/lib/recurring/generateRecurringTicketsForTenant';
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
 * Recurring ticket definitions over REST (alga-2026-0002909): the done-when path an MCP client takes
 * (template -> yearly definition -> add client -> pause/resume -> upcoming -> occurrences), RBAC,
 * archive semantics, validation and tenant isolation.
 */
describe('Recurring Ticket API E2E Tests', () => {
  let env: E2ETestEnvironment;
  const API_BASE = '/api/v1/tickets/recurring';
  const TEMPLATE_BASE = '/api/v1/tickets/templates';
  let boardId: string;
  let priorityId: string;
  let clientId: string;
  const createdDefinitionIds: string[] = [];

  function tenantTable(table: string) {
    return tenantDb(env.db, env.tenant).table(table);
  }

  async function clientWithPermissions(permissions: string[]) {
    const userId = await createTestUserWithPermissions(env.db, env.tenant, permissions);
    const key = await createTestApiKey(env.db, userId, env.tenant);
    return new ApiTestClient({ baseUrl: env.apiClient['config'].baseUrl, apiKey: key.api_key });
  }

  async function createTemplate() {
    const response = await env.apiClient.post(TEMPLATE_BASE, {
      name: `APNs renewal ${uuidv4()}`,
      title: 'Renew the Apple APNs certificate for {{client}}',
      board_id: boardId,
      priority_id: priorityId,
      offer_for_manual_use: false,
    });
    assertSuccess(response, 201);
    return response.data.data.template_id as string;
  }

  function definitionBody(templateId: string, overrides: Record<string, unknown> = {}) {
    return {
      name: `Apple APNs certificate renewal ${uuidv4()}`,
      ticket_template_id: templateId,
      recurrence: { frequency: 'yearly', month: 3, day: 1, end: { type: 'never' } },
      start_date: '2027-03-01',
      lead_days: 30,
      non_business_day_policy: 'previous',
      ...overrides,
    };
  }

  async function createDefinition(overrides: Record<string, unknown> = {}) {
    const templateId = await createTemplate();
    const response = await env.apiClient.post(API_BASE, definitionBody(templateId, overrides));
    assertSuccess(response, 201);
    createdDefinitionIds.push(response.data.data.definition.definition_id);
    return { templateId, detail: response.data.data };
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
    const priority = await tenantTable('priorities').where({ item_type: 'ticket' }).first();
    priorityId = priority?.priority_id ?? uuidv4();

    clientId = uuidv4();
    await tenantTable('clients').insert({
      client_id: clientId, tenant: env.tenant, client_name: `Joymode ${clientId}`,
      client_type: 'company', created_at: new Date(), updated_at: new Date(),
    });
  });

  afterAll(async () => {
    if (env) {
      await tenantTable('recurring_ticket_occurrences').whereIn('definition_id', createdDefinitionIds).delete();
      await tenantTable('recurring_ticket_definition_clients').whereIn('definition_id', createdDefinitionIds).delete();
      await tenantTable('recurring_ticket_definitions').whereIn('definition_id', createdDefinitionIds).delete();
      await env.cleanup();
    }
  });

  describe('done-when path', () => {
    it('creates a yearly APNs definition, adds the client, pauses, resumes, and reads upcoming and occurrences', async () => {
      const { detail } = await createDefinition();
      const id = detail.definition.definition_id;
      expect(detail.definition).toMatchObject({
        recurrence: { frequency: 'yearly', month: 3, day: 1, end: { type: 'never' } },
        lead_days: 30, is_active: true, create_time: '08:00', due_time: '17:00',
      });
      expect(detail.clients).toEqual([]);

      const added = await env.apiClient.post(`${API_BASE}/${id}/clients`, { client_ids: [clientId] });
      assertSuccess(added);
      expect(added.data.data.added).toBe(1);
      expect(added.data.data.clients.map((c: any) => c.client_id)).toEqual([clientId]);

      // Idempotent: adding again reports 0.
      const again = await env.apiClient.post(`${API_BASE}/${id}/clients`, { client_ids: [clientId] });
      assertSuccess(again);
      expect(again.data.data.added).toBe(0);

      const upcoming = await env.apiClient.get(`${API_BASE}/${id}/upcoming`);
      assertSuccess(upcoming);
      expect(upcoming.data.data.occurrences).toHaveLength(5);
      expect(upcoming.data.data.definition_status).toBe('active');
      const years = upcoming.data.data.occurrences.map((o: any) => Number(String(o.nominal).slice(0, 4)));
      expect(years).toEqual([years[0], years[0] + 1, years[0] + 2, years[0] + 3, years[0] + 4]);

      const paused = await env.apiClient.post(`${API_BASE}/${id}/pause`);
      assertSuccess(paused);
      expect(paused.data.data.definition.is_active).toBe(false);
      const pausedRead = await env.apiClient.get(`${API_BASE}/${id}`);
      expect(pausedRead.data.data.definition.is_active).toBe(false);

      const pausedUpcoming = await env.apiClient.get(`${API_BASE}/${id}/upcoming`);
      expect(pausedUpcoming.data.data.definition_status).toBe('paused');

      const resumed = await env.apiClient.post(`${API_BASE}/${id}/resume`);
      assertSuccess(resumed);
      expect(resumed.data.data.definition.is_active).toBe(true);

      // No backfill: resume moved the watermark to "now".
      const row = await tenantTable('recurring_ticket_definition_clients').where({ definition_id: id, client_id: clientId }).first();
      expect(new Date(row.evaluated_through).getTime()).toBeGreaterThan(Date.now() - 60_000);

      // Run the generator with a clock inside the lead window (30 days before 2027-03-01).
      const summary = await generateRecurringTicketsForTenant(env.db, env.tenant, {
        timeZone: 'UTC',
        now: new Date('2027-02-15T12:00:00Z'),
      });
      expect(summary.created).toBeGreaterThanOrEqual(1);

      const occurrences = await env.apiClient.get(`${API_BASE}/${id}/occurrences?status=created`);
      assertSuccess(occurrences);
      expect(occurrences.data.data).toHaveLength(1);
      expect(occurrences.data.data[0]).toMatchObject({ status: 'created', client_id: clientId });
      expect(occurrences.data.data[0].ticket_number).toBeTruthy();
      expect(occurrences.data.pagination.total).toBe(1);

      const listed = await env.apiClient.get(`${API_BASE}?status=active&search=apns&limit=100`);
      assertSuccess(listed);
      expect(listed.data.data.some((row: any) => row.definition_id === id)).toBe(true);
    });

    it('addresses clients by client_id and refuses a client that is not on the definition', async () => {
      const { detail } = await createDefinition();
      const id = detail.definition.definition_id;
      assertSuccess(await env.apiClient.post(`${API_BASE}/${id}/clients`, { client_ids: [clientId] }));

      const paused = await env.apiClient.post(`${API_BASE}/${id}/clients/${clientId}/pause`);
      assertSuccess(paused);
      expect(paused.data.data.clients[0].is_active).toBe(false);
      const resumed = await env.apiClient.post(`${API_BASE}/${id}/clients/${clientId}/resume`);
      assertSuccess(resumed);
      expect(resumed.data.data.clients[0].is_active).toBe(true);

      const updated = await env.apiClient.put(`${API_BASE}/${id}/clients/${clientId}`, {
        overrides: {}, contact_id: null, location_id: null, asset_ids: [],
      });
      assertSuccess(updated);

      // A client of another definition is not addressable through this one.
      const { detail: other } = await createDefinition();
      assertError(
        await env.apiClient.post(`${API_BASE}/${other.definition.definition_id}/clients/${clientId}/pause`),
        404,
      );

      assertSuccess(await env.apiClient.delete(`${API_BASE}/${id}/clients/${clientId}`), 204);
      const after = await env.apiClient.get(`${API_BASE}/${id}`);
      expect(after.data.data.clients).toEqual([]);
    });

    it('previews an unsaved schedule', async () => {
      const response = await env.apiClient.post(`${API_BASE}/preview`, {
        recurrence: { frequency: 'yearly', month: 3, day: 1, end: { type: 'never' } },
        start_date: '2027-03-01', create_time: '08:00', due_time: '17:00', lead_days: 30,
        non_business_day_policy: 'keep',
      });
      assertSuccess(response);
      expect(response.data.data.occurrences).toHaveLength(5);
    });
  });

  describe('RBAC', () => {
    it('lets a read-only key read and refuses every write with 403', async () => {
      const { detail } = await createDefinition();
      const id = detail.definition.definition_id;
      const reader = await clientWithPermissions(['recurring_ticket:read']);

      assertSuccess(await reader.get(API_BASE));
      assertSuccess(await reader.get(`${API_BASE}/${id}`));
      assertSuccess(await reader.get(`${API_BASE}/${id}/upcoming`));
      assertSuccess(await reader.get(`${API_BASE}/${id}/occurrences`));

      const templateId = detail.definition.ticket_template_id;
      assertError(await reader.post(API_BASE, definitionBody(templateId)), 403);
      assertError(await reader.put(`${API_BASE}/${id}`, definitionBody(templateId)), 403);
      assertError(await reader.delete(`${API_BASE}/${id}`), 403);
      assertError(await reader.post(`${API_BASE}/${id}/pause`), 403);
      assertError(await reader.post(`${API_BASE}/${id}/resume`), 403);
      assertError(await reader.post(`${API_BASE}/${id}/clients`, { client_ids: [clientId] }), 403);
    });

    it('refuses create without ticket_template:read', async () => {
      const templateId = await createTemplate();
      const creator = await clientWithPermissions(['recurring_ticket:create']);
      assertError(await creator.post(API_BASE, definitionBody(templateId)), 403);
    });
  });

  describe('archive', () => {
    it('archives with DELETE, keeps it readable, and refuses further writes with 409', async () => {
      const { detail } = await createDefinition();
      const id = detail.definition.definition_id;

      assertSuccess(await env.apiClient.delete(`${API_BASE}/${id}`), 204);
      const read = await env.apiClient.get(`${API_BASE}/${id}`);
      assertSuccess(read);
      expect(read.data.data.definition.archived_at).toBeTruthy();

      const templateId = detail.definition.ticket_template_id;
      assertError(await env.apiClient.put(`${API_BASE}/${id}`, definitionBody(templateId)), 409);
      assertError(await env.apiClient.post(`${API_BASE}/${id}/pause`), 409);
      assertError(await env.apiClient.post(`${API_BASE}/${id}/clients`, { client_ids: [clientId] }), 409);
    });
  });

  describe('validation', () => {
    it('rejects an unknown body key such as title with 400', async () => {
      const templateId = await createTemplate();
      assertError(await env.apiClient.post(API_BASE, { ...definitionBody(templateId), title: 'nope' }), 400);
    });

    it('rejects a template that does not exist with 400', async () => {
      assertError(await env.apiClient.post(API_BASE, definitionBody(uuidv4())), 400);
    });

    it('rejects an add-clients call for a client that does not exist with 400', async () => {
      const { detail } = await createDefinition();
      assertError(
        await env.apiClient.post(`${API_BASE}/${detail.definition.definition_id}/clients`, { client_ids: [uuidv4()] }),
        400,
      );
    });
  });

  describe('not found', () => {
    it('returns 404 for a definition id that does not exist in this tenant', async () => {
      // A definition of another tenant is indistinguishable from an unknown id: every read is tenant-scoped.
      const unknown = uuidv4();
      assertError(await env.apiClient.get(`${API_BASE}/${unknown}`), 404);
      assertError(await env.apiClient.get(`${API_BASE}/${unknown}/occurrences`), 404);
      assertError(await env.apiClient.post(`${API_BASE}/${unknown}/pause`), 404);
    });
  });
});
