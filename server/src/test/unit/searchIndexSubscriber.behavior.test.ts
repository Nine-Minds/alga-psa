import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Event } from '@alga-psa/event-schemas';

const mocks = vi.hoisted(() => ({
  createTenantKnex: vi.fn(),
  upsertSearchDoc: vi.fn(),
  deleteSearchDoc: vi.fn(),
  scheduleSearchVisibleUserReindexJob: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
}));

vi.mock('@alga-psa/search/upsert', () => ({
  upsertSearchDoc: mocks.upsertSearchDoc,
  deleteSearchDoc: mocks.deleteSearchDoc,
}));

vi.mock('../../lib/jobs', () => ({
  scheduleSearchVisibleUserReindexJob: mocks.scheduleSearchVisibleUserReindexJob,
}));

import { clientIndexer } from '@alga-psa/search/indexers/client';
import { userIndexer } from '@alga-psa/search/indexers/user';
import { ticketIndexer } from '@alga-psa/search/indexers/ticket';
import { ticketCommentIndexer } from '@alga-psa/search/indexers/ticket_comment';
import { invoiceIndexer } from '@alga-psa/search/indexers/invoice';
import { invoiceItemIndexer } from '@alga-psa/search/indexers/invoice_item';
import { invoiceAnnotationIndexer } from '@alga-psa/search/indexers/invoice_annotation';
import { projectIndexer } from '@alga-psa/search/indexers/project';
import { projectPhaseIndexer } from '@alga-psa/search/indexers/project_phase';
import { projectTaskIndexer } from '@alga-psa/search/indexers/project_task';
import { projectTaskCommentIndexer } from '@alga-psa/search/indexers/project_task_comment';
import { documentIndexer } from '@alga-psa/search/indexers/document';
import { statusIndexer } from '@alga-psa/search/indexers/status';
import { handleSearchIndexEventForTest } from '../../lib/eventBus/subscribers/searchIndexSubscriber';
import { runSearchBackfill } from '../../scripts/search-backfill';
import type { SearchDoc } from '@alga-psa/types';

