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

describe('Priority API E2E Tests', () => {
  let env: E2ETestEnvironment;
  const API_BASE = '/api/v1/priorities';
  let testPriorityIds: string[] = [];

  beforeAll(async () => {
    env = await setupE2ETestEnvironment();

    // Create additional test priorities
    const db = env.db;

    // Create a ticket priority
    const ticketPriorityId = uuidv4();
    await db('priorities').insert({
      priority_id: ticketPriorityId,
      priority_name: 'Test Ticket Priority',
      description: 'A test priority for tickets',
      tenant: env.tenant,
      order_number: 100,
      item_type: 'ticket',
      color: '#FF5733'
    });
    testPriorityIds.push(ticketPriorityId);

    // Create a project_task priority
    const taskPriorityId = uuidv4();
    await db('priorities').insert({
      priority_id: taskPriorityId,
      priority_name: 'Test Task Priority',
      description: 'A test priority for tasks',
      tenant: env.tenant,
      order_number: 100,
      item_type: 'project_task',
      color: '#33FF57'
    });
    testPriorityIds.push(taskPriorityId);
  });

  afterAll(async () => {
    if (env) {
      // Clean up test priorities
      for (const priorityId of testPriorityIds) {
        await env.db('priorities').where('priority_id', priorityId).delete();
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

  describe('List Priorities (GET /api/v1/priorities)', () => {
    it('should list all priorities', async () => {
      const response = await env.apiClient.get(API_BASE);
      assertSuccess(response);

      expect(response.data.data).toBeInstanceOf(Array);
      expect(response.data.pagination).toBeDefined();
      expect(response.data.data.length).toBeGreaterThan(0);
    });

    it('should filter by item_type (ticket)', async () => {
      const query = buildQueryString({ item_type: 'ticket' });
      const response = await env.apiClient.get(`${API_BASE}${query}`);
      assertSuccess(response);

      response.data.data.forEach((priority: any) => {
        expect(priority.item_type).toBe('ticket');
      });
    });

    it('should filter by item_type (project_task)', async () => {
      const query = buildQueryString({ item_type: 'project_task' });
      const response = await env.apiClient.get(`${API_BASE}${query}`);
      assertSuccess(response);

      response.data.data.forEach((priority: any) => {
        expect(priority.item_type).toBe('project_task');
      });
    });

    it('should support pagination', async () => {
      const query = buildQueryString({ page: 1, limit: 3 });
      const response = await env.apiClient.get(`${API_BASE}${query}`);
      assertSuccess(response);

      const pagination = extractPagination(response);
      expect(pagination.page).toBe(1);
      expect(pagination.limit).toBe(3);
      expect(response.data.data.length).toBeLessThanOrEqual(3);
    });

    it('should support search by name', async () => {
      const query = buildQueryString({ search: 'Test Ticket Priority' });
      const response = await env.apiClient.get(`${API_BASE}${query}`);
      assertSuccess(response);

      const matchingPriorities = response.data.data.filter((p: any) =>
        p.priority_name.includes('Test Ticket Priority')
      );
      expect(matchingPriorities.length).toBeGreaterThan(0);
    });

    it('should sort by order_number by default', async () => {
      const response = await env.apiClient.get(API_BASE);
      assertSuccess(response);

      const orders = response.data.data.map((p: any) => p.order_number);
      const sortedOrders = [...orders].sort((a, b) => a - b);
      expect(orders).toEqual(sortedOrders);
    });

    it('should include color field', async () => {
      const response = await env.apiClient.get(API_BASE);
      assertSuccess(response);

      // At least our test priority should have a color
      const prioritiesWithColor = response.data.data.filter((p: any) => p.color);
      expect(prioritiesWithColor.length).toBeGreaterThan(0);
    });
  });

  describe('Get Priority by ID (GET /api/v1/priorities/:id)', () => {
    it('should retrieve a priority by ID', async () => {
      const priorityId = testPriorityIds[0];
      const response = await env.apiClient.get(`${API_BASE}/${priorityId}`);
      assertSuccess(response);

      expect(response.data.data).toMatchObject({
        priority_id: priorityId,
        priority_name: 'Test Ticket Priority',
        item_type: 'ticket',
        tenant: env.tenant,
        color: '#FF5733'
      });
    });

    it('should return 404 for non-existent priority', async () => {
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
