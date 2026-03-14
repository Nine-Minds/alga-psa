import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  setupE2ETestEnvironment,
  E2ETestEnvironment
} from '../utils/e2eTestSetup';
import {
  assertSuccess,
  assertError,
  buildQueryString,
  extractPagination
} from '../utils/apiTestHelpers';
import { v4 as uuidv4 } from 'uuid';

describe('Status API E2E Tests', () => {
  let env: E2ETestEnvironment;
  const API_BASE = '/api/v1/statuses';
  let testStatusIds: string[] = [];
  let primaryBoardId: string;
  let secondaryBoardId: string;
  let boardScopedTicketStatusId: string;
  let secondaryBoardScopedTicketStatusId: string;
  let legacyGlobalTicketStatusId: string;

  beforeAll(async () => {
    env = await setupE2ETestEnvironment();

    // Create additional test statuses
    const db = env.db;

    const primaryBoard = await db('boards')
      .where({ tenant: env.tenant })
      .orderBy('is_default', 'desc')
      .first<{ board_id: string }>('board_id');
    if (!primaryBoard?.board_id) {
      throw new Error('Expected default board for status API tests');
    }
    primaryBoardId = primaryBoard.board_id;

    secondaryBoardId = uuidv4();
    await db('boards').insert({
      board_id: secondaryBoardId,
      tenant: env.tenant,
      board_name: 'Secondary Board',
      is_default: false,
      display_order: 2,
    });

    // Create a legacy global ticket status that should no longer be surfaced by generic ticket APIs
    legacyGlobalTicketStatusId = uuidv4();
    await db('statuses').insert({
      status_id: legacyGlobalTicketStatusId,
      name: 'Legacy Global Ticket Status',
      status_type: 'ticket',
      tenant: env.tenant,
      order_number: 100,
      is_closed: false,
      is_default: false
    });
    testStatusIds.push(legacyGlobalTicketStatusId);

    boardScopedTicketStatusId = uuidv4();
    await db('statuses').insert({
      status_id: boardScopedTicketStatusId,
      name: 'Board Scoped Ticket Status',
      status_type: 'ticket',
      tenant: env.tenant,
      board_id: primaryBoardId,
      order_number: 110,
      is_closed: false,
      is_default: false,
    });
    testStatusIds.push(boardScopedTicketStatusId);

    secondaryBoardScopedTicketStatusId = uuidv4();
    await db('statuses').insert({
      status_id: secondaryBoardScopedTicketStatusId,
      name: 'Secondary Board Ticket Status',
      status_type: 'ticket',
      tenant: env.tenant,
      board_id: secondaryBoardId,
      order_number: 120,
      is_closed: true,
      is_default: false,
    });
    testStatusIds.push(secondaryBoardScopedTicketStatusId);

    // Create a project status
    const projectStatusId = uuidv4();
    await db('statuses').insert({
      status_id: projectStatusId,
      name: 'Test Project Status',
      status_type: 'project',
      tenant: env.tenant,
      order_number: 100,
      is_closed: false,
      is_default: false
    });
    testStatusIds.push(projectStatusId);

    // Create a project_task status
    const taskStatusId = uuidv4();
    await db('statuses').insert({
      status_id: taskStatusId,
      name: 'Test Task Status',
      status_type: 'project_task',
      tenant: env.tenant,
      order_number: 100,
      is_closed: false,
      is_default: false
    });
    testStatusIds.push(taskStatusId);
  });

  afterAll(async () => {
    if (env) {
      // Clean up test statuses
      for (const statusId of testStatusIds) {
        await env.db('statuses').where('status_id', statusId).delete();
      }
      if (secondaryBoardId) {
        await env.db('boards').where('board_id', secondaryBoardId).delete();
      }
      await env.cleanup();
    }
  });

  describe('Authentication', () => {
    it('should require API key', async () => {
      const { ApiTestClient } = await import('../utils/apiTestHelpers');
      const clientWithoutKey = new ApiTestClient({
        baseUrl: env.apiClient['config'].baseUrl
      });

      const response = await clientWithoutKey.get(API_BASE);
      assertError(response, 401, 'UNAUTHORIZED');
    });

    it('should reject invalid API key', async () => {
      const { ApiTestClient } = await import('../utils/apiTestHelpers');
      const clientWithBadKey = new ApiTestClient({
        baseUrl: env.apiClient['config'].baseUrl,
        apiKey: 'invalid-api-key-12345'
      });

      const response = await clientWithBadKey.get(API_BASE);
      assertError(response, 401, 'UNAUTHORIZED');
    });
  });

  describe('List Statuses (GET /api/v1/statuses)', () => {
    it('should list all statuses', async () => {
      const response = await env.apiClient.get(API_BASE);
      assertSuccess(response);

      expect(response.data.data).toBeInstanceOf(Array);
      expect(response.data.pagination).toBeDefined();
      expect(response.data.data.length).toBeGreaterThan(0);
    });

    it('should require board scope when filtering ticket statuses', async () => {
      const query = buildQueryString({ type: 'ticket' });
      const response = await env.apiClient.get(`${API_BASE}${query}`);
      assertError(response, 400, 'VALIDATION_ERROR');
    });

    it('should filter ticket statuses by board and exclude legacy global ticket rows', async () => {
      const query = buildQueryString({ type: 'ticket', board_id: primaryBoardId });
      const response = await env.apiClient.get(`${API_BASE}${query}`);
      assertSuccess(response);

      response.data.data.forEach((status: any) => {
        expect(status.status_type).toBe('ticket');
        expect(status.board_id).toBe(primaryBoardId);
      });
      expect(response.data.data.map((status: any) => status.status_id)).toContain(boardScopedTicketStatusId);
      expect(response.data.data.map((status: any) => status.status_id)).not.toContain(secondaryBoardScopedTicketStatusId);
      expect(response.data.data.map((status: any) => status.status_id)).not.toContain(legacyGlobalTicketStatusId);
    });

    it('should filter by type (project)', async () => {
      const query = buildQueryString({ type: 'project' });
      const response = await env.apiClient.get(`${API_BASE}${query}`);
      assertSuccess(response);

      response.data.data.forEach((status: any) => {
        expect(status.status_type).toBe('project');
      });
    });

    it('should filter by type (project_task)', async () => {
      const query = buildQueryString({ type: 'project_task' });
      const response = await env.apiClient.get(`${API_BASE}${query}`);
      assertSuccess(response);

      response.data.data.forEach((status: any) => {
        expect(status.status_type).toBe('project_task');
      });
    });

    it('should support pagination', async () => {
      const query = buildQueryString({ page: 1, limit: 5 });
      const response = await env.apiClient.get(`${API_BASE}${query}`);
      assertSuccess(response);

      const pagination = extractPagination(response);
      expect(pagination.page).toBe(1);
      expect(pagination.limit).toBe(5);
      expect(response.data.data.length).toBeLessThanOrEqual(5);
    });

    it('should support search by name', async () => {
      const query = buildQueryString({ search: 'Board Scoped Ticket Status' });
      const response = await env.apiClient.get(`${API_BASE}${query}`);
      assertSuccess(response);

      const matchingStatuses = response.data.data.filter((s: any) =>
        s.name.includes('Board Scoped Ticket Status')
      );
      expect(matchingStatuses.length).toBeGreaterThan(0);
    });

    it('should sort by order_number by default', async () => {
      const query = buildQueryString({ type: 'project' });
      const response = await env.apiClient.get(`${API_BASE}${query}`);
      assertSuccess(response);

      const orders = response.data.data.map((s: any) => s.order_number);
      const sortedOrders = [...orders].sort((a, b) => a - b);
      expect(orders).toEqual(sortedOrders);
    });
  });

  describe('Get Status by ID (GET /api/v1/statuses/:id)', () => {
    it('should retrieve a status by ID', async () => {
      const statusId = boardScopedTicketStatusId;
      const response = await env.apiClient.get(`${API_BASE}/${statusId}`);
      assertSuccess(response);

      expect(response.data.data).toMatchObject({
        status_id: statusId,
        name: 'Board Scoped Ticket Status',
        status_type: 'ticket',
        tenant: env.tenant,
        board_id: primaryBoardId,
      });
    });

    it('should hide legacy global ticket statuses by ID', async () => {
      const response = await env.apiClient.get(`${API_BASE}/${legacyGlobalTicketStatusId}`);
      assertError(response, 404, 'NOT_FOUND');
    });

    it('should return 404 for non-existent status', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await env.apiClient.get(`${API_BASE}/${fakeId}`);
      assertError(response, 404, 'NOT_FOUND');
    });

    it('should return 400 for invalid UUID format', async () => {
      const response = await env.apiClient.get(`${API_BASE}/not-a-uuid`);
      assertError(response, 400, 'VALIDATION_ERROR');
    });
  });
});