describe('search index subscriber event handling', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.createTenantKnex.mockReset();
    mocks.upsertSearchDoc.mockReset();
    mocks.deleteSearchDoc.mockReset();
    mocks.scheduleSearchVisibleUserReindexJob.mockReset();
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

  it('T076 cascades INVOICE_UPDATED to invoice items and annotations', async () => {
    const invoiceDoc: SearchDoc = {
      tenant: 'tenant-1',
      objectType: 'invoice',
      objectId: 'invoice-1',
      title: 'INV-1001',
      url: '/msp/invoices/invoice-1',
      metadata: { identifier: 'INV-1001' },
      acl: { requiredPermission: 'invoice:read', clientScopeId: 'client-1' },
      sourceUpdatedAt: new Date('2026-05-13T12:00:00.000Z'),
    };
    const itemDoc: SearchDoc = {
      tenant: 'tenant-1',
      objectType: 'invoice_item',
      objectId: 'item-1',
      parentType: 'invoice',
      parentId: 'invoice-1',
      title: 'INV-1001',
      url: '/msp/invoices/invoice-1#item-item-1',
      acl: { requiredPermission: 'invoice:read', clientScopeId: 'client-1' },
      sourceUpdatedAt: new Date('2026-05-13T12:00:00.000Z'),
    };
    const annotationDoc: SearchDoc = {
      tenant: 'tenant-1',
      objectType: 'invoice_annotation',
      objectId: 'annotation-1',
      parentType: 'invoice',
      parentId: 'invoice-1',
      title: 'INV-1001',
      url: '/msp/invoices/invoice-1#annotation-annotation-1',
      acl: { requiredPermission: 'invoice:read', clientScopeId: 'client-1' },
      sourceUpdatedAt: new Date('2026-05-13T12:00:00.000Z'),
    };
    const itemRows = [{ item_id: 'item-1' }];
    const annotationRows = [{ annotation_id: 'annotation-1' }];
    const makeQuery = <T extends object>(rows: T[]) => {
      const query = {
        select: vi.fn(() => query),
        where: vi.fn(() => query),
        andWhere: vi.fn(() => query),
        orderBy: vi.fn(() => query),
        then: (resolve: (rows: T[]) => unknown, reject: (reason?: unknown) => unknown) =>
          Promise.resolve(rows).then(resolve, reject),
      };
      return query;
    };
    const itemQuery = makeQuery(itemRows);
    const annotationQuery = makeQuery(annotationRows);
    const knex = vi.fn((table: string) => {
      if (table === 'invoice_items') {
        return itemQuery;
      }
      if (table === 'invoice_annotations') {
        return annotationQuery;
      }
      throw new Error(`Unexpected table ${table}`);
    });

    mocks.createTenantKnex.mockResolvedValue({ knex, tenant: 'tenant-1' });
    vi.spyOn(invoiceIndexer, 'loadOne').mockResolvedValue(invoiceDoc);
    vi.spyOn(invoiceItemIndexer, 'loadOne').mockResolvedValue(itemDoc);
    vi.spyOn(invoiceAnnotationIndexer, 'loadOne').mockResolvedValue(annotationDoc);

    const event: Event = {
      id: 'event-7',
      eventType: 'INVOICE_UPDATED',
      timestamp: '2026-05-13T12:00:00.000Z',
      payload: {
        tenant: 'tenant-1',
        invoice_id: 'invoice-1',
      },
    } as Event;

    await handleSearchIndexEventForTest(event);

    expect(invoiceIndexer.loadOne).toHaveBeenCalledWith(knex, 'tenant-1', 'invoice-1');
    expect(itemQuery.where).toHaveBeenCalledWith('tenant', 'tenant-1');
    expect(itemQuery.andWhere).toHaveBeenCalledWith('invoice_id', 'invoice-1');
    expect(annotationQuery.where).toHaveBeenCalledWith('tenant', 'tenant-1');
    expect(annotationQuery.andWhere).toHaveBeenCalledWith('invoice_id', 'invoice-1');
    expect(invoiceItemIndexer.loadOne).toHaveBeenCalledWith(knex, 'tenant-1', 'item-1');
    expect(invoiceAnnotationIndexer.loadOne).toHaveBeenCalledWith(knex, 'tenant-1', 'annotation-1');
    expect(mocks.upsertSearchDoc).toHaveBeenNthCalledWith(1, knex, invoiceDoc);
    expect(mocks.upsertSearchDoc).toHaveBeenNthCalledWith(2, knex, itemDoc);
    expect(mocks.upsertSearchDoc).toHaveBeenNthCalledWith(3, knex, annotationDoc);
  });

  it('T077 cascades PROJECT_UPDATED to phases, tasks, and task comments', async () => {
    const projectDoc: SearchDoc = {
      tenant: 'tenant-1',
      objectType: 'project',
      objectId: 'project-1',
      title: 'Migration project',
      url: '/msp/projects/project-1',
      acl: { requiredPermission: 'project:read', clientScopeId: 'client-1' },
      sourceUpdatedAt: new Date('2026-05-13T12:00:00.000Z'),
    };
    const phaseDoc: SearchDoc = {
      tenant: 'tenant-1',
      objectType: 'project_phase',
      objectId: 'phase-1',
      parentType: 'project',
      parentId: 'project-1',
      title: 'Discovery',
      url: '/msp/projects/project-1/phases/phase-1',
      acl: { requiredPermission: 'project:read', clientScopeId: 'client-1' },
      sourceUpdatedAt: new Date('2026-05-13T12:00:00.000Z'),
    };
    const taskDoc: SearchDoc = {
      tenant: 'tenant-1',
      objectType: 'project_task',
      objectId: 'task-1',
      parentType: 'project',
      parentId: 'project-1',
      title: 'Inventory',
      url: '/msp/projects/project-1/tasks/task-1',
      acl: { requiredPermission: 'project:read', clientScopeId: 'client-1' },
      sourceUpdatedAt: new Date('2026-05-13T12:00:00.000Z'),
    };
    const taskCommentDoc: SearchDoc = {
      tenant: 'tenant-1',
      objectType: 'project_task_comment',
      objectId: 'task-comment-1',
      parentType: 'project_task',
      parentId: 'task-1',
      title: 'Inventory',
      url: '/msp/projects/project-1/tasks/task-1#comment-task-comment-1',
      acl: { requiredPermission: 'project:read', clientScopeId: 'client-1' },
      sourceUpdatedAt: new Date('2026-05-13T12:00:00.000Z'),
    };
    const makeQuery = <T extends object>(rows: T[]) => {
      const joinContext = {
        on: vi.fn(() => joinContext),
        andOn: vi.fn(() => joinContext),
      };
      const query = {
        join: vi.fn((_table: string, callback: (this: typeof joinContext) => void) => {
          callback.call(joinContext);
          return query;
        }),
        select: vi.fn(() => query),
        where: vi.fn(() => query),
        andWhere: vi.fn(() => query),
        orderBy: vi.fn(() => query),
        limit: vi.fn(() => query),
        then: (resolve: (rows: T[]) => unknown, reject: (reason?: unknown) => unknown) =>
          Promise.resolve(rows).then(resolve, reject),
      };
      return query;
    };
    const phaseQuery = makeQuery([{ phase_id: 'phase-1' }]);
    const taskQuery = makeQuery([{ task_id: 'task-1' }]);
    const taskCommentQuery = makeQuery([{ task_comment_id: 'task-comment-1' }]);
    const knex = vi.fn((table: string) => {
      if (table === 'project_phases') {
        return phaseQuery;
      }
      if (table === 'project_tasks as pt') {
        return taskQuery;
      }
      if (table === 'project_task_comments as ptc') {
        return taskCommentQuery;
      }
      throw new Error(`Unexpected table ${table}`);
    });

    mocks.createTenantKnex.mockResolvedValue({ knex, tenant: 'tenant-1' });
    vi.spyOn(projectIndexer, 'loadOne').mockResolvedValue(projectDoc);
    vi.spyOn(projectPhaseIndexer, 'loadOne').mockResolvedValue(phaseDoc);
    vi.spyOn(projectTaskIndexer, 'loadOne').mockResolvedValue(taskDoc);
    vi.spyOn(projectTaskCommentIndexer, 'loadOne').mockResolvedValue(taskCommentDoc);

    const event: Event = {
      id: 'event-8',
      eventType: 'PROJECT_UPDATED',
      timestamp: '2026-05-13T12:00:00.000Z',
      payload: {
        tenant: 'tenant-1',
        project_id: 'project-1',
      },
    } as Event;

    await handleSearchIndexEventForTest(event);

    expect(projectIndexer.loadOne).toHaveBeenCalledWith(knex, 'tenant-1', 'project-1');
    expect(phaseQuery.where).toHaveBeenCalledWith('tenant', 'tenant-1');
    expect(phaseQuery.andWhere).toHaveBeenCalledWith('project_id', 'project-1');
    expect(taskQuery.where).toHaveBeenCalledWith('pt.tenant', 'tenant-1');
    expect(taskQuery.andWhere).toHaveBeenCalledWith('pp.project_id', 'project-1');
    expect(taskCommentQuery.where).toHaveBeenCalledWith('ptc.tenant', 'tenant-1');
    expect(taskCommentQuery.andWhere).toHaveBeenCalledWith('pp.project_id', 'project-1');
    expect(projectPhaseIndexer.loadOne).toHaveBeenCalledWith(knex, 'tenant-1', 'phase-1');
    expect(projectTaskIndexer.loadOne).toHaveBeenCalledWith(knex, 'tenant-1', 'task-1');
    expect(projectTaskCommentIndexer.loadOne).toHaveBeenCalledWith(knex, 'tenant-1', 'task-comment-1');
    expect(mocks.upsertSearchDoc).toHaveBeenNthCalledWith(1, knex, projectDoc);
    expect(mocks.upsertSearchDoc).toHaveBeenNthCalledWith(2, knex, phaseDoc);
    expect(mocks.upsertSearchDoc).toHaveBeenNthCalledWith(3, knex, taskDoc);
    expect(mocks.upsertSearchDoc).toHaveBeenNthCalledWith(4, knex, taskCommentDoc);
  });

  it('T078 re-indexes documents after association changes update client scope', async () => {
    const knex = { client: 'knex' };
    const doc: SearchDoc = {
      tenant: 'tenant-1',
      objectType: 'document',
      objectId: 'document-1',
      title: 'Client onboarding notes',
      url: '/msp/documents/document-1',
      acl: { requiredPermission: 'document:read', clientScopeId: 'client-2' },
      sourceUpdatedAt: new Date('2026-05-13T12:00:00.000Z'),
    };

    mocks.createTenantKnex.mockResolvedValue({ knex, tenant: 'tenant-1' });
    vi.spyOn(documentIndexer, 'loadOne').mockResolvedValue(doc);

    const event: Event = {
      id: 'event-9',
      eventType: 'DOCUMENT_ASSOCIATED',
      timestamp: '2026-05-13T12:00:00.000Z',
      payload: {
        tenant: 'tenant-1',
        document_id: 'document-1',
        entity_type: 'client',
        entity_id: 'client-2',
      },
    } as Event;

    await handleSearchIndexEventForTest(event);

    expect(documentIndexer.loadOne).toHaveBeenCalledWith(knex, 'tenant-1', 'document-1');
    expect(mocks.upsertSearchDoc).toHaveBeenCalledWith(knex, doc);
    expect(mocks.deleteSearchDoc).not.toHaveBeenCalled();
  });

  it('T079 enqueues visible-user reindex after user role changes', async () => {
    const knex = { client: 'knex' };
    const userDoc: SearchDoc = {
      tenant: 'tenant-1',
      objectType: 'user',
      objectId: 'user-1',
      title: 'Alex Technician',
      url: '/msp/team/user-1',
      acl: { requiredPermission: 'user:read' },
      sourceUpdatedAt: new Date('2026-05-13T12:00:00.000Z'),
    };

    mocks.createTenantKnex.mockResolvedValue({ knex, tenant: 'tenant-1' });
    mocks.scheduleSearchVisibleUserReindexJob.mockResolvedValue('job-1');
    vi.spyOn(userIndexer, 'loadOne').mockResolvedValue(userDoc);

    const event: Event = {
      id: 'event-10',
      eventType: 'USER_ROLES_UPDATED',
      timestamp: '2026-05-13T12:00:00.000Z',
      payload: {
        tenant: 'tenant-1',
        user_id: 'user-1',
      },
    } as Event;

    await handleSearchIndexEventForTest(event);

    expect(userIndexer.loadOne).toHaveBeenCalledWith(knex, 'tenant-1', 'user-1');
    expect(mocks.upsertSearchDoc).toHaveBeenCalledWith(knex, userDoc);
    expect(mocks.scheduleSearchVisibleUserReindexJob).toHaveBeenCalledWith('tenant-1', 'user-1');
  });

  it('T170 upserts a ticket search document for TICKET_CREATED immediately', async () => {
    const knex = { client: 'knex' };
    const doc: SearchDoc = {
      tenant: 'tenant-1',
      objectType: 'ticket',
      objectId: 'ticket-1',
      title: 'New printer issue',
      subtitle: 'ACME Corp | TIC-1023',
      url: '/msp/tickets/ticket-1',
      metadata: { identifier: 'TIC-1023' },
      acl: { requiredPermission: 'ticket:read', clientScopeId: 'client-1' },
      sourceUpdatedAt: new Date('2026-05-13T12:00:00.000Z'),
    };

    mocks.createTenantKnex.mockResolvedValue({ knex, tenant: 'tenant-1' });
    vi.spyOn(ticketIndexer, 'loadOne').mockResolvedValue(doc);

    const event: Event = {
      id: 'event-11',
      eventType: 'TICKET_CREATED',
      timestamp: '2026-05-13T12:00:00.000Z',
      payload: {
        tenant: 'tenant-1',
        ticket_id: 'ticket-1',
      },
    } as Event;

    await handleSearchIndexEventForTest(event);

    expect(mocks.createTenantKnex).toHaveBeenCalledWith('tenant-1');
    expect(ticketIndexer.loadOne).toHaveBeenCalledWith(knex, 'tenant-1', 'ticket-1');
    expect(mocks.upsertSearchDoc).toHaveBeenCalledWith(knex, doc);
    expect(mocks.deleteSearchDoc).not.toHaveBeenCalled();
  });

  it('T171 deletes a ticket search document for TICKET_DELETED immediately', async () => {
    const knex = { client: 'knex' };
    const loadOne = vi.spyOn(ticketIndexer, 'loadOne');
    mocks.createTenantKnex.mockResolvedValue({ knex, tenant: 'tenant-1' });

    const event: Event = {
      id: 'event-12',
      eventType: 'TICKET_DELETED',
      timestamp: '2026-05-13T12:00:00.000Z',
      payload: {
        tenant: 'tenant-1',
        ticket_id: 'ticket-1',
      },
    } as Event;

    await handleSearchIndexEventForTest(event);

    expect(mocks.createTenantKnex).toHaveBeenCalledWith('tenant-1');
    expect(mocks.deleteSearchDoc).toHaveBeenCalledWith(knex, 'tenant-1', 'ticket', 'ticket-1');
    expect(mocks.upsertSearchDoc).not.toHaveBeenCalled();
    expect(loadOne).not.toHaveBeenCalled();
  });

  it('T206 deletes a ticket comment search document for TICKET_COMMENT_DELETED', async () => {
    const knex = { client: 'knex' };
    const loadOne = vi.spyOn(ticketCommentIndexer, 'loadOne');
    mocks.createTenantKnex.mockResolvedValue({ knex, tenant: 'tenant-1' });

    const event: Event = {
      id: 'event-206',
      eventType: 'TICKET_COMMENT_DELETED',
      timestamp: '2026-05-15T12:00:00.000Z',
      payload: {
        tenantId: 'tenant-1',
        ticketId: 'ticket-1',
        commentId: 'comment-1',
        userId: 'user-1',
      },
    } as Event;

    await handleSearchIndexEventForTest(event);

    expect(mocks.createTenantKnex).toHaveBeenCalledWith('tenant-1');
    expect(mocks.deleteSearchDoc).toHaveBeenCalledWith(knex, 'tenant-1', 'ticket_comment', 'comment-1');
    expect(mocks.upsertSearchDoc).not.toHaveBeenCalled();
    expect(loadOne).not.toHaveBeenCalled();
  });

  it('T209 deletes a status search document for STATUS_DELETED', async () => {
    const knex = { client: 'knex' };
    const loadOne = vi.spyOn(statusIndexer, 'loadOne');
    mocks.createTenantKnex.mockResolvedValue({ knex, tenant: 'tenant-1' });

    const event: Event = {
      id: 'event-209',
      eventType: 'STATUS_DELETED',
      timestamp: '2026-05-15T12:00:00.000Z',
      payload: {
        tenantId: 'tenant-1',
        statusId: 'status-1',
        statusType: 'ticket',
        boardId: 'board-1',
        userId: 'user-1',
      },
    } as Event;

    await handleSearchIndexEventForTest(event);

    expect(mocks.createTenantKnex).toHaveBeenCalledWith('tenant-1');
    expect(mocks.deleteSearchDoc).toHaveBeenCalledWith(knex, 'tenant-1', 'status', 'status-1');
    expect(mocks.upsertSearchDoc).not.toHaveBeenCalled();
    expect(loadOne).not.toHaveBeenCalled();
  });

  it('T210 upserts a status search document for STATUS_CREATED', async () => {
    const knex = { client: 'knex' };
    const doc: SearchDoc = {
      tenant: 'tenant-1',
      objectType: 'status',
      objectId: 'status-1',
      title: 'Awaiting Customer',
      subtitle: 'Service Desk',
      url: '/msp/tickets?statusId=status-1&boardId=board-1',
      metadata: { status_type: 'ticket', board_id: 'board-1', is_closed: false },
      acl: { requiredPermission: 'ticket:read' },
      sourceUpdatedAt: new Date('2026-05-15T12:00:00.000Z'),
    };

    mocks.createTenantKnex.mockResolvedValue({ knex, tenant: 'tenant-1' });
    vi.spyOn(statusIndexer, 'loadOne').mockResolvedValue(doc);

    const event: Event = {
      id: 'event-210',
      eventType: 'STATUS_CREATED',
      timestamp: '2026-05-15T12:00:00.000Z',
      payload: {
        tenantId: 'tenant-1',
        statusId: 'status-1',
        statusType: 'ticket',
        boardId: 'board-1',
      },
    } as Event;

    await handleSearchIndexEventForTest(event);

    expect(statusIndexer.loadOne).toHaveBeenCalledWith(knex, 'tenant-1', 'status-1');
    expect(mocks.upsertSearchDoc).toHaveBeenCalledWith(knex, doc);
    expect(mocks.deleteSearchDoc).not.toHaveBeenCalled();
  });

  it('T211 cascades PROJECT_TASK_UPDATED to the task comments', async () => {
    const taskDoc: SearchDoc = {
      tenant: 'tenant-1',
      objectType: 'project_task',
      objectId: 'task-1',
      parentType: 'project',
      parentId: 'project-2',
      title: 'Moved task',
      url: '/msp/projects/project-2/tasks/task-1',
      acl: { requiredPermission: 'project:read' },
      sourceUpdatedAt: new Date('2026-05-15T12:00:00.000Z'),
    };
    const taskCommentDoc1: SearchDoc = {
      tenant: 'tenant-1',
      objectType: 'project_task_comment',
      objectId: 'task-comment-1',
      parentType: 'project_task',
      parentId: 'task-1',
      title: 'Moved task',
      url: '/msp/projects/project-2/tasks/task-1#comment-task-comment-1',
      acl: { requiredPermission: 'project:read' },
      sourceUpdatedAt: new Date('2026-05-15T12:00:00.000Z'),
    };
    const taskCommentDoc2: SearchDoc = {
      ...taskCommentDoc1,
      objectId: 'task-comment-2',
      url: '/msp/projects/project-2/tasks/task-1#comment-task-comment-2',
    };
    const commentRows = [{ task_comment_id: 'task-comment-1' }, { task_comment_id: 'task-comment-2' }];
    const commentQuery = {
      select: vi.fn(() => commentQuery),
      where: vi.fn(() => commentQuery),
      andWhere: vi.fn(() => commentQuery),
      orderBy: vi.fn(() => commentQuery),
      then: (resolve: (rows: typeof commentRows) => unknown, reject: (reason?: unknown) => unknown) =>
        Promise.resolve(commentRows).then(resolve, reject),
    };
    const knex = vi.fn((table: string) => {
      expect(table).toBe('project_task_comments');
      return commentQuery;
    });

    mocks.createTenantKnex.mockResolvedValue({ knex, tenant: 'tenant-1' });
    vi.spyOn(projectTaskIndexer, 'loadOne').mockResolvedValue(taskDoc);
    vi.spyOn(projectTaskCommentIndexer, 'loadOne')
      .mockResolvedValueOnce(taskCommentDoc1)
      .mockResolvedValueOnce(taskCommentDoc2);

    const event: Event = {
      id: 'event-211',
      eventType: 'PROJECT_TASK_UPDATED',
      timestamp: '2026-05-15T12:00:00.000Z',
      payload: {
        tenantId: 'tenant-1',
        projectId: 'project-2',
        phaseId: 'phase-9',
        taskId: 'task-1',
      },
    } as Event;

    await handleSearchIndexEventForTest(event);

    expect(projectTaskIndexer.loadOne).toHaveBeenCalledWith(knex, 'tenant-1', 'task-1');
    expect(commentQuery.where).toHaveBeenCalledWith('tenant', 'tenant-1');
    expect(commentQuery.andWhere).toHaveBeenCalledWith('task_id', 'task-1');
    expect(projectTaskCommentIndexer.loadOne).toHaveBeenNthCalledWith(1, knex, 'tenant-1', 'task-comment-1');
    expect(projectTaskCommentIndexer.loadOne).toHaveBeenNthCalledWith(2, knex, 'tenant-1', 'task-comment-2');
    expect(mocks.upsertSearchDoc).toHaveBeenNthCalledWith(1, knex, taskDoc);
    expect(mocks.upsertSearchDoc).toHaveBeenNthCalledWith(2, knex, taskCommentDoc1);
    expect(mocks.upsertSearchDoc).toHaveBeenNthCalledWith(3, knex, taskCommentDoc2);
  });

  it('T184 backfills a seed tenant then accepts live incremental updates', async () => {
    const knex = { client: 'knex' };
    const backfillDoc: SearchDoc = {
      tenant: 'tenant-1',
      objectType: 'client',
      objectId: 'client-backfill',
      title: 'Backfilled client',
      url: '/msp/clients/client-backfill',
      acl: { requiredPermission: 'client:read' },
      sourceUpdatedAt: new Date('2026-05-13T12:00:00.000Z'),
    };
    const ticketDoc: SearchDoc = {
      tenant: 'tenant-1',
      objectType: 'ticket',
      objectId: 'ticket-live',
      title: 'Live indexed ticket',
      url: '/msp/tickets/ticket-live',
      acl: { requiredPermission: 'ticket:read' },
      sourceUpdatedAt: new Date('2026-05-13T12:01:00.000Z'),
    };

    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(clientIndexer, 'loadBatch').mockImplementation(async (_knex, tenant, cursor) => (
      cursor === null ? [{ ...backfillDoc, tenant }] : []
    ));

    await runSearchBackfill({ tenant: 'tenant-1', type: 'client' }, knex as never);
    expect(mocks.upsertSearchDoc).toHaveBeenCalledWith(knex, backfillDoc);

    mocks.upsertSearchDoc.mockClear();
    process.env.SEARCH_INDEX_LIVE = 'true';
    mocks.createTenantKnex.mockResolvedValue({ knex, tenant: 'tenant-1' });
    vi.spyOn(ticketIndexer, 'loadOne').mockResolvedValue(ticketDoc);

    await handleSearchIndexEventForTest({
      id: 'event-13',
      eventType: 'TICKET_CREATED',
      timestamp: '2026-05-13T12:01:00.000Z',
      payload: {
        tenant: 'tenant-1',
        ticket_id: 'ticket-live',
      },
    } as Event);

    expect(ticketIndexer.loadOne).toHaveBeenCalledWith(knex, 'tenant-1', 'ticket-live');
    expect(mocks.upsertSearchDoc).toHaveBeenCalledWith(knex, ticketDoc);
  });

  it('T185 handles 100 ticket updates without indexing lag buildup', async () => {
    const commentQuery = {
      select: vi.fn(() => commentQuery),
      where: vi.fn(() => commentQuery),
      andWhere: vi.fn(() => commentQuery),
      orderBy: vi.fn(() => commentQuery),
      then: (
        resolve: (rows: Array<{ comment_id: string }>) => unknown,
        reject: (reason?: unknown) => unknown,
      ) => Promise.resolve([]).then(resolve, reject),
    };
    const knex = vi.fn((table: string) => {
      if (table === 'comments') {
        return commentQuery;
      }
      throw new Error(`Unexpected table ${table}`);
    });

    mocks.createTenantKnex.mockResolvedValue({ knex, tenant: 'tenant-1' });
    vi.spyOn(ticketIndexer, 'loadOne').mockImplementation(async (_knex, tenant, ticketId) => ({
      tenant,
      objectType: 'ticket',
      objectId: ticketId,
      title: `Updated ${ticketId}`,
      url: `/msp/tickets/${ticketId}`,
      acl: { requiredPermission: 'ticket:read' },
      sourceUpdatedAt: new Date('2026-05-13T12:00:00.000Z'),
    }));

    const startedAt = performance.now();
    for (let index = 0; index < 100; index += 1) {
      await handleSearchIndexEventForTest({
        id: `event-stress-${index}`,
        eventType: 'TICKET_UPDATED',
        timestamp: '2026-05-13T12:00:00.000Z',
        payload: {
          tenant: 'tenant-1',
          ticket_id: `ticket-${index}`,
        },
      } as Event);
    }
    const elapsedMs = performance.now() - startedAt;

    expect(ticketIndexer.loadOne).toHaveBeenCalledTimes(100);
    expect(mocks.upsertSearchDoc).toHaveBeenCalledTimes(100);
    expect(commentQuery.andWhere).toHaveBeenCalledTimes(100);
    expect(elapsedMs).toBeLessThan(30_000);
  });

});
