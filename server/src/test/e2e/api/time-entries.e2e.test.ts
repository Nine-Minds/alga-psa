/**
 * Time Entries API E2E Tests
 * 
 * Comprehensive tests for all time entry endpoints including:
 * - CRUD operations
 * - Time tracking sessions
 * - Approval workflow
 * - Export functionality
 * - Statistics and templates
 * - Bulk operations
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { withTestSetup } from '../fixtures/test-setup';
import { timeEntryFactory } from '../factories/time-entry.factory';
import { contactFactory } from '../factories/contact.factory';
import { companyFactory } from '../factories/company.factory';
import { projectFactory } from '../factories/project.factory';
import { ticketFactory } from '../factories/ticket.factory';
import { userFactory } from '../factories/user.factory';
import { apiKeyFactory } from '../factories/apiKey.factory';
import { getConnection } from '../../../lib/db/db';
import { runWithTenant } from '../../../lib/db';

const API_BASE_URL = 'http://localhost:3000/api/v1';

describe('Time Entries API E2E Tests', () => {
  let apiKey: string;
  let tenantId: string;
  let userId: string;
  let projectId: string;
  let ticketId: string;
  let companyId: string;
  let contactId: string;

  beforeAll(async () => {
    // Set up test data
    const setup = await withTestSetup();
    tenantId = setup.tenantId;
    apiKey = setup.apiKey;
    userId = setup.userId;

    // Create related entities for time entries
    await runWithTenant(tenantId, async () => {
      const db = await getConnection();
      
      // Create company
      const company = await companyFactory(db, { tenant: tenantId });
      companyId = company.company_id;
      
      // Create contact
      const contact = await contactFactory(db, { tenant: tenantId, company_id: companyId });
      contactId = contact.contact_id;
      
      // Create project
      const project = await projectFactory(db, { tenant: tenantId, company_id: companyId });
      projectId = project.project_id;
      
      // Create ticket
      const ticket = await ticketFactory(db, { tenant: tenantId, company_id: companyId });
      ticketId = ticket.ticket_id;
    });
  });

  afterAll(async () => {
    // Clean up test data
    await runWithTenant(tenantId, async () => {
      const db = await getConnection();
      
      // Delete time entries first
      await db.query('DELETE FROM time_entries WHERE tenant = $1', [tenantId]);
      
      // Delete related entities
      await db.query('DELETE FROM tickets WHERE tenant = $1', [tenantId]);
      await db.query('DELETE FROM projects WHERE tenant = $1', [tenantId]);
      await db.query('DELETE FROM contacts WHERE tenant = $1', [tenantId]);
      await db.query('DELETE FROM companies WHERE tenant = $1', [tenantId]);
    });
  });

  describe('Basic CRUD Operations', () => {
    it('should create a new time entry', async () => {
      const response = await fetch(`${API_BASE_URL}/time-entries`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        },
        body: JSON.stringify({
          work_date: '2024-01-15',
          start_time: '09:00:00',
          end_time: '11:00:00',
          description: 'Working on API implementation',
          hours: 2,
          billable: true,
          project_id: projectId,
          ticket_id: ticketId,
          user_id: userId
        })
      });

      expect(response.status).toBe(201);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        work_date: expect.any(String),
        description: 'Working on API implementation',
        hours: 2,
        billable: true,
        project_id: projectId,
        ticket_id: ticketId
      });
    });

    it('should list time entries with pagination', async () => {
      // Create multiple time entries
      await runWithTenant(tenantId, async () => {
        const db = await getConnection();
        for (let i = 0; i < 5; i++) {
          await timeEntryFactory(db, { 
            tenant: tenantId, 
            user_id: userId,
            project_id: projectId,
            work_date: `2024-01-${15 + i}`
          });
        }
      });

      const response = await fetch(`${API_BASE_URL}/time-entries?page=1&limit=3`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(3);
      expect(result.pagination).toMatchObject({
        page: 1,
        limit: 3,
        total: expect.any(Number)
      });
    });

    it('should get a specific time entry', async () => {
      const db = await getConnection();
      const timeEntry = await runWithTenant(tenantId, async () => {
        return await timeEntryFactory(db, { 
          tenant: tenantId, 
          user_id: userId,
          project_id: projectId 
        });
      });

      const response = await fetch(`${API_BASE_URL}/time-entries/${timeEntry.entry_id}`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data.entry_id).toBe(timeEntry.entry_id);
    });

    it('should update a time entry', async () => {
      const db = await getConnection();
      const timeEntry = await runWithTenant(tenantId, async () => {
        return await timeEntryFactory(db, { 
          tenant: tenantId, 
          user_id: userId,
          project_id: projectId,
          hours: 3
        });
      });

      const response = await fetch(`${API_BASE_URL}/time-entries/${timeEntry.entry_id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        },
        body: JSON.stringify({
          hours: 4,
          description: 'Updated description'
        })
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data.hours).toBe(4);
      expect(result.data.description).toBe('Updated description');
    });

    it('should delete a time entry', async () => {
      const db = await getConnection();
      const timeEntry = await runWithTenant(tenantId, async () => {
        return await timeEntryFactory(db, { 
          tenant: tenantId, 
          user_id: userId,
          project_id: projectId 
        });
      });

      const response = await fetch(`${API_BASE_URL}/time-entries/${timeEntry.entry_id}`, {
        method: 'DELETE',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);

      // Verify deletion
      const getResponse = await fetch(`${API_BASE_URL}/time-entries/${timeEntry.entry_id}`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });
      expect(getResponse.status).toBe(404);
    });
  });

  describe('Search Functionality', () => {
    it('should search time entries by date range', async () => {
      const response = await fetch(`${API_BASE_URL}/time-entries/search?start_date=2024-01-01&end_date=2024-01-31`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data).toBeInstanceOf(Array);
    });

    it('should search time entries by project', async () => {
      const response = await fetch(`${API_BASE_URL}/time-entries/search?project_id=${projectId}`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data.every((entry: any) => entry.project_id === projectId)).toBe(true);
    });

    it('should search billable time entries only', async () => {
      const response = await fetch(`${API_BASE_URL}/time-entries/search?billable=true`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data.every((entry: any) => entry.billable === true)).toBe(true);
    });
  });

  describe('Time Tracking Sessions', () => {
    let sessionId: string;

    it('should start a time tracking session', async () => {
      const response = await fetch(`${API_BASE_URL}/time-entries/start-tracking`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        },
        body: JSON.stringify({
          project_id: projectId,
          ticket_id: ticketId,
          description: 'Starting work on new feature'
        })
      });

      expect(response.status).toBe(201);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('session_id');
      expect(result.data).toHaveProperty('start_time');
      sessionId = result.data.session_id;
    });

    it('should get active tracking session', async () => {
      const response = await fetch(`${API_BASE_URL}/time-entries/active-session`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('session_id');
      expect(result.data.session_id).toBe(sessionId);
    });

    it('should stop a time tracking session', async () => {
      const response = await fetch(`${API_BASE_URL}/time-entries/stop-tracking/${sessionId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        },
        body: JSON.stringify({
          description: 'Completed feature implementation',
          billable: true
        })
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('entry_id');
      expect(result.data).toHaveProperty('end_time');
      expect(result.data.description).toBe('Completed feature implementation');
    });
  });

  describe('Statistics', () => {
    it('should get time entry statistics', async () => {
      const response = await fetch(`${API_BASE_URL}/time-entries/stats?period=month&year=2024&month=1`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('total_hours');
      expect(result.data).toHaveProperty('billable_hours');
      expect(result.data).toHaveProperty('non_billable_hours');
      expect(result.data).toHaveProperty('total_entries');
    });

    it('should get statistics by project', async () => {
      const response = await fetch(`${API_BASE_URL}/time-entries/stats?group_by=project`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data).toBeInstanceOf(Array);
    });
  });

  describe('Export Functionality', () => {
    it('should export time entries as JSON', async () => {
      const response = await fetch(`${API_BASE_URL}/time-entries/export?format=json&start_date=2024-01-01&end_date=2024-01-31`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data).toBeInstanceOf(Array);
    });

    it('should export time entries as CSV', async () => {
      const response = await fetch(`${API_BASE_URL}/time-entries/export?format=csv&start_date=2024-01-01&end_date=2024-01-31`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/csv');
      expect(response.headers.get('content-disposition')).toContain('attachment; filename="time-entries.csv"');
    });
  });

  describe('Approval Workflow', () => {
    let entriesForApproval: string[] = [];

    beforeAll(async () => {
      // Create time entries for approval
      const db = await getConnection();
      await runWithTenant(tenantId, async () => {
        for (let i = 0; i < 3; i++) {
          const entry = await timeEntryFactory(db, {
            tenant: tenantId,
            user_id: userId,
            project_id: projectId,
            approval_status: 'pending'
          });
          entriesForApproval.push(entry.entry_id);
        }
      });
    });

    it('should approve time entries', async () => {
      const response = await fetch(`${API_BASE_URL}/time-entries/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        },
        body: JSON.stringify({
          entry_ids: entriesForApproval.slice(0, 2),
          notes: 'Approved for billing'
        })
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data.updated_count).toBe(2);
    });

    it('should request changes to time entries', async () => {
      const response = await fetch(`${API_BASE_URL}/time-entries/request-changes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        },
        body: JSON.stringify({
          entry_ids: [entriesForApproval[2]],
          notes: 'Please provide more details',
          requested_changes: 'Add task breakdown'
        })
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data.updated_count).toBe(1);
    });
  });

  describe('Templates', () => {
    it('should get time entry templates', async () => {
      const response = await fetch(`${API_BASE_URL}/time-entries/templates`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data).toBeInstanceOf(Array);
    });
  });

  describe('Bulk Operations', () => {
    it('should bulk create time entries', async () => {
      const entries = [
        {
          work_date: '2024-01-20',
          hours: 4,
          description: 'Bulk entry 1',
          project_id: projectId,
          user_id: userId,
          billable: true
        },
        {
          work_date: '2024-01-21',
          hours: 3,
          description: 'Bulk entry 2',
          project_id: projectId,
          user_id: userId,
          billable: false
        }
      ];

      const response = await fetch(`${API_BASE_URL}/time-entries/bulk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        },
        body: JSON.stringify({ entries })
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data.created_count).toBe(2);
      expect(result.data.entries).toHaveLength(2);
    });
  });

  describe('Error Handling', () => {
    it('should return 401 without API key', async () => {
      const response = await fetch(`${API_BASE_URL}/time-entries`, {
        method: 'GET',
        headers: {
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(401);
      const result = await response.json();
      expect(result.success).toBe(false);
      expect(result.error).toBe('API key required');
    });

    it('should return 403 without permission', async () => {
      // Create a limited API key without time entry permissions
      const db = await getConnection();
      const limitedKey = await runWithTenant(tenantId, async () => {
        const user = await userFactory(db, { 
          tenant: tenantId, 
          email: 'limited@example.com' 
        });
        return await apiKeyFactory(db, { 
          tenant: tenantId, 
          user_id: user.user_id 
        });
      });

      const response = await fetch(`${API_BASE_URL}/time-entries`, {
        method: 'GET',
        headers: {
          'x-api-key': limitedKey.key,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(403);
    });

    it('should return 400 for invalid data', async () => {
      const response = await fetch(`${API_BASE_URL}/time-entries`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        },
        body: JSON.stringify({
          // Missing required fields
          description: 'Invalid entry'
        })
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.success).toBe(false);
      expect(result.error).toContain('validation');
    });

    it('should return 404 for non-existent time entry', async () => {
      const response = await fetch(`${API_BASE_URL}/time-entries/non-existent-id`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(404);
      const result = await response.json();
      expect(result.success).toBe(false);
    });
  });

  describe('Tenant Isolation', () => {
    it('should not access time entries from other tenants', async () => {
      // Create another tenant and time entry
      const otherSetup = await withTestSetup();
      const otherTenantId = otherSetup.tenantId;
      
      const db = await getConnection();
      const otherTimeEntry = await runWithTenant(otherTenantId, async () => {
        const company = await companyFactory(db, { tenant: otherTenantId });
        const project = await projectFactory(db, { 
          tenant: otherTenantId, 
          company_id: company.company_id 
        });
        return await timeEntryFactory(db, { 
          tenant: otherTenantId, 
          project_id: project.project_id,
          user_id: otherSetup.userId
        });
      });

      // Try to access from original tenant
      const response = await fetch(`${API_BASE_URL}/time-entries/${otherTimeEntry.entry_id}`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(404);
    });
  });
});