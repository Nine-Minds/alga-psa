import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import {
  setupE2ETestEnvironment,
  E2ETestEnvironment,
} from '../utils/e2eTestSetup';
import {
  assertError,
  assertSuccess,
  buildQueryString,
} from '../utils/apiTestHelpers';

describe('Ticket Status Lookup API E2E Tests', () => {
  let env: E2ETestEnvironment;
  const API_BASE = '/api/v1/tickets/statuses';
  let primaryBoardId: string;
  let secondaryBoardId: string;
  let primaryBoardStatusId: string;
  let secondaryBoardStatusId: string;
  let legacyGlobalTicketStatusId: string;

  beforeAll(async () => {
    env = await setupE2ETestEnvironment();

    const primaryBoard = await env.db('boards')
      .where({ tenant: env.tenant })
      .orderBy('is_default', 'desc')
      .first<{ board_id: string }>('board_id');
    if (!primaryBoard?.board_id) {
      throw new Error('Expected default board for ticket status API tests');
    }
    primaryBoardId = primaryBoard.board_id;

    secondaryBoardId = uuidv4();
    await env.db('boards').insert({
      board_id: secondaryBoardId,
      tenant: env.tenant,
      board_name: 'Ticket Status Board B',
      is_default: false,
      display_order: 2,
    });

    legacyGlobalTicketStatusId = uuidv4();
    await env.db('statuses').insert({
      status_id: legacyGlobalTicketStatusId,
      tenant: env.tenant,
      name: 'Legacy Ticket Status',
      status_type: 'ticket',
      order_number: 200,
      is_closed: false,
      is_default: false,
    });

    primaryBoardStatusId = uuidv4();
    await env.db('statuses').insert({
      status_id: primaryBoardStatusId,
      tenant: env.tenant,
      board_id: primaryBoardId,
      name: 'Primary Board Status',
      status_type: 'ticket',
      order_number: 210,
      is_closed: false,
      is_default: true,
    });

    secondaryBoardStatusId = uuidv4();
    await env.db('statuses').insert({
      status_id: secondaryBoardStatusId,
      tenant: env.tenant,
      board_id: secondaryBoardId,
      name: 'Secondary Board Status',
      status_type: 'ticket',
      order_number: 220,
      is_closed: true,
      is_default: false,
    });
  });

  afterAll(async () => {
    if (!env) {
      return;
    }

    await env.db('statuses')
      .whereIn('status_id', [primaryBoardStatusId, secondaryBoardStatusId, legacyGlobalTicketStatusId])
      .delete();
    await env.db('boards').where('board_id', secondaryBoardId).delete();
    await env.cleanup();
  });

  it('should require API key', async () => {
    const { ApiTestClient } = await import('../utils/apiTestHelpers');
    const clientWithoutKey = new ApiTestClient({
      baseUrl: env.apiClient['config'].baseUrl
    });

    const response = await clientWithoutKey.get(API_BASE);
    assertError(response, 401, 'UNAUTHORIZED');
  });

  it('T043: should honor board scope and return only statuses for the requested board', async () => {
    const query = buildQueryString({ board_id: primaryBoardId });
    const response = await env.apiClient.get(`${API_BASE}${query}`);
    assertSuccess(response);

    expect(response.data.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status_id: primaryBoardStatusId,
          board_id: primaryBoardId,
          name: 'Primary Board Status',
        }),
      ])
    );
    expect(response.data.data.map((status: any) => status.board_id)).not.toContain(secondaryBoardId);
    expect(response.data.data.map((status: any) => status.status_id)).not.toContain(legacyGlobalTicketStatusId);
  });

  it('should exclude legacy board-less ticket statuses when board scope is omitted', async () => {
    const response = await env.apiClient.get(API_BASE);
    assertSuccess(response);

    const returnedStatusIds = response.data.data.map((status: any) => status.status_id);
    expect(returnedStatusIds).toContain(primaryBoardStatusId);
    expect(returnedStatusIds).toContain(secondaryBoardStatusId);
    expect(returnedStatusIds).not.toContain(legacyGlobalTicketStatusId);
  });
});
