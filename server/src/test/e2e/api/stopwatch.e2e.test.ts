import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tenantDb } from '@alga-psa/db';
import { setupE2ETestEnvironment, E2ETestEnvironment } from '../utils/e2eTestSetup';
import { assertSuccess, assertError } from '../utils/apiTestHelpers';
import { createTestTimePeriod, createTestService } from '../utils/timeEntryTestDataFactory';
import { createTestTicket } from '../utils/ticketTestData';
import { v4 as uuidv4 } from 'uuid';

const API_BASE = '/api/v1/stopwatch';
const LEGACY_BASE = '/api/v1/time-entries';

/**
 * Server-side stopwatch REST API. Requires the app server (TEST_API_BASE_URL) and the e2e database.
 * Service-layer behaviour is also covered by the runnable integration test
 * server/src/test/integration/stopwatch/stopwatchApiService.integration.test.ts.
 */
describe('Stopwatch API E2E Tests', () => {
  let env: E2ETestEnvironment;

  async function seedWorkItem() {
    const ticket = await createTestTicket(env.db, env.tenant, {
      client_id: env.clientId,
      entered_by: env.userId,
      assigned_to: env.userId,
    });
    const service = await createTestService(env.db, env.tenant);
    return { ticket, service };
  }

  async function startSession(notes = 'Starting work') {
    const { ticket, service } = await seedWorkItem();
    const response = await env.apiClient.post(API_BASE, {
      work_item_type: 'ticket',
      work_item_id: ticket.ticket_id,
      service_id: service.service_id,
      notes,
    });
    return { ticket, service, response };
  }

  beforeEach(async () => {
    env = await setupE2ETestEnvironment();
    const now = new Date();
    const pad2 = (n: number) => String(n).padStart(2, '0');
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    await createTestTimePeriod(env.db, env.tenant, {
      start_date: `${year}-${pad2(month)}-01`,
      end_date: month === 12 ? `${year + 1}-01-01` : `${year}-${pad2(month + 1)}-01`,
      is_closed: false,
    });
  });

  afterEach(async () => {
    await env.cleanup();
  });

  describe('Authentication and RBAC', () => {
    it('requires an API key on every route', async () => {
      const base = env.apiClient['config'].baseUrl;
      const headers = { 'Content-Type': 'application/json' };
      const probes: Array<[string, string]> = [
        ['GET', `${API_BASE}/active`],
        ['POST', API_BASE],
        ['POST', `${API_BASE}/${uuidv4()}/pause`],
        ['POST', `${API_BASE}/${uuidv4()}/resume`],
        ['PATCH', `${API_BASE}/${uuidv4()}`],
        ['POST', `${API_BASE}/${uuidv4()}/log`],
        ['DELETE', `${API_BASE}/${uuidv4()}`],
      ];
      for (const [method, path] of probes) {
        const response = await fetch(`${base}${path}`, { method, headers, body: method === 'GET' || method === 'DELETE' ? undefined : '{}' });
        expect(response.status, `${method} ${path}`).toBe(401);
      }
    });

    it("does not expose another user's active session without delegation", async () => {
      const { response } = await startSession();
      assertSuccess(response, 201);
      const other = uuidv4();
      const read = await env.apiClient.get(`${API_BASE}/active`, { params: { user_id: other } });
      expect([403, 404]).toContain(read.status);
    });
  });

  describe('Start (POST /api/v1/stopwatch)', () => {
    it('creates a running session and returns the session view', async () => {
      const { ticket, service, response } = await startSession('api notes');
      assertSuccess(response, 201);
      expect(response.data.data).toMatchObject({
        session_id: expect.any(String),
        user_id: env.userId,
        work_item_type: 'ticket',
        work_item_id: ticket.ticket_id,
        service_id: service.service_id,
        notes: 'api notes',
        status: 'running',
        time_entry_id: null,
        closed_at: null,
        segments: [{ segment_id: expect.any(String), started_at: expect.any(String), ended_at: null }],
        active_ms: expect.any(Number),
        server_now: expect.any(String),
      });
    });

    it('validates the body', async () => {
      const response = await env.apiClient.post(API_BASE, { work_item_type: 'nope', work_item_id: 'not-a-uuid' });
      assertError(response, 400);
    });

    it('returns 409 with the open session when one already exists', async () => {
      const first = await startSession();
      assertSuccess(first.response, 201);
      const second = await env.apiClient.post(API_BASE, {
        work_item_type: 'ticket',
        work_item_id: first.ticket.ticket_id,
        service_id: first.service.service_id,
      });
      assertError(second, 409);
      expect(second.data.error.details).toMatchObject({
        reason: 'open_session_exists',
        open_session: { session_id: first.response.data.data.session_id },
      });
    });

    it('returns 404 for an unknown work item', async () => {
      const { service } = await seedWorkItem();
      const response = await env.apiClient.post(API_BASE, {
        work_item_type: 'ticket',
        work_item_id: uuidv4(),
        service_id: service.service_id,
      });
      assertError(response, 404);
    });
  });

  describe('Active (GET /api/v1/stopwatch/active)', () => {
    it('returns null data when nothing is open, then the open session', async () => {
      const empty = await env.apiClient.get(`${API_BASE}/active`);
      assertSuccess(empty);
      expect(empty.data.data).toBeNull();

      const { response } = await startSession();
      const active = await env.apiClient.get(`${API_BASE}/active`);
      assertSuccess(active);
      expect(active.data.data.session_id).toBe(response.data.data.session_id);
    });
  });

  describe('Pause / resume / update', () => {
    it('pauses and resumes idempotently', async () => {
      const { response } = await startSession();
      const id = response.data.data.session_id;

      const paused = await env.apiClient.post(`${API_BASE}/${id}/pause`);
      assertSuccess(paused);
      expect(paused.data.data.status).toBe('paused');
      expect(paused.data.data.segments.every((s: any) => s.ended_at !== null)).toBe(true);
      assertSuccess(await env.apiClient.post(`${API_BASE}/${id}/pause`));

      const resumed = await env.apiClient.post(`${API_BASE}/${id}/resume`);
      assertSuccess(resumed);
      expect(resumed.data.data.status).toBe('running');
      expect(resumed.data.data.segments).toHaveLength(2);
    });

    it('updates the draft notes and service', async () => {
      const { response } = await startSession();
      const id = response.data.data.session_id;
      const updated = await env.apiClient.patch(`${API_BASE}/${id}`, { notes: 'edited', service_id: null });
      assertSuccess(updated);
      expect(updated.data.data).toMatchObject({ notes: 'edited', service_id: null });
    });

    it('returns 404 for an unknown session and 400 for a malformed id', async () => {
      assertError(await env.apiClient.post(`${API_BASE}/${uuidv4()}/pause`), 404);
      assertError(await env.apiClient.post(`${API_BASE}/not-a-uuid/pause`), 400);
    });
  });

  describe('Log (POST /api/v1/stopwatch/{id}/log)', () => {
    it('logs the session as one time entry and returns { session, time_entry }', async () => {
      const { ticket, service, response } = await startSession('to log');
      const id = response.data.data.session_id;

      const logged = await env.apiClient.post(`${API_BASE}/${id}/log`, {});
      assertSuccess(logged, 201);
      expect(logged.data.data.session).toMatchObject({ session_id: id, status: 'logged' });
      expect(logged.data.data.time_entry).toMatchObject({
        entry_id: logged.data.data.session.time_entry_id,
        user_id: env.userId,
        work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
        service_id: service.service_id,
        notes: 'to log',
        time_sheet_id: expect.any(String),
      });

      // The session is closed for good.
      assertError(await env.apiClient.post(`${API_BASE}/${id}/log`, {}), 409);
      const active = await env.apiClient.get(`${API_BASE}/active`);
      expect(active.data.data).toBeNull();
    });

    it('returns 409 when the resolved time sheet is locked and keeps the session open', async () => {
      const { response } = await startSession();
      const id = response.data.data.session_id;
      assertSuccess(await env.apiClient.post(`${API_BASE}/${id}/pause`));

      await tenantDb(env.db, env.tenant).table('time_sheets').where({ user_id: env.userId }).delete();
      const period = await tenantDb(env.db, env.tenant).table('time_periods').first();
      await tenantDb(env.db, env.tenant).table('time_sheets').insert({
        id: uuidv4(),
        tenant: env.tenant,
        period_id: period.period_id,
        user_id: env.userId,
        approval_status: 'SUBMITTED',
      });

      const logged = await env.apiClient.post(`${API_BASE}/${id}/log`, {});
      assertError(logged, 409);
      expect(logged.data.error.details.reason).toContain('sheetLocked');

      const active = await env.apiClient.get(`${API_BASE}/active`);
      assertSuccess(active);
      expect(active.data.data).toMatchObject({ session_id: id, status: 'paused' });
    });
  });

  describe('Discard (DELETE /api/v1/stopwatch/{id})', () => {
    it('discards the session with 204 and a second discard is a 409', async () => {
      const { response } = await startSession();
      const id = response.data.data.session_id;
      const discarded = await env.apiClient.delete(`${API_BASE}/${id}`);
      expect(discarded.status).toBe(204);

      const active = await env.apiClient.get(`${API_BASE}/active`);
      expect(active.data.data).toBeNull();
      assertError(await env.apiClient.delete(`${API_BASE}/${id}`), 409);
    });
  });

  describe('Legacy adapters (D7)', () => {
    it('start-tracking / active-session / stop-tracking operate on the same stopwatch session', async () => {
      const { ticket, service } = await seedWorkItem();
      const started = await env.apiClient.post(`${LEGACY_BASE}/start-tracking`, {
        work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
        service_id: service.service_id,
        notes: 'Starting work',
      });
      assertSuccess(started, 201);
      expect(started.data.data).toMatchObject({
        session_id: expect.any(String),
        work_item_id: ticket.ticket_id,
        status: 'active',
        end_time: null,
        elapsed_minutes: expect.any(Number),
      });

      const viaNewApi = await env.apiClient.get(`${API_BASE}/active`);
      expect(viaNewApi.data.data.session_id).toBe(started.data.data.session_id);

      const paused = await env.apiClient.post(`${API_BASE}/${started.data.data.session_id}/pause`);
      assertSuccess(paused);
      const legacyActive = await env.apiClient.get(`${LEGACY_BASE}/active-session`);
      assertSuccess(legacyActive);
      expect(legacyActive.data.data).toMatchObject({ session_id: started.data.data.session_id, status: 'paused' });

      // A paused session is logged by the legacy stop too.
      const stopped = await env.apiClient.post(`${LEGACY_BASE}/stop-tracking/${started.data.data.session_id}`, {
        notes: 'Completed work',
      });
      assertSuccess(stopped, 201);
      expect(stopped.data.data).toMatchObject({
        work_item_id: ticket.ticket_id,
        service_id: service.service_id,
        notes: 'Completed work',
        billable_duration: expect.any(Number),
      });
    });
  });
});
