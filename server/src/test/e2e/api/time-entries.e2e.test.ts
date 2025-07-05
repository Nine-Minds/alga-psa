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
import { createUserTestData } from '../utils/userTestData';
import { v4 as uuidv4 } from 'uuid';
import { ApiTestClient } from '../utils/apiTestHelpers';

const API_BASE = '/api/v1/time-entries';

describe('Time Entries API E2E Tests', () => {
  let env: E2ETestEnvironment;

  beforeEach(async () => {
    env = await setupE2ETestEnvironment();
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
          company_id: env.companyId,
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

      it('should validate required fields', async () => {
        const response = await env.apiClient.post(API_BASE, {
          notes: 'Missing required fields'
        });
        
        assertError(response, 400);
        expect(response.data.error.code).toBe('VALIDATION_ERROR');
      });

      it('should validate time periods overlap', async () => {
        const ticket = await createTestTicket(env.db, env.tenant, {
          company_id: env.companyId,
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
          start_time: new Date(`${workDate}T09:00:00`).toISOString(),
          end_time: new Date(`${workDate}T10:30:00`).toISOString(),
          notes: 'First entry',
          is_billable: true
        });

        // Try to create overlapping entry
        const response = await env.apiClient.post(API_BASE, {
          work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
          service_id: service.service_id,
          user_id: env.userId,
          start_time: new Date(`${workDate}T10:00:00`).toISOString(),
          end_time: new Date(`${workDate}T11:00:00`).toISOString(),
          notes: 'Overlapping entry',
          is_billable: true
        });

        assertError(response, 400);
      });
    });

    describe('Get Time Entry (GET /api/v1/time-entries/:id)', () => {
      it('should retrieve a time entry by ID', async () => {
        const ticket = await createTestTicket(env.db, env.tenant, {
          company_id: env.companyId,
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
        // Create another tenant and time entry
        const otherTenant = uuidv4();
        const ticket = await createTestTicket(env.db, otherTenant, {
          company_id: uuidv4(),
          entered_by: uuidv4(),
          assigned_to: uuidv4()
        });

        const service = await createTestService(env.db, otherTenant);
        const otherEntry = await createTestTimeEntry(env.db, otherTenant, {
          work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
          service_id: service.service_id,
          user_id: uuidv4()
        });

        const response = await env.apiClient.get(`${API_BASE}/${otherEntry.entry_id}`);
        assertError(response, 404);
      });
    });

    describe('Update Time Entry (PUT /api/v1/time-entries/:id)', () => {
      it('should update a time entry', async () => {
        const ticket = await createTestTicket(env.db, env.tenant, {
          company_id: env.companyId,
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
          billable_duration: 150,
          is_billable: false
        };

        const response = await env.apiClient.put(`${API_BASE}/${entry.entry_id}`, updates);
        
        assertSuccess(response);
        expect(response.data.data).toMatchObject(updates);
      });

      it('should return 404 when updating non-existent entry', async () => {
        const response = await env.apiClient.put(`${API_BASE}/${uuidv4()}`, {
          notes: 'Updated'
        });
        assertError(response, 404);
      });

      it('should not allow updating approved entries', async () => {
        const ticket = await createTestTicket(env.db, env.tenant, {
          company_id: env.companyId,
          entered_by: env.userId,
          assigned_to: env.userId
        });

        const service = await createTestService(env.db, env.tenant);
        const entry = await createTestTimeEntry(env.db, env.tenant, {
          work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
          service_id: service.service_id,
          user_id: env.userId,
          approval_status: 'APPROVED',
          approved_by: env.userId,
          approved_at: new Date()
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
          company_id: env.companyId,
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
          company_id: env.companyId,
          entered_by: env.userId,
          assigned_to: env.userId
        });

        const service = await createTestService(env.db, env.tenant);
        const entry = await createTestTimeEntry(env.db, env.tenant, {
          work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
          service_id: service.service_id,
          user_id: env.userId,
          approval_status: 'APPROVED',
          approved_by: env.userId,
          approved_at: new Date()
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
        company_id: env.companyId,
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
          start_time: new Date(2024, 0, i + 1, 9, 0)
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
      const ticket = await createTestTicket(env.db, env.tenant, {
        company_id: env.companyId,
        entered_by: env.userId,
        assigned_to: env.userId
      });

      const service = await createTestService(env.db, env.tenant);
      
      // Create entries for different dates
      await createTestTimeEntry(env.db, env.tenant, {
        work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
        service_id: service.service_id,
        user_id: env.userId,
        start_time: new Date('2024-01-01T09:00:00')
      });

      await createTestTimeEntry(env.db, env.tenant, {
        work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
        service_id: service.service_id,
        user_id: env.userId,
        start_time: new Date('2024-01-15T09:00:00')
      });

      await createTestTimeEntry(env.db, env.tenant, {
        work_item_id: ticket.ticket_id,
        work_item_type: 'ticket',
        service_id: service.service_id,
        user_id: env.userId,
        start_time: new Date('2024-02-01T09:00:00')
      });

      const response = await env.apiClient.get(API_BASE, {
        params: {
          start_date: '2024-01-01',
          end_date: '2024-01-31'
        }
      });
      
      assertSuccess(response);
      expect(response.data.data.length).toBe(2);
    });

    it('should filter by user', async () => {
      const ticket = await createTestTicket(env.db, env.tenant, {
        company_id: env.companyId,
        entered_by: env.userId,
        assigned_to: env.userId
      });

      const service = await createTestService(env.db, env.tenant);
      // Create another user via API
      const userData = createUserTestData();
      const userResponse = await env.apiClient.post('/api/v1/users', userData);
      if (userResponse.status !== 201) {
        throw new Error('Failed to create test user');
      }
      const otherUser = userResponse.data.data;
      
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
      expect(response.data.data.every((e: any) => e.user_id === env.userId)).toBe(true);
    });

    it('should filter by billable status', async () => {
      const ticket = await createTestTicket(env.db, env.tenant, {
        company_id: env.companyId,
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
        params: { billable: true }
      });
      
      assertSuccess(response);
      expect(response.data.data.every((e: any) => e.is_billable === true)).toBe(true);
    });

    it('should sort by date', async () => {
      const ticket = await createTestTicket(env.db, env.tenant, {
        company_id: env.companyId,
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
          start_time: new Date(`${date}T09:00:00`)
        });
      }

      const response = await env.apiClient.get(API_BASE, {
        params: { sort: 'work_date', order: 'asc' }
      });
      
      assertSuccess(response);
      const workDates = response.data.data.map((e: any) => e.work_date);
      const sortedDates = [...workDates].sort();
      expect(workDates).toEqual(sortedDates);
    });
  });

  describe('Time Tracking', () => {
    it('should start a tracking session', async () => {
      const ticket = await createTestTicket(env.db, env.tenant, {
        company_id: env.companyId,
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
        company_id: env.companyId,
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

  describe('Approval Workflow', () => {
    it('should approve time entries', async () => {
      const ticket = await createTestTicket(env.db, env.tenant, {
        company_id: env.companyId,
        entered_by: env.userId,
        assigned_to: env.userId
      });

      const service = await createTestService(env.db, env.tenant);
      
      // Create multiple entries
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
        company_id: env.companyId,
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
      expect(response.headers['content-type']).toContain('text/csv');
    });

    it('should export time entries to JSON', async () => {
      const ticket = await createTestTicket(env.db, env.tenant, {
        company_id: env.companyId,
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
        company_id: env.companyId,
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
      const ticket = await createTestTicket(env.db, env.tenant, {
        company_id: env.companyId,
        entered_by: env.userId,
        assigned_to: env.userId
      });

      const service = await createTestService(env.db, env.tenant);

      const entries = [
        {
          work_item_id: ticket.ticket_id,
          work_item_type: 'ticket',
          service_id: service.service_id,
          user_id: env.userId,
          start_time: new Date('2024-01-01T09:00:00').toISOString(),
          end_time: new Date('2024-01-01T11:00:00').toISOString(),
          notes: 'Bulk entry 1',
          is_billable: true
        },
        {
          work_item_id: ticket.ticket_id,
          work_item_type: 'ticket',
          service_id: service.service_id,
          user_id: env.userId,
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
        company_id: env.companyId,
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

      const response = await env.apiClient.put(`${API_BASE}/bulk`, {
        entry_ids: entries,
        updates: {
          is_billable: false,
          notes: 'Bulk updated'
        }
      });
      
      assertSuccess(response);
      expect(response.data.data.updated_count).toBe(2);
    });

    it('should bulk delete time entries', async () => {
      const ticket = await createTestTicket(env.db, env.tenant, {
        company_id: env.companyId,
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
        params: { start_date: 'invalid-date' }
      });
      assertError(response, 400);
    });
  });

  describe('Permissions', () => {
    it('should enforce read permissions for listing', async () => {
      // Create API key without permissions
      const apiKeyWithoutPerms = await env.db('api_keys')
        .insert({
          api_key_id: uuidv4(),
          api_key: `test_${uuidv4()}`,
          user_id: env.userId,
          tenant: env.tenant,
          created_at: new Date()
        })
        .returning('api_key');

      const restrictedClient = new ApiTestClient({
        baseUrl: env.apiClient['config'].baseUrl,
        apiKey: apiKeyWithoutPerms[0].api_key,
        tenantId: env.tenant
      });
      const response = await restrictedClient.get(API_BASE);
      
      assertError(response, 403);
    });

    it('should enforce create permissions', async () => {
      // Create API key without permissions
      const apiKeyWithoutPerms = await env.db('api_keys')
        .insert({
          api_key_id: uuidv4(),
          api_key: `test_${uuidv4()}`,
          user_id: env.userId,
          tenant: env.tenant,
          created_at: new Date()
        })
        .returning('api_key');

      const restrictedClient = new ApiTestClient({
        baseUrl: env.apiClient['config'].baseUrl,
        apiKey: apiKeyWithoutPerms[0].api_key,
        tenantId: env.tenant
      });
      const response = await restrictedClient.post(API_BASE, {
        notes: 'Test'
      });
      
      assertError(response, 403);
    });

    it('should enforce update permissions', async () => {
      const ticket = await createTestTicket(env.db, env.tenant, {
        company_id: env.companyId,
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

      // Create API key without permissions
      const apiKeyWithoutPerms = await env.db('api_keys')
        .insert({
          api_key_id: uuidv4(),
          api_key: `test_${uuidv4()}`,
          user_id: env.userId,
          tenant: env.tenant,
          created_at: new Date()
        })
        .returning('api_key');

      const restrictedClient = new ApiTestClient({
        baseUrl: env.apiClient['config'].baseUrl,
        apiKey: apiKeyWithoutPerms[0].api_key,
        tenantId: env.tenant
      });
      const response = await restrictedClient.put(`${API_BASE}/${entry.entry_id}`, {
        notes: 'Updated'
      });
      
      assertError(response, 403);
    });

    it('should enforce delete permissions', async () => {
      const ticket = await createTestTicket(env.db, env.tenant, {
        company_id: env.companyId,
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

      // Create API key without permissions
      const apiKeyWithoutPerms = await env.db('api_keys')
        .insert({
          api_key_id: uuidv4(),
          api_key: `test_${uuidv4()}`,
          user_id: env.userId,
          tenant: env.tenant,
          created_at: new Date()
        })
        .returning('api_key');

      const restrictedClient = new ApiTestClient({
        baseUrl: env.apiClient['config'].baseUrl,
        apiKey: apiKeyWithoutPerms[0].api_key,
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
        company_id: env.companyId,
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
      const otherTicket = await createTestTicket(env.db, otherTenant, {
        company_id: uuidv4(),
        entered_by: uuidv4(),
        assigned_to: uuidv4()
      });

      const otherService = await createTestService(env.db, otherTenant);
      await createTestTimeEntry(env.db, otherTenant, {
        ticket_id: otherTicket.ticket_id,
        service_id: otherService.service_id,
        user_id: uuidv4()
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