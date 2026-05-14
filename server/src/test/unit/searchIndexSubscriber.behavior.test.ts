import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Event } from '@alga-psa/event-schemas';

const mocks = vi.hoisted(() => ({
  createTenantKnex: vi.fn(),
  upsertSearchDoc: vi.fn(),
  deleteSearchDoc: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
}));

vi.mock('../../lib/search/upsert', () => ({
  upsertSearchDoc: mocks.upsertSearchDoc,
  deleteSearchDoc: mocks.deleteSearchDoc,
}));

import { clientIndexer } from '../../lib/search/indexers/client';
import { ticketIndexer } from '../../lib/search/indexers/ticket';
import { ticketCommentIndexer } from '../../lib/search/indexers/ticket_comment';
import { handleSearchIndexEventForTest } from '../../lib/eventBus/subscribers/searchIndexSubscriber';
import type { SearchDoc } from '../../lib/search/types';

describe('search index subscriber event handling', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.createTenantKnex.mockReset();
    mocks.upsertSearchDoc.mockReset();
    mocks.deleteSearchDoc.mockReset();
    process.env.SEARCH_INDEX_LIVE = 'true';
  });

  it('T070 upserts a client search document for CLIENT_CREATED', async () => {
    const knex = { client: 'knex' };
    const doc: SearchDoc = {
      tenant: 'tenant-1',
      objectType: 'client',
      objectId: 'client-1',
      title: 'ACME Corp',
      subtitle: 'ops@acme.test',
      body: 'Important support notes',
      url: '/msp/clients/client-1',
      metadata: {},
      acl: { requiredPermission: 'client:read' },
      sourceUpdatedAt: new Date('2026-05-13T12:00:00.000Z'),
    };

    mocks.createTenantKnex.mockResolvedValue({ knex, tenant: 'tenant-1' });
    vi.spyOn(clientIndexer, 'loadOne').mockResolvedValue(doc);

    const event: Event = {
      id: 'event-1',
      eventType: 'CLIENT_CREATED',
      timestamp: '2026-05-13T12:00:00.000Z',
      payload: {
        tenant: 'tenant-1',
        client_id: 'client-1',
      },
    } as Event;

    await handleSearchIndexEventForTest(event);

    expect(mocks.createTenantKnex).toHaveBeenCalledWith('tenant-1');
    expect(clientIndexer.loadOne).toHaveBeenCalledWith(knex, 'tenant-1', 'client-1');
    expect(mocks.upsertSearchDoc).toHaveBeenCalledWith(knex, doc);
    expect(mocks.deleteSearchDoc).not.toHaveBeenCalled();
  });

  it('T071 deletes a client search document for CLIENT_DELETED', async () => {
    const knex = { client: 'knex' };
    const loadOne = vi.spyOn(clientIndexer, 'loadOne');
    mocks.createTenantKnex.mockResolvedValue({ knex, tenant: 'tenant-1' });

    const event: Event = {
      id: 'event-2',
      eventType: 'CLIENT_DELETED',
      timestamp: '2026-05-13T12:00:00.000Z',
      payload: {
        tenant: 'tenant-1',
        client_id: 'client-1',
      },
    } as Event;

    await handleSearchIndexEventForTest(event);

    expect(mocks.createTenantKnex).toHaveBeenCalledWith('tenant-1');
    expect(mocks.deleteSearchDoc).toHaveBeenCalledWith(knex, 'tenant-1', 'client', 'client-1');
    expect(mocks.upsertSearchDoc).not.toHaveBeenCalled();
    expect(loadOne).not.toHaveBeenCalled();
  });

  it('T072 acknowledges events without DB writes when SEARCH_INDEX_LIVE=false', async () => {
    process.env.SEARCH_INDEX_LIVE = 'false';
    const loadOne = vi.spyOn(clientIndexer, 'loadOne');

    const event: Event = {
      id: 'event-3',
      eventType: 'CLIENT_CREATED',
      timestamp: '2026-05-13T12:00:00.000Z',
      payload: {
        tenant: 'tenant-1',
        client_id: 'client-1',
      },
    } as Event;

    await handleSearchIndexEventForTest(event);

    expect(mocks.createTenantKnex).not.toHaveBeenCalled();
    expect(mocks.upsertSearchDoc).not.toHaveBeenCalled();
    expect(mocks.deleteSearchDoc).not.toHaveBeenCalled();
    expect(loadOne).not.toHaveBeenCalled();
  });

  it('T073 picks up SEARCH_INDEX_LIVE=true without restart', async () => {
    const knex = { client: 'knex' };
    const doc: SearchDoc = {
      tenant: 'tenant-1',
      objectType: 'client',
      objectId: 'client-1',
      title: 'ACME Corp',
      url: '/msp/clients/client-1',
      metadata: {},
      acl: { requiredPermission: 'client:read' },
      sourceUpdatedAt: new Date('2026-05-13T12:00:00.000Z'),
    };
    const event: Event = {
      id: 'event-4',
      eventType: 'CLIENT_CREATED',
      timestamp: '2026-05-13T12:00:00.000Z',
      payload: {
        tenant: 'tenant-1',
        client_id: 'client-1',
      },
    } as Event;

    mocks.createTenantKnex.mockResolvedValue({ knex, tenant: 'tenant-1' });
    vi.spyOn(clientIndexer, 'loadOne').mockResolvedValue(doc);

    process.env.SEARCH_INDEX_LIVE = 'false';
    await handleSearchIndexEventForTest(event);

    process.env.SEARCH_INDEX_LIVE = 'true';
    await handleSearchIndexEventForTest(event);

    expect(mocks.createTenantKnex).toHaveBeenCalledTimes(1);
    expect(clientIndexer.loadOne).toHaveBeenCalledTimes(1);
    expect(mocks.upsertSearchDoc).toHaveBeenCalledWith(knex, doc);
    expect(mocks.deleteSearchDoc).not.toHaveBeenCalled();
  });

  it('T074 deletes a stale index row when the source row disappears before loadOne resolves', async () => {
    const knex = { client: 'knex' };
    mocks.createTenantKnex.mockResolvedValue({ knex, tenant: 'tenant-1' });
    vi.spyOn(clientIndexer, 'loadOne').mockResolvedValue(null);

    const event: Event = {
      id: 'event-5',
      eventType: 'CLIENT_UPDATED',
      timestamp: '2026-05-13T12:00:00.000Z',
      payload: {
        tenant: 'tenant-1',
        client_id: 'client-1',
      },
    } as Event;

    await handleSearchIndexEventForTest(event);

    expect(clientIndexer.loadOne).toHaveBeenCalledWith(knex, 'tenant-1', 'client-1');
    expect(mocks.deleteSearchDoc).toHaveBeenCalledWith(knex, 'tenant-1', 'client', 'client-1');
    expect(mocks.upsertSearchDoc).not.toHaveBeenCalled();
  });

  it('T075 cascades TICKET_UPDATED to all ticket comments', async () => {
    const ticketDoc: SearchDoc = {
      tenant: 'tenant-1',
      objectType: 'ticket',
      objectId: 'ticket-1',
      title: 'Renamed ticket',
      url: '/msp/tickets/ticket-1',
      metadata: { identifier: 'TIC-1023' },
      acl: { requiredPermission: 'ticket:read' },
      sourceUpdatedAt: new Date('2026-05-13T12:00:00.000Z'),
    };
    const commentDoc1: SearchDoc = {
      tenant: 'tenant-1',
      objectType: 'ticket_comment',
      objectId: 'comment-1',
      parentType: 'ticket',
      parentId: 'ticket-1',
      title: 'Renamed ticket',
      url: '/msp/tickets/ticket-1#comment-comment-1',
      acl: { requiredPermission: 'ticket:read' },
      sourceUpdatedAt: new Date('2026-05-13T12:00:00.000Z'),
    };
    const commentDoc2: SearchDoc = {
      ...commentDoc1,
      objectId: 'comment-2',
      url: '/msp/tickets/ticket-1#comment-comment-2',
    };
    const commentRows = [{ comment_id: 'comment-1' }, { comment_id: 'comment-2' }];
    const commentQuery = {
      select: vi.fn(() => commentQuery),
      where: vi.fn(() => commentQuery),
      andWhere: vi.fn(() => commentQuery),
      orderBy: vi.fn(() => commentQuery),
      then: (resolve: (rows: typeof commentRows) => unknown, reject: (reason?: unknown) => unknown) =>
        Promise.resolve(commentRows).then(resolve, reject),
    };
    const knex = vi.fn((table: string) => {
      expect(table).toBe('comments');
      return commentQuery;
    });

    mocks.createTenantKnex.mockResolvedValue({ knex, tenant: 'tenant-1' });
    vi.spyOn(ticketIndexer, 'loadOne').mockResolvedValue(ticketDoc);
    vi.spyOn(ticketCommentIndexer, 'loadOne')
      .mockResolvedValueOnce(commentDoc1)
      .mockResolvedValueOnce(commentDoc2);

    const event: Event = {
      id: 'event-6',
      eventType: 'TICKET_UPDATED',
      timestamp: '2026-05-13T12:00:00.000Z',
      payload: {
        tenant: 'tenant-1',
        ticket_id: 'ticket-1',
      },
    } as Event;

    await handleSearchIndexEventForTest(event);

    expect(ticketIndexer.loadOne).toHaveBeenCalledWith(knex, 'tenant-1', 'ticket-1');
    expect(commentQuery.where).toHaveBeenCalledWith('tenant', 'tenant-1');
    expect(commentQuery.andWhere).toHaveBeenCalledWith('ticket_id', 'ticket-1');
    expect(ticketCommentIndexer.loadOne).toHaveBeenNthCalledWith(1, knex, 'tenant-1', 'comment-1');
    expect(ticketCommentIndexer.loadOne).toHaveBeenNthCalledWith(2, knex, 'tenant-1', 'comment-2');
    expect(mocks.upsertSearchDoc).toHaveBeenNthCalledWith(1, knex, ticketDoc);
    expect(mocks.upsertSearchDoc).toHaveBeenNthCalledWith(2, knex, commentDoc1);
    expect(mocks.upsertSearchDoc).toHaveBeenNthCalledWith(3, knex, commentDoc2);
  });
});
