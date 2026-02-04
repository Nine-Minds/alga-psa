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

describe('Board API E2E Tests', () => {
  let env: E2ETestEnvironment;
  const API_BASE = '/api/v1/boards';
  let testBoardIds: string[] = [];

  beforeAll(async () => {
    env = await setupE2ETestEnvironment();

    // Create additional test boards
    const db = env.db;

    // Create active board
    const activeBoardId = uuidv4();
    await db('boards').insert({
      board_id: activeBoardId,
      board_name: 'Test Active Board',
      description: 'An active test board',
      tenant: env.tenant,
      display_order: 10,
      is_inactive: false,
      is_default: false
    });
    testBoardIds.push(activeBoardId);

    // Create inactive board
    const inactiveBoardId = uuidv4();
    await db('boards').insert({
      board_id: inactiveBoardId,
      board_name: 'Test Inactive Board',
      description: 'An inactive test board',
      tenant: env.tenant,
      display_order: 20,
      is_inactive: true,
      is_default: false
    });
    testBoardIds.push(inactiveBoardId);
  });

  afterAll(async () => {
    if (env) {
      // Clean up test boards
      for (const boardId of testBoardIds) {
        await env.db('boards').where('board_id', boardId).delete();
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

  describe('List Boards (GET /api/v1/boards)', () => {
    it('should list active boards by default', async () => {
      const response = await env.apiClient.get(API_BASE);
      assertSuccess(response);

      expect(response.data.data).toBeInstanceOf(Array);
      expect(response.data.pagination).toBeDefined();

      // Should not include inactive boards by default
      const inactiveBoards = response.data.data.filter((b: any) => b.is_inactive === true);
      expect(inactiveBoards.length).toBe(0);
    });

    it('should include inactive boards when requested', async () => {
      const query = buildQueryString({ include_inactive: 'true' });
      const response = await env.apiClient.get(`${API_BASE}${query}`);
      assertSuccess(response);

      // Should include our inactive test board
      const inactiveBoards = response.data.data.filter((b: any) => b.is_inactive === true);
      expect(inactiveBoards.length).toBeGreaterThan(0);
    });

    it('should support pagination', async () => {
      const query = buildQueryString({ page: 1, limit: 2 });
      const response = await env.apiClient.get(`${API_BASE}${query}`);
      assertSuccess(response);

      const pagination = extractPagination(response);
      expect(pagination.page).toBe(1);
      expect(pagination.limit).toBe(2);
      expect(response.data.data.length).toBeLessThanOrEqual(2);
    });

    it('should support search by name', async () => {
      const query = buildQueryString({ search: 'Test Active' });
      const response = await env.apiClient.get(`${API_BASE}${query}`);
      assertSuccess(response);

      const matchingBoards = response.data.data.filter((b: any) =>
        b.board_name.includes('Test Active')
      );
      expect(matchingBoards.length).toBeGreaterThan(0);
    });

    it('should sort by display_order by default', async () => {
      const response = await env.apiClient.get(API_BASE);
      assertSuccess(response);

      const orders = response.data.data.map((b: any) => b.display_order);
      const sortedOrders = [...orders].sort((a, b) => a - b);
      expect(orders).toEqual(sortedOrders);
    });
  });

  describe('Get Board by ID (GET /api/v1/boards/:id)', () => {
    it('should retrieve a board by ID', async () => {
      const boardId = testBoardIds[0];
      const response = await env.apiClient.get(`${API_BASE}/${boardId}`);
      assertSuccess(response);

      expect(response.data.data).toMatchObject({
        board_id: boardId,
        board_name: 'Test Active Board',
        tenant: env.tenant
      });
    });

    it('should return 404 for non-existent board', async () => {
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
