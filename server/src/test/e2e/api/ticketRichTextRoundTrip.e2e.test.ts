import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { setupE2ETestEnvironment, type E2ETestEnvironment } from '../utils/e2eTestSetup';
import { createTestTicket } from '../utils/ticketTestData';
import { assertSuccess } from '../utils/apiTestHelpers';

let env: E2ETestEnvironment | null = null;
let boardId = '';
let statusIds: { open: string; inProgress: string; closed: string };
let priorityIds: { low: string; medium: string; high: string };

async function resolveTicketDefaults(db: Knex, tenant: string): Promise<void> {
  const tenantTable = (table: string) => tenantDb(db, tenant).table(table);
  const board = await tenantTable('boards').where({ tenant, is_default: true }).first();
  if (!board) {
    throw new Error('Ticket E2E defaults were not created by setupE2ETestEnvironment');
  }

  boardId = board.board_id;

  const [openStatus, inProgressStatus, closedStatus, lowPriority, mediumPriority, highPriority] = await Promise.all([
    tenantTable('statuses').where({ tenant, board_id: boardId, name: 'New', status_type: 'ticket' }).first(),
    tenantTable('statuses').where({ tenant, board_id: boardId, name: 'In Progress', status_type: 'ticket' }).first(),
    tenantTable('statuses').where({ tenant, board_id: boardId, name: 'Closed', status_type: 'ticket' }).first(),
    tenantTable('priorities').where({ tenant, priority_name: 'Low' }).first(),
    tenantTable('priorities').where({ tenant, priority_name: 'Medium' }).first(),
    tenantTable('priorities').where({ tenant, priority_name: 'High' }).first(),
  ]);

  if (!openStatus || !inProgressStatus || !closedStatus || !lowPriority || !mediumPriority || !highPriority) {
    throw new Error('Ticket E2E defaults were not created by setupE2ETestEnvironment');
  }
  statusIds = {
    open: openStatus.status_id,
    inProgress: inProgressStatus.status_id,
    closed: closedStatus.status_id,
  };
  priorityIds = {
    low: lowPriority.priority_id,
    medium: mediumPriority.priority_id,
    high: highPriority.priority_id,
  };
}

describe('Ticket rich-text round-trip E2E', () => {
  beforeAll(async () => {
    env = await setupE2ETestEnvironment();
    await resolveTicketDefaults(env.db, env.tenant);
  });
  afterAll(async () => { await env?.cleanup(); });

  it('updates a serialized rich-text description through the ticket API and round-trips the saved value', async () => {
    const ticket = await createTestTicket(env!.db, env!.tenant, {
      title: 'Rich mobile description ticket',
      description: 'Legacy plain description',
      board_id: boardId,
      status_id: statusIds.open,
      priority_id: priorityIds.medium,
      client_id: env!.clientId,
    });

    const richDescription = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Updated rich description from mobile' }],
        },
      ],
    });

    const updateResponse = await env!.apiClient.put(`/api/v1/tickets/${ticket.ticket_id}`, {
      attributes: {
        description: richDescription,
      },
    });
    assertSuccess(updateResponse);
    expect(updateResponse.data.data.attributes?.description).toBe(richDescription);

    const refetchResponse = await env!.apiClient.get(`/api/v1/tickets/${ticket.ticket_id}`);
    assertSuccess(refetchResponse);
    expect(refetchResponse.data.data.attributes?.description).toBe(richDescription);
    expect(refetchResponse.data.data.description_html).toContain('Updated rich description from mobile');
  });

  it('creates a serialized rich-text comment through the ticket API and returns render-friendly content on refetch', async () => {
    const ticket = await createTestTicket(env!.db, env!.tenant, {
      title: 'Rich mobile comment ticket',
      board_id: boardId,
      status_id: statusIds.open,
      priority_id: priorityIds.medium,
      client_id: env!.clientId,
    });

    const richComment = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Rich mobile comment round trip' }],
        },
      ],
    });

    const createResponse = await env!.apiClient.post(`/api/v1/tickets/${ticket.ticket_id}/comments`, {
      comment_text: richComment,
      is_internal: true,
    });
    assertSuccess(createResponse, 201);
    expect(createResponse.data.data.comment_text).toBe(richComment);

    const listResponse = await env!.apiClient.get(`/api/v1/tickets/${ticket.ticket_id}/comments`);
    assertSuccess(listResponse);
    expect(listResponse.data.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          comment_text: richComment,
          comment_html: expect.stringContaining('Rich mobile comment round trip'),
        }),
      ]),
    );
  });
});
