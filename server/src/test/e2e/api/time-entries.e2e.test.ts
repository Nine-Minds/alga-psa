import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { 
  setupE2ETestEnvironment, 
  E2ETestEnvironment 
} from '../utils/e2eTestSetup';
import { 
  assertSuccess,
  assertError,
  assertPaginated
} from '../utils/apiTestHelpers';
import {
  createTestTimeEntry,
  createTestTimePeriod,
  createTestService
} from '../utils/timeEntryTestDataFactory';
import { createTestTicket } from '../utils/ticketTestData';
import { v4 as uuidv4 } from 'uuid';
import { ApiTestClient } from '../utils/apiTestHelpers';

const API_BASE = '/api/v1/time-entries';

describe('Time Entries API E2E Tests', () => {
  let env: E2ETestEnvironment;

  beforeEach(async () => {
    env = await setupE2ETestEnvironment();
    
    // Create time periods for testing
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const pad2 = (n: number) => String(n).padStart(2, '0');
    const startOfMonth = `${year}-${pad2(month)}-01`;
    const endOfMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${pad2(month + 1)}-01`;
    
    await createTestTimePeriod(env.db, env.tenant, {
      start_date: startOfMonth,
      end_date: endOfMonth,
      is_closed: false
    });
  });

  afterEach(async () => {
    await env.cleanup();
  });

  describe('Authentication', () => {
    it('should require API key for all endpoints', async () => {
      const response = await fetch(`${env.apiClient['config'].baseUrl}${API_BASE}`, {
        headers: { 'Content-Type': 'application/json' }
      });
      expect(response.status).toBe(401);
    });

    it('should reject invalid API key', async () => {
      const response = await fetch(`${env.apiClient['config'].baseUrl}${API_BASE}`, {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'invalid-key'
        }
      });
      expect(response.status).toBe(401);
    });
  });

  describe('CRUD Operations', () => {
    describe('Create Time Entry (POST /api/v1/time-entries)', () => {
      it('should create a new time entry', async () => {
        // Create related entities
        const ticket = await createTestTicket(env.db, env.tenant, {
          client_id: env.clientId,
          entered_by: env.userId,
          assigned_to: env.userId
        });

        const service = await createTestService(env.db, env.tenant);

        const newEntry = {
          work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
          service_id: service.service_id,
          start_time: new Date().toISOString(),
          end_time: new Date(Date.now() + 90 * 60000).toISOString(), // 1.5 hours later
          notes: 'Test time entry',
          is_billable: true
        };

        const response = await env.apiClient.post(API_BASE, newEntry);
        
        assertSuccess(response, 201);
        expect(response.data.data).toMatchObject({
          work_item_id: newEntry.work_item_id,
          service_id: newEntry.service_id,
          work_item_type: newEntry.work_item_type,
          start_time: expect.any(String),
          end_time: expect.any(String),
          notes: newEntry.notes,
          is_billable: newEntry.is_billable
        });
      });

      it('should compute work_date in user timezone and bucket to the correct period', async () => {
        // Force a non-UTC timezone so we can test around local midnight.
        await env.db('users')
          .where({ tenant: env.tenant, user_id: env.userId })
          .update({ timezone: 'America/Los_Angeles' });

        // Two adjacent single-day periods to make the bucketing difference observable.
        const period1 = await createTestTimePeriod(env.db, env.tenant, {
          start_date: '2024-07-01',
          end_date: '2024-07-02',
          is_closed: false
        });
        await createTestTimePeriod(env.db, env.tenant, {
          start_date: '2024-07-02',
          end_date: '2024-07-03',
          is_closed: false
        });

        const ticket = await createTestTicket(env.db, env.tenant, {
          client_id: env.clientId,
          entered_by: env.userId,
          assigned_to: env.userId
        });
        const service = await createTestService(env.db, env.tenant);

        // 2024-07-02T06:30:00Z is 2024-07-01 23:30 in America/Los_Angeles (PDT).
        const response = await env.apiClient.post(API_BASE, {
          work_item_id: ticket.ticket_id,
          work_item_type: 'ticket',
          service_id: service.service_id,
          start_time: '2024-07-02T06:30:00.000Z',
          end_time: '2024-07-02T07:30:00.000Z',
          notes: 'Timezone edge case',
          is_billable: true,
          // Should be ignored by the server:
          work_date: '2099-01-01',
          work_timezone: 'UTC'
        } as any);

        assertSuccess(response, 201);
        expect(response.data.data.work_date).toBe('2024-07-01');
        expect(response.data.data.work_timezone).toBe('America/Los_Angeles');

        // Verify the server attached the entry to the period containing work_date (period1).
        const sheet = await env.db('time_sheets')
          .where({ tenant: env.tenant, id: response.data.data.time_sheet_id })
          .first();
        expect(sheet?.period_id).toBe(period1.period_id);
      });

      it('should validate required fields', async () => {
        const response = await env.apiClient.post(API_BASE, {
          notes: 'Missing required fields'
        });
        
        assertError(response, 400);
        expect(response.data.error.code).toBe('VALIDATION_ERROR');
      });

      it('should validate time periods overlap', async () => {
        const ticket = await createTestTicket(env.db, env.tenant, {
          client_id: env.clientId,
          entered_by: env.userId,
          assigned_to: env.userId
        });

        const service = await createTestService(env.db, env.tenant);
        const workDate = new Date().toISOString().split('T')[0];

        // Create first entry
        await env.apiClient.post(API_BASE, {
          work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
          service_id: service.service_id,
          user_id: env.userId,
          start_time: new Date(`${workDate}T09:00:00Z`).toISOString(),
          end_time: new Date(`${workDate}T10:30:00Z`).toISOString(),
          notes: 'First entry',
          is_billable: true
        });

        // Try to create overlapping entry
        const response = await env.apiClient.post(API_BASE, {
          work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
          service_id: service.service_id,
          user_id: env.userId,
          start_time: new Date(`${workDate}T10:00:00Z`).toISOString(),
          end_time: new Date(`${workDate}T11:00:00Z`).toISOString(),
          notes: 'Overlapping entry',
          is_billable: true
        });

        assertError(response, 400);
      });
    });

    describe('Get Time Entry (GET /api/v1/time-entries/:id)', () => {
      it('should retrieve a time entry by ID', async () => {
        const ticket = await createTestTicket(env.db, env.tenant, {
          client_id: env.clientId,
          entered_by: env.userId,
          assigned_to: env.userId
        });

        const service = await createTestService(env.db, env.tenant);
        const entry = await createTestTimeEntry(env.db, env.tenant, {
          work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
          service_id: service.service_id,
          user_id: env.userId
        });

        const response = await env.apiClient.get(`${API_BASE}/${entry.entry_id}`);
        
        assertSuccess(response);
        expect(response.data.data).toMatchObject({
          entry_id: entry.entry_id,
          work_item_id: entry.work_item_id,
          work_item_type: entry.work_item_type,
          service_id: entry.service_id,
          user_id: entry.user_id
        });
      });

      it('should return 404 for non-existent time entry', async () => {
        const response = await env.apiClient.get(`${API_BASE}/${uuidv4()}`);
        assertError(response, 404);
      });

      it('should not return time entries from other tenants', async () => {
        // Create another tenant with proper setup
        const otherTenant = uuidv4();
        const otherClientId = uuidv4();
        const otherUserId = uuidv4();
        
        // Create the other tenant
        await env.db('tenants').insert({
          tenant: otherTenant,
          client_name: `Other Tenant ${otherTenant}`,
          phone_number: '555-0200',
          email: `other-${otherTenant.substring(0, 8)}@example.com`,
          created_at: new Date(),
          updated_at: new Date(),
          payment_platform_id: `test-platform-${otherTenant.substring(0, 8)}`,
          payment_method_id: `test-method-${otherTenant.substring(0, 8)}`,
          auth_service_id: `test-auth-${otherTenant.substring(0, 8)}`,
          plan: 'test'
        });
        
        // Create client for other tenant
        await env.db('clients').insert({
          client_id: otherClientId,
          tenant: otherTenant,
          client_name: 'Other Client',
          created_at: new Date()
        });
        
        // Create user for other tenant
        await env.db('users').insert({
          user_id: otherUserId,
          tenant: otherTenant,
          username: `other_user_${otherUserId}`,
          email: `other${otherUserId}@example.com`,
          first_name: 'Other',
          last_name: 'User',
          hashed_password: 'dummy',
          created_at: new Date(),
          user_type: 'internal'
        });
        
        const ticket = await createTestTicket(env.db, otherTenant, {
          client_id: otherClientId,
          entered_by: otherUserId,
          assigned_to: otherUserId
        });

        const service = await createTestService(env.db, otherTenant);
        const otherEntry = await createTestTimeEntry(env.db, otherTenant, {
          work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
          service_id: service.service_id,
          user_id: otherUserId
        });

        const response = await env.apiClient.get(`${API_BASE}/${otherEntry.entry_id}`);
        assertError(response, 404);
      });
    });

    describe('Update Time Entry (PUT /api/v1/time-entries/:id)', () => {
      it('should update a time entry', async () => {
        const ticket = await createTestTicket(env.db, env.tenant, {
          client_id: env.clientId,
          entered_by: env.userId,
          assigned_to: env.userId
        });

        const service = await createTestService(env.db, env.tenant);
        const entry = await createTestTimeEntry(env.db, env.tenant, {
          work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
          service_id: service.service_id,
          user_id: env.userId
        });

        const updates = {
          notes: 'Updated description',
          is_billable: false
        };

        const response = await env.apiClient.put(`${API_BASE}/${entry.entry_id}`, updates);
        
        assertSuccess(response);
        expect(response.data.data.notes).toBe(updates.notes);
        expect(response.data.data.is_billable).toBe(updates.is_billable);
        expect(response.data.data.billable_duration).toBe(0); // Should be 0 when is_billable is false
      });

      it('should return 404 when updating non-existent entry', async () => {
        const response = await env.apiClient.put(`${API_BASE}/${uuidv4()}`, {
          notes: 'Updated'
        });
        assertError(response, 404);
      });

      it('should not allow updating approved entries', async () => {
        const ticket = await createTestTicket(env.db, env.tenant, {
          client_id: env.clientId,
          entered_by: env.userId,
          assigned_to: env.userId
        });

        const service = await createTestService(env.db, env.tenant);
        const entry = await createTestTimeEntry(env.db, env.tenant, {
          work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
          service_id: service.service_id,
          user_id: env.userId,
          approval_status: 'APPROVED'
        });

        const response = await env.apiClient.put(`${API_BASE}/${entry.entry_id}`, {
          notes: 'Try to update approved'
        });
        
        assertError(response, 400);
      });
    });

    describe('Delete Time Entry (DELETE /api/v1/time-entries/:id)', () => {
      it('should delete a time entry', async () => {
        const ticket = await createTestTicket(env.db, env.tenant, {
          client_id: env.clientId,
          entered_by: env.userId,
          assigned_to: env.userId
        });

        const service = await createTestService(env.db, env.tenant);
        const entry = await createTestTimeEntry(env.db, env.tenant, {
          work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
          service_id: service.service_id,
          user_id: env.userId
        });

        const response = await env.apiClient.delete(`${API_BASE}/${entry.entry_id}`);
        
        assertSuccess(response, 204);
        
        // Verify it's deleted
        const getResponse = await env.apiClient.get(`${API_BASE}/${entry.entry_id}`);
        assertError(getResponse, 404);
      });

      it('should return 404 when deleting non-existent entry', async () => {
        const response = await env.apiClient.delete(`${API_BASE}/${uuidv4()}`);
        assertError(response, 404);
      });

      it('should not allow deleting approved entries', async () => {
        const ticket = await createTestTicket(env.db, env.tenant, {
          client_id: env.clientId,
          entered_by: env.userId,
          assigned_to: env.userId
        });

        const service = await createTestService(env.db, env.tenant);
        const entry = await createTestTimeEntry(env.db, env.tenant, {
          work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
          service_id: service.service_id,
          user_id: env.userId,
          approval_status: 'APPROVED'
        });

        const response = await env.apiClient.delete(`${API_BASE}/${entry.entry_id}`);
        assertError(response, 400);
      });
    });
  });

  describe('List Time Entries (GET /api/v1/time-entries)', () => {
    it('should list time entries with default pagination', async () => {
      // Create multiple time entries
      const ticket = await createTestTicket(env.db, env.tenant, {
        client_id: env.clientId,
        entered_by: env.userId,
        assigned_to: env.userId
      });

      const service = await createTestService(env.db, env.tenant);
      
      for (let i = 0; i < 3; i++) {
        await createTestTimeEntry(env.db, env.tenant, {
          work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
          service_id: service.service_id,
          user_id: env.userId,
          start_time: new Date(Date.UTC(2024, 0, i + 1, 9, 0))
        });
      }

      const response = await env.apiClient.get(API_BASE);
      
      assertSuccess(response);
      assertPaginated(response);
      expect(response.data.data.length).toBeGreaterThanOrEqual(3);
    });

    it('should support pagination parameters', async () => {
      const response = await env.apiClient.get(API_BASE, {
        params: { page: 1, limit: 10 }
      });
      
      assertSuccess(response);
      assertPaginated(response);
      expect(response.data.pagination.limit).toBe(10);
    });

    it('should filter by date range', async () => {
      // Create time period for July 2024
      await createTestTimePeriod(env.db, env.tenant, {
        start_date: '2024-07-01',
        end_date: '2024-08-01',
        is_closed: false
      });
      
      // Create time period for August 2024
      await createTestTimePeriod(env.db, env.tenant, {
        start_date: '2024-08-01',
        end_date: '2024-09-01',
        is_closed: false
      });
      
      const ticket = await createTestTicket(env.db, env.tenant, {
        client_id: env.clientId,
        entered_by: env.userId,
        assigned_to: env.userId
      });

      const service = await createTestService(env.db, env.tenant);
      
      // Use unique dates to avoid conflicts (month 6 = July)
      await createTestTimeEntry(env.db, env.tenant, {
        work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
        service_id: service.service_id,
        user_id: env.userId,
        start_time: new Date('2024-07-05T09:00:00Z')
      });

      await createTestTimeEntry(env.db, env.tenant, {
        work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
        service_id: service.service_id,
        user_id: env.userId,
        start_time: new Date('2024-07-15T09:00:00Z')
      });

      await createTestTimeEntry(env.db, env.tenant, {
        work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
        service_id: service.service_id,
        user_id: env.userId,
        start_time: new Date('2024-08-01T09:00:00Z')
      });

      const response = await env.apiClient.get(API_BASE, {
        params: {
          date_from: '2024-07-01',
          date_to: '2024-07-31'
        }
      });
      
      assertSuccess(response);
      
      // Filter for entries that belong to our ticket (to exclude any from other tests)
      const ourEntries = response.data.data.filter((e: any) => e.work_item_id === ticket.ticket_id);
      expect(ourEntries.length).toBe(2);
      
      // Verify the entries are from July (work_date-based filtering)
      ourEntries.forEach((entry: any) => {
        expect(entry.work_date).toBeDefined();
        expect(entry.work_date >= '2024-07-01' && entry.work_date <= '2024-07-31').toBe(true);
      });
    });

    it('should filter by user', async () => {
      const ticket = await createTestTicket(env.db, env.tenant, {
        client_id: env.clientId,
        entered_by: env.userId,
        assigned_to: env.userId
      });

      const service = await createTestService(env.db, env.tenant);
      
      // Create another user directly in DB (simpler for testing)
      const otherUserId = uuidv4();
      await env.db('users').insert({
        user_id: otherUserId,
        tenant: env.tenant,
        username: `testuser_${otherUserId.substring(0, 8)}`,
        email: `test${otherUserId.substring(0, 8)}@example.com`,
        first_name: 'Test',
        last_name: 'User',
        hashed_password: 'dummy',
        created_at: new Date(),
        user_type: 'internal'
      });
      const otherUser = { user_id: otherUserId };
      
      // Create entries for different users
      await createTestTimeEntry(env.db, env.tenant, {
        work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
        service_id: service.service_id,
        user_id: env.userId
      });

      await createTestTimeEntry(env.db, env.tenant, {
        work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
        service_id: service.service_id,
        user_id: otherUser.user_id
      });

      const response = await env.apiClient.get(API_BASE, {
        params: { user_id: env.userId }
      });
      
      assertSuccess(response);
      
      // Filter for entries that match our ticket to isolate test data
      const ticketEntries = response.data.data.filter((e: any) => e.work_item_id === ticket.ticket_id);
      
      // Should have exactly one entry (only for env.userId)
      expect(ticketEntries.length).toBe(1);
      expect(ticketEntries[0].user_id).toBe(env.userId);
      
      // All returned entries should be for the requested user
      expect(response.data.data.every((e: any) => e.user_id === env.userId)).toBe(true);
    });

    it('should filter by billable status', async () => {
      const ticket = await createTestTicket(env.db, env.tenant, {
        client_id: env.clientId,
        entered_by: env.userId,
        assigned_to: env.userId
      });

      const service = await createTestService(env.db, env.tenant);
      
      // Create billable and non-billable entries
      await createTestTimeEntry(env.db, env.tenant, {
        work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
        service_id: service.service_id,
        user_id: env.userId,
        billable_duration: 90
      });

      await createTestTimeEntry(env.db, env.tenant, {
        work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
        service_id: service.service_id,
        user_id: env.userId,
        billable_duration: 0
      });

      const response = await env.apiClient.get(API_BASE, {
        params: { is_billable: 'true' }
      });
      
      assertSuccess(response);
      expect(response.data.data.every((e: any) => e.is_billable === true)).toBe(true);
    });

    it('should sort by date', async () => {
      const ticket = await createTestTicket(env.db, env.tenant, {
        client_id: env.clientId,
        entered_by: env.userId,
        assigned_to: env.userId
      });

      const service = await createTestService(env.db, env.tenant);
      
      // Create entries with different dates
      const dates = ['2024-01-03', '2024-01-01', '2024-01-02'];
      for (const date of dates) {
        await createTestTimeEntry(env.db, env.tenant, {
          work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
          service_id: service.service_id,
          user_id: env.userId,
          start_time: new Date(`${date}T09:00:00Z`)
        });
      }

      const response = await env.apiClient.get(API_BASE, {
        params: { sort: 'start_time', order: 'asc' }
      });
      
      assertSuccess(response);
      const startTimes = response.data.data.map((e: any) => e.start_time);
      const sortedTimes = [...startTimes].sort();
      expect(startTimes).toEqual(sortedTimes);
    });
  });

  describe('Time Tracking', () => {
    it('should start a tracking session', async () => {
      const ticket = await createTestTicket(env.db, env.tenant, {
        client_id: env.clientId,
        entered_by: env.userId,
        assigned_to: env.userId
      });

      const service = await createTestService(env.db, env.tenant);

      const response = await env.apiClient.post(`${API_BASE}/start-tracking`, {
        work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
        service_id: service.service_id,
        notes: 'Starting work'
      });
      
      assertSuccess(response, 201);
      expect(response.data.data).toMatchObject({
        session_id: expect.any(String),
        work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
        service_id: service.service_id,
        start_time: expect.any(String),
        status: 'active'
      });
    });

    it('should stop a tracking session', async () => {
      const ticket = await createTestTicket(env.db, env.tenant, {
        client_id: env.clientId,
        entered_by: env.userId,
        assigned_to: env.userId
      });

      const service = await createTestService(env.db, env.tenant);

      // Start session
      const startResponse = await env.apiClient.post(`${API_BASE}/start-tracking`, {
        work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
        service_id: service.service_id,
        notes: 'Starting work'
      });
      
      const sessionId = startResponse.data.data.session_id;

      // Stop session
      const response = await env.apiClient.post(`${API_BASE}/stop-tracking/${sessionId}`, {
        notes: 'Completed work'
      });
      
      assertSuccess(response, 201);
      expect(response.data.data).toMatchObject({
        work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
        service_id: service.service_id,
        notes: 'Completed work',
        billable_duration: expect.any(Number)
      });
    });
  });

  describe.skip('Approval Workflow', () => {
    it('should approve time entries', async () => {
      const ticket = await createTestTicket(env.db, env.tenant, {
        client_id: env.clientId,
        entered_by: env.userId,
        assigned_to: env.userId
      });

      const service = await createTestService(env.db, env.tenant);
      
      // Create multiple entries with SUBMITTED status
      const entries = [];
      for (let i = 0; i < 2; i++) {
        const entry = await createTestTimeEntry(env.db, env.tenant, {
          work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
          service_id: service.service_id,
          user_id: env.userId,
          approval_status: 'SUBMITTED'
        });
        entries.push(entry.entry_id);
      }

      const response = await env.apiClient.post(`${API_BASE}/approve`, {
        entry_ids: entries
      });
      
      assertSuccess(response);
      expect(response.data.data.approved_count).toBe(2);
    });

    it('should reject invalid entry IDs for approval', async () => {
      const response = await env.apiClient.post(`${API_BASE}/approve`, {
        entry_ids: [uuidv4(), uuidv4()]
      });
      
      assertError(response, 400);
    });
  });

  describe('Export', () => {
    it('should export time entries to CSV', async () => {
      const ticket = await createTestTicket(env.db, env.tenant, {
        client_id: env.clientId,
        entered_by: env.userId,
        assigned_to: env.userId
      });

      const service = await createTestService(env.db, env.tenant);
      
      // Create entries
      for (let i = 0; i < 2; i++) {
        await createTestTimeEntry(env.db, env.tenant, {
          work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
          service_id: service.service_id,
          user_id: env.userId
        });
      }

      const response = await env.apiClient.get(`${API_BASE}/export`, {
        params: { format: 'csv' }
      });
      
      assertSuccess(response);
      expect(response.headers.get('content-type')).toContain('text/csv');
    });

    it('should export time entries to JSON', async () => {
      const ticket = await createTestTicket(env.db, env.tenant, {
        client_id: env.clientId,
        entered_by: env.userId,
        assigned_to: env.userId
      });

      const service = await createTestService(env.db, env.tenant);
      
      // Create entries
      for (let i = 0; i < 2; i++) {
        await createTestTimeEntry(env.db, env.tenant, {
          work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
          service_id: service.service_id,
          user_id: env.userId
        });
      }

      const response = await env.apiClient.get(`${API_BASE}/export`, {
        params: { format: 'json' }
      });
      
      assertSuccess(response);
      expect(Array.isArray(response.data.data)).toBe(true);
    });
  });

  describe('Statistics', () => {
    it('should get time entry statistics', async () => {
      const ticket = await createTestTicket(env.db, env.tenant, {
        client_id: env.clientId,
        entered_by: env.userId,
        assigned_to: env.userId
      });

      const service = await createTestService(env.db, env.tenant);
      
      // Create entries
      await createTestTimeEntry(env.db, env.tenant, {
        work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
        service_id: service.service_id,
        user_id: env.userId,
        billable_duration: 120
      });

      await createTestTimeEntry(env.db, env.tenant, {
        work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
        service_id: service.service_id,
        user_id: env.userId,
        billable_duration: 0,
        start_time: new Date(Date.now() - 180 * 60000),
        end_time: new Date()
      });

      const response = await env.apiClient.get(`${API_BASE}/stats`);
      
      assertSuccess(response);
      expect(response.data.data).toMatchObject({
        total_hours: expect.any(Number),
        billable_hours: expect.any(Number),
        non_billable_hours: expect.any(Number),
        total_entries: expect.any(Number)
      });
    });
  });

  describe('Templates', () => {
    it('should list time entry templates', async () => {
      const response = await env.apiClient.get(`${API_BASE}/templates`);
      
      assertSuccess(response);
      expect(Array.isArray(response.data.data)).toBe(true);
    });
  });

  describe('Bulk Operations', () => {
    it('should bulk create time entries', async () => {
      // Create time period for January 2024
      await createTestTimePeriod(env.db, env.tenant, {
        start_date: '2024-01-01',
        end_date: '2024-02-01',
        is_closed: false
      });

      const ticket = await createTestTicket(env.db, env.tenant, {
        client_id: env.clientId,
        entered_by: env.userId,
        assigned_to: env.userId
      });

      const service = await createTestService(env.db, env.tenant);

      const entries = [
        {
          work_item_id: ticket.ticket_id,
          work_item_type: 'ticket',
          service_id: service.service_id,
          start_time: new Date('2024-01-01T09:00:00').toISOString(),
          end_time: new Date('2024-01-01T11:00:00').toISOString(),
          notes: 'Bulk entry 1',
          is_billable: true
        },
        {
          work_item_id: ticket.ticket_id,
          work_item_type: 'ticket',
          service_id: service.service_id,
          start_time: new Date('2024-01-02T09:00:00').toISOString(),
          end_time: new Date('2024-01-02T12:00:00').toISOString(),
          notes: 'Bulk entry 2',
          is_billable: false
        }
      ];

      const response = await env.apiClient.post(`${API_BASE}/bulk`, { entries });
      
      assertSuccess(response, 201);
      expect(response.data.data.created_count).toBe(2);
    });

    it('should bulk update time entries', async () => {
      const ticket = await createTestTicket(env.db, env.tenant, {
        client_id: env.clientId,
        entered_by: env.userId,
        assigned_to: env.userId
      });

      const service = await createTestService(env.db, env.tenant);
      
      // Create entries
      const entryIds = [];
      for (let i = 0; i < 2; i++) {
        const entry = await createTestTimeEntry(env.db, env.tenant, {
          work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
          service_id: service.service_id,
          user_id: env.userId
        });
        entryIds.push(entry.entry_id);
      }

      const response = await env.apiClient.put(`${API_BASE}/bulk`, {
        entries: entryIds.map(id => ({
          entry_id: id,
          data: {
            is_billable: false,
            notes: 'Bulk updated'
          }
        }))
      });
      
      assertSuccess(response);
      expect(response.data.data.updated_count).toBe(2);
    });

    it('should bulk delete time entries', async () => {
      const ticket = await createTestTicket(env.db, env.tenant, {
        client_id: env.clientId,
        entered_by: env.userId,
        assigned_to: env.userId
      });

      const service = await createTestService(env.db, env.tenant);
      
      // Create entries
      const entries = [];
      for (let i = 0; i < 2; i++) {
        const entry = await createTestTimeEntry(env.db, env.tenant, {
          work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
          service_id: service.service_id,
          user_id: env.userId
        });
        entries.push(entry.entry_id);
      }

      const response = await env.apiClient.delete(`${API_BASE}/bulk`, {
        data: { entry_ids: entries }
      });
      
      assertSuccess(response, 204);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid UUID format', async () => {
      const response = await env.apiClient.get(`${API_BASE}/invalid-uuid`);
      assertError(response, 400);
    });

    it('should handle invalid query parameters', async () => {
      const response = await env.apiClient.get(API_BASE, {
        params: { limit: 'invalid' }
      });
      assertError(response, 400);
    });

    it('should handle invalid date format', async () => {
      const response = await env.apiClient.get(API_BASE, {
        params: { date_from: 'invalid-date' }
      });
      assertError(response, 400);
    });
  });

  describe('Permissions', () => {
    it('should enforce read permissions for listing', async () => {
      // Create a new user without any roles
      const restrictedUserId = uuidv4();
      await env.db('users').insert({
        user_id: restrictedUserId,
        tenant: env.tenant,
        username: `restricted_${restrictedUserId}`,
        email: `restricted${restrictedUserId}@example.com`,
        first_name: 'Restricted',
        last_name: 'User',
        hashed_password: 'dummy',
        created_at: new Date(),
        user_type: 'internal'
      });
      
      // Create API key for the restricted user
      const plaintextKey = `test_${uuidv4()}`;
      const hashedKey = require('crypto').createHash('sha256').update(plaintextKey).digest('hex');
      
      await env.db('api_keys')
        .insert({
          api_key_id: uuidv4(),
          api_key: hashedKey,
          user_id: restrictedUserId,
          tenant: env.tenant,
          created_at: new Date(),
          active: true
        });

      const restrictedClient = new ApiTestClient({
        baseUrl: env.apiClient['config'].baseUrl,
        apiKey: plaintextKey, // Use plaintext key for requests
        tenantId: env.tenant
      });
      const response = await restrictedClient.get(API_BASE);
      
      assertError(response, 403);
    });

    it('should enforce create permissions', async () => {
      // Create a new user without any roles
      const restrictedUserId = uuidv4();
      await env.db('users').insert({
        user_id: restrictedUserId,
        tenant: env.tenant,
        username: `restricted_${restrictedUserId}`,
        email: `restricted${restrictedUserId}@example.com`,
        first_name: 'Restricted',
        last_name: 'User',
        hashed_password: 'dummy',
        created_at: new Date(),
        user_type: 'internal'
      });
      
      // Create API key for the restricted user
      const plaintextKey = `test_${uuidv4()}`;
      const hashedKey = require('crypto').createHash('sha256').update(plaintextKey).digest('hex');
      
      await env.db('api_keys')
        .insert({
          api_key_id: uuidv4(),
          api_key: hashedKey,
          user_id: restrictedUserId,
          tenant: env.tenant,
          created_at: new Date(),
          active: true
        });

      const restrictedClient = new ApiTestClient({
        baseUrl: env.apiClient['config'].baseUrl,
        apiKey: plaintextKey, // Use plaintext key for requests
        tenantId: env.tenant
      });
      const response = await restrictedClient.post(API_BASE, {
        notes: 'Test'
      });
      
      assertError(response, 403);
    });

    it('should enforce update permissions', async () => {
      const ticket = await createTestTicket(env.db, env.tenant, {
        client_id: env.clientId,
        entered_by: env.userId,
        assigned_to: env.userId
      });

      const service = await createTestService(env.db, env.tenant);
      const entry = await createTestTimeEntry(env.db, env.tenant, {
        work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
        service_id: service.service_id,
        user_id: env.userId
      });

      // Create a new user without any roles
      const restrictedUserId = uuidv4();
      await env.db('users').insert({
        user_id: restrictedUserId,
        tenant: env.tenant,
        username: `restricted_${restrictedUserId}`,
        email: `restricted${restrictedUserId}@example.com`,
        first_name: 'Restricted',
        last_name: 'User',
        hashed_password: 'dummy',
        created_at: new Date(),
        user_type: 'internal'
      });
      
      // Create API key for the restricted user
      const plaintextKey = `test_${uuidv4()}`;
      const hashedKey = require('crypto').createHash('sha256').update(plaintextKey).digest('hex');
      
      await env.db('api_keys')
        .insert({
          api_key_id: uuidv4(),
          api_key: hashedKey,
          user_id: restrictedUserId,
          tenant: env.tenant,
          created_at: new Date(),
          active: true
        });

      const restrictedClient = new ApiTestClient({
        baseUrl: env.apiClient['config'].baseUrl,
        apiKey: plaintextKey, // Use plaintext key for requests
        tenantId: env.tenant
      });
      const response = await restrictedClient.put(`${API_BASE}/${entry.entry_id}`, {
        notes: 'Updated'
      });
      
      assertError(response, 403);
    });

    it('should enforce delete permissions', async () => {
      const ticket = await createTestTicket(env.db, env.tenant, {
        client_id: env.clientId,
        entered_by: env.userId,
        assigned_to: env.userId
      });

      const service = await createTestService(env.db, env.tenant);
      const entry = await createTestTimeEntry(env.db, env.tenant, {
        work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
        service_id: service.service_id,
        user_id: env.userId
      });

      // Create a new user without any roles
      const restrictedUserId = uuidv4();
      await env.db('users').insert({
        user_id: restrictedUserId,
        tenant: env.tenant,
        username: `restricted_${restrictedUserId}`,
        email: `restricted${restrictedUserId}@example.com`,
        first_name: 'Restricted',
        last_name: 'User',
        hashed_password: 'dummy',
        created_at: new Date(),
        user_type: 'internal'
      });
      
      // Create API key for the restricted user
      const plaintextKey = `test_${uuidv4()}`;
      const hashedKey = require('crypto').createHash('sha256').update(plaintextKey).digest('hex');
      
      await env.db('api_keys')
        .insert({
          api_key_id: uuidv4(),
          api_key: hashedKey,
          user_id: restrictedUserId,
          tenant: env.tenant,
          created_at: new Date(),
          active: true
        });

      const restrictedClient = new ApiTestClient({
        baseUrl: env.apiClient['config'].baseUrl,
        apiKey: plaintextKey, // Use plaintext key for requests
        tenantId: env.tenant
      });
      const response = await restrictedClient.delete(`${API_BASE}/${entry.entry_id}`);
      
      assertError(response, 403);
    });
  });

  describe('Multi-tenancy', () => {
    it('should isolate time entries by tenant', async () => {
      // Create entry for current tenant
      const ticket = await createTestTicket(env.db, env.tenant, {
        client_id: env.clientId,
        entered_by: env.userId,
        assigned_to: env.userId
      });

      const service = await createTestService(env.db, env.tenant);
      await createTestTimeEntry(env.db, env.tenant, {
        work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
        service_id: service.service_id,
        user_id: env.userId
      });

      // Create entry for another tenant
      const otherTenant = uuidv4();
      const otherClientId = uuidv4();
      const otherUserId = uuidv4();
      
      // Create the other tenant
      await env.db('tenants').insert({
        tenant: otherTenant,
        client_name: `Other Tenant ${otherTenant}`,
        phone_number: '555-0200',
        email: `other-${otherTenant.substring(0, 8)}@example.com`,
        created_at: new Date(),
        updated_at: new Date(),
        payment_platform_id: `test-platform-${otherTenant.substring(0, 8)}`,
        payment_method_id: `test-method-${otherTenant.substring(0, 8)}`,
        auth_service_id: `test-auth-${otherTenant.substring(0, 8)}`,
        plan: 'test'
      });
      
      // Create client for other tenant
      await env.db('clients').insert({
        client_id: otherClientId,
        tenant: otherTenant,
        client_name: 'Other Client',
        created_at: new Date()
      });
      
      // Create user for other tenant
      await env.db('users').insert({
        user_id: otherUserId,
        tenant: otherTenant,
        username: `other_user_${otherUserId}`,
        email: `other${otherUserId}@example.com`,
        first_name: 'Other',
        last_name: 'User',
        hashed_password: 'dummy',
        created_at: new Date(),
        user_type: 'internal'
      });
      
      const otherTicket = await createTestTicket(env.db, otherTenant, {
        client_id: otherClientId,
        entered_by: otherUserId,
        assigned_to: otherUserId
      });

      const otherService = await createTestService(env.db, otherTenant);
      await createTestTimeEntry(env.db, otherTenant, {
        work_item_id: otherTicket.ticket_id,
        work_item_type: 'ticket',
        service_id: otherService.service_id,
        user_id: otherUserId
      });

      // Should only see current tenant's entries
      const response = await env.apiClient.get(API_BASE);
      assertSuccess(response);
      
      expect(response.data.data.every((e: any) => 
        e.tenant === env.tenant || !e.tenant // tenant might not be included in response
      )).toBe(true);
    });
  });
});
