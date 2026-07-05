import logger from '@alga-psa/core/logger';
import type { Event, EventType } from '@alga-psa/event-schemas';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';

import { getEventBus } from '../index';
import { allIndexers, getIndexer } from '@alga-psa/search';
import { deleteSearchDoc, upsertSearchDoc } from '@alga-psa/search/upsert';
import type { EntityIndexer, SearchObjectType } from '@alga-psa/types';

let isRegistered = false;
let subscribedEventTypes: EventType[] = [];

const OBJECT_ID_FIELDS: Record<SearchObjectType, string[]> = {
  client: ['clientId', 'client_id'],
  contact: ['contactNameId', 'contact_name_id', 'contactId', 'contact_id'],
  user: ['userId', 'user_id'],
  ticket: ['ticketId', 'ticket_id'],
  ticket_comment: ['commentId', 'comment_id'],
  project: ['projectId', 'project_id'],
  project_phase: ['phaseId', 'phase_id'],
  project_task: ['taskId', 'task_id'],
  project_task_comment: ['taskCommentId', 'task_comment_id', 'commentId', 'comment_id'],
  asset: ['assetId', 'asset_id'],
  sales_order: ['soId', 'so_id'],
  purchase_order: ['poId', 'po_id'],
  stock_unit: ['unitId', 'unit_id'],
  invoice: ['invoiceId', 'invoice_id'],
  invoice_item: ['itemId', 'item_id', 'invoiceItemId', 'invoice_item_id'],
  invoice_annotation: ['annotationId', 'annotation_id'],
  contract: ['contractId', 'contract_id'],
  client_contract: ['clientContractId', 'client_contract_id'],
  document: ['documentId', 'document_id'],
  kb_article: ['articleId', 'article_id'],
  service_catalog: ['serviceId', 'service_id'],
  service_request_submission: ['submissionId', 'submission_id'],
  service_request_definition: ['definitionId', 'definition_id'],
  workflow_task: ['taskId', 'task_id'],
  interaction: ['interactionId', 'interaction_id'],
  schedule_entry: ['entryId', 'entry_id', 'scheduleEntryId', 'schedule_entry_id'],
  time_entry: ['timeEntryId', 'time_entry_id', 'entryId', 'entry_id'],
  board: ['boardId', 'board_id'],
  category: ['categoryId', 'category_id'],
  tag: ['tagId', 'tag_id'],
  status: ['statusId', 'status_id'],
};

const CASCADE_BATCH_SIZE = 500;

function tenantScopedTable<Row extends object>(
  knex: Knex,
  tenant: string,
  tableExpression: string,
): Knex.QueryBuilder<Row, Row[]> {
  return tenantDb(knex, tenant).table<Row>(tableExpression);
}

function buildIndexersByEvent(): Map<EventType, EntityIndexer[]> {
  const byEvent = new Map<EventType, EntityIndexer[]>();

  for (const indexer of allIndexers()) {
    for (const eventType of indexer.sourceEvents as readonly EventType[]) {
      const existing = byEvent.get(eventType) ?? [];
      existing.push(indexer);
      byEvent.set(eventType, existing);
    }
  }

  return byEvent;
}

export function resolveSearchIndexersForEvent(eventType: EventType): EntityIndexer[] {
  return buildIndexersByEvent().get(eventType) ?? [];
}

export function getSearchIndexSubscriberEventTypes(): EventType[] {
  return [...buildIndexersByEvent().keys()];
}

function payloadRecord(event: Event): Record<string, unknown> {
  return event.payload && typeof event.payload === 'object'
    ? event.payload as Record<string, unknown>
    : {};
}

function extractTenant(event: Event): string | undefined {
  const payload = payloadRecord(event);
  const value = payload.tenantId ?? payload.tenant;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function extractObjectId(event: Event, objectType: SearchObjectType): string | undefined {
  const payload = payloadRecord(event);

  for (const field of OBJECT_ID_FIELDS[objectType]) {
    const value = payload[field];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }

  return undefined;
}

function isDeleteEvent(eventType: EventType): boolean {
  return eventType.endsWith('_DELETED') || eventType === 'TAG_DEFINITION_DELETED';
}

export function isSearchIndexLiveEnabled(): boolean {
  return process.env.SEARCH_INDEX_LIVE === 'true';
}

async function reindexTicketComments(knex: Knex, tenant: string, ticketId: string): Promise<number> {
  const commentIndexer = getIndexer('ticket_comment');
  if (!commentIndexer) {
    logger.warn('[SearchIndexSubscriber] Ticket comment indexer is not registered');
    return 0;
  }

  const rows = await tenantScopedTable<{ comment_id: string }>(knex, tenant, 'comments')
    .select('comment_id')
    .where('ticket_id', ticketId)
    .orderBy('comment_id', 'asc');

  for (const row of rows) {
    const doc = await commentIndexer.loadOne(knex, tenant, row.comment_id);
    if (doc) {
      await upsertSearchDoc(knex, doc);
    }
  }

  return rows.length;
}

async function reindexProjectTaskComments(knex: Knex, tenant: string, taskId: string): Promise<number> {
  const commentIndexer = getIndexer('project_task_comment');
  if (!commentIndexer) {
    logger.warn('[SearchIndexSubscriber] Project task comment indexer is not registered');
    return 0;
  }

  // Task-comment rows denormalize the parent task's project_id (and task name)
  // into their URL/title. When a task is renamed or moved between phases —
  // possibly into a different project — those comments go stale until the
  // daily reconcile unless we re-index them here.
  const rows = await tenantScopedTable<{ task_comment_id: string }>(knex, tenant, 'project_task_comments')
    .select('task_comment_id')
    .where('task_id', taskId)
    .orderBy('task_comment_id', 'asc');

  for (const row of rows) {
    const doc = await commentIndexer.loadOne(knex, tenant, row.task_comment_id);
    if (doc) {
      await upsertSearchDoc(knex, doc);
    }
  }

  return rows.length;
}

async function reindexInvoiceChildren(knex: Knex, tenant: string, invoiceId: string): Promise<{
  items: number;
  annotations: number;
}> {
  const itemIndexer = getIndexer('invoice_item');
  const annotationIndexer = getIndexer('invoice_annotation');
  let items = 0;
  let annotations = 0;

  if (itemIndexer) {
    const rows = await tenantScopedTable<{ item_id: string }>(knex, tenant, 'invoice_items')
      .select('item_id')
      .where('invoice_id', invoiceId)
      .orderBy('item_id', 'asc');

    for (const row of rows) {
      const doc = await itemIndexer.loadOne(knex, tenant, row.item_id);
      if (doc) {
        await upsertSearchDoc(knex, doc);
      }
    }
    items = rows.length;
  } else {
    logger.warn('[SearchIndexSubscriber] Invoice item indexer is not registered');
  }

  if (annotationIndexer) {
    const rows = await tenantScopedTable<{ annotation_id: string }>(
      knex,
      tenant,
      'invoice_annotations',
    )
      .select('annotation_id')
      .where('invoice_id', invoiceId)
      .orderBy('annotation_id', 'asc');

    for (const row of rows) {
      const doc = await annotationIndexer.loadOne(knex, tenant, row.annotation_id);
      if (doc) {
        await upsertSearchDoc(knex, doc);
      }
    }
    annotations = rows.length;
  } else {
    logger.warn('[SearchIndexSubscriber] Invoice annotation indexer is not registered');
  }

  return { items, annotations };
}

async function reindexProjectChildren(knex: Knex, tenant: string, projectId: string): Promise<{
  phases: number;
  tasks: number;
  taskComments: number;
}> {
  const phaseIndexer = getIndexer('project_phase');
  const taskIndexer = getIndexer('project_task');
  const taskCommentIndexer = getIndexer('project_task_comment');
  let phases = 0;
  let tasks = 0;
  let taskComments = 0;

  if (phaseIndexer) {
    let cursor: string | undefined;
    while (true) {
      const query = tenantScopedTable<{ phase_id: string }>(knex, tenant, 'project_phases')
        .select('phase_id')
        .where('project_id', projectId)
        .orderBy('phase_id', 'asc')
        .limit(CASCADE_BATCH_SIZE);

      if (cursor) {
        query.andWhere('phase_id', '>', cursor);
      }

      const rows = await query;
      if (rows.length === 0) {
        break;
      }

      for (const row of rows) {
        const doc = await phaseIndexer.loadOne(knex, tenant, row.phase_id);
        if (doc) {
          await upsertSearchDoc(knex, doc);
        }
      }

      phases += rows.length;
      cursor = rows[rows.length - 1]?.phase_id;
      if (rows.length < CASCADE_BATCH_SIZE) {
        break;
      }
    }
  } else {
    logger.warn('[SearchIndexSubscriber] Project phase indexer is not registered');
  }

  if (taskIndexer) {
    let cursor: string | undefined;
    while (true) {
      const db = tenantDb(knex, tenant);
      const query = db.table<{ task_id: string }>('project_tasks as pt')
        .select('pt.task_id')
        .where('pp.project_id', projectId)
        .orderBy('pt.task_id', 'asc')
        .limit(CASCADE_BATCH_SIZE);
      db.tenantJoin(query, 'project_phases as pp', 'pp.phase_id', 'pt.phase_id');

      if (cursor) {
        query.andWhere('pt.task_id', '>', cursor);
      }

      const rows = await query;
      if (rows.length === 0) {
        break;
      }

      for (const row of rows) {
        const doc = await taskIndexer.loadOne(knex, tenant, row.task_id);
        if (doc) {
          await upsertSearchDoc(knex, doc);
        }
      }

      tasks += rows.length;
      cursor = rows[rows.length - 1]?.task_id;
      if (rows.length < CASCADE_BATCH_SIZE) {
        break;
      }
    }
  } else {
    logger.warn('[SearchIndexSubscriber] Project task indexer is not registered');
  }

  if (taskCommentIndexer) {
    let cursor: string | undefined;
    while (true) {
      const db = tenantDb(knex, tenant);
      const query = db.table<{ task_comment_id: string }>('project_task_comments as ptc')
        .select('ptc.task_comment_id')
        .where('pp.project_id', projectId)
        .orderBy('ptc.task_comment_id', 'asc')
        .limit(CASCADE_BATCH_SIZE);
      db.tenantJoin(query, 'project_tasks as pt', 'pt.task_id', 'ptc.task_id');
      db.tenantJoin(query, 'project_phases as pp', 'pp.phase_id', 'pt.phase_id');

      if (cursor) {
        query.andWhere('ptc.task_comment_id', '>', cursor);
      }

      const rows = await query;
      if (rows.length === 0) {
        break;
      }

      for (const row of rows) {
        const doc = await taskCommentIndexer.loadOne(knex, tenant, row.task_comment_id);
        if (doc) {
          await upsertSearchDoc(knex, doc);
        }
      }

      taskComments += rows.length;
      cursor = rows[rows.length - 1]?.task_comment_id;
      if (rows.length < CASCADE_BATCH_SIZE) {
        break;
      }
    }
  } else {
    logger.warn('[SearchIndexSubscriber] Project task comment indexer is not registered');
  }

  return { phases, tasks, taskComments };
}

async function enqueueVisibleUserReindex(tenant: string, userId: string, event: Event): Promise<void> {
  try {
    const { scheduleSearchVisibleUserReindexJob } = await import('../../jobs');
    const jobId = await scheduleSearchVisibleUserReindexJob(tenant, userId);
    logger.debug('[SearchIndexSubscriber] Enqueued visible-user search re-index', {
      eventType: event.eventType,
      eventId: event.id,
      tenant,
      userId,
      jobId,
    });
  } catch (error) {
    logger.error('[SearchIndexSubscriber] Failed to enqueue visible-user search re-index', {
      eventType: event.eventType,
      eventId: event.id,
      tenant,
      userId,
      error,
    });
  }
}

export async function registerSearchIndexSubscriber(): Promise<void> {
  if (isRegistered) {
    return;
  }

  const indexersByEvent = buildIndexersByEvent();
  subscribedEventTypes = [...indexersByEvent.keys()];

  for (const eventType of subscribedEventTypes) {
    await getEventBus().subscribe(eventType, handleSearchIndexEvent);
  }

  isRegistered = true;
  logger.info('[SearchIndexSubscriber] Registered search index subscriber', {
    eventTypes: subscribedEventTypes,
  });
}

export async function unregisterSearchIndexSubscriber(): Promise<void> {
  if (!isRegistered) {
    return;
  }

  for (const eventType of subscribedEventTypes) {
    await getEventBus().unsubscribe(eventType, handleSearchIndexEvent);
  }

  const eventTypes = subscribedEventTypes;
  subscribedEventTypes = [];
  isRegistered = false;
  logger.info('[SearchIndexSubscriber] Unregistered search index subscriber', { eventTypes });
}

async function handleSearchIndexEvent(event: Event): Promise<void> {
  const indexers = resolveSearchIndexersForEvent(event.eventType);

  if (indexers.length === 0) {
    logger.warn('[SearchIndexSubscriber] Received event without a registered indexer', {
      eventType: event.eventType,
      eventId: event.id,
    });
    return;
  }

  logger.debug('[SearchIndexSubscriber] Resolved event to search indexers', {
    eventType: event.eventType,
    eventId: event.id,
    objectTypes: indexers.map((indexer) => indexer.objectType),
  });

  if (!isSearchIndexLiveEnabled()) {
    logger.debug('[SearchIndexSubscriber] Live indexing disabled; acknowledging event without DB writes', {
      eventType: event.eventType,
      eventId: event.id,
      searchIndexLive: process.env.SEARCH_INDEX_LIVE ?? 'false',
    });
    return;
  }

  const tenant = extractTenant(event);
  if (!tenant) {
    logger.warn('[SearchIndexSubscriber] Event payload missing tenant', {
      eventType: event.eventType,
      eventId: event.id,
    });
    return;
  }

  const { knex } = await createTenantKnex(tenant);

  if (isDeleteEvent(event.eventType)) {
    for (const indexer of indexers) {
      const objectId = extractObjectId(event, indexer.objectType);
      if (!objectId) {
        logger.warn('[SearchIndexSubscriber] Delete event payload missing source object id', {
          eventType: event.eventType,
          eventId: event.id,
          objectType: indexer.objectType,
        });
        continue;
      }

      await deleteSearchDoc(knex, tenant, indexer.objectType, objectId);
      logger.debug('[SearchIndexSubscriber] Deleted search index row', {
        eventType: event.eventType,
        eventId: event.id,
        objectType: indexer.objectType,
        objectId,
      });
    }
    return;
  }

  for (const indexer of indexers) {
    const objectId = extractObjectId(event, indexer.objectType);
    if (!objectId) {
      logger.warn('[SearchIndexSubscriber] Event payload missing source object id', {
        eventType: event.eventType,
        eventId: event.id,
        objectType: indexer.objectType,
      });
      continue;
    }

    const doc = await indexer.loadOne(knex, tenant, objectId);
    if (!doc) {
      logger.warn('[SearchIndexSubscriber] Source row missing during upsert event', {
        eventType: event.eventType,
        eventId: event.id,
        objectType: indexer.objectType,
        objectId,
      });
      await deleteSearchDoc(knex, tenant, indexer.objectType, objectId);
      continue;
    }

    await upsertSearchDoc(knex, doc);
    logger.debug('[SearchIndexSubscriber] Upserted search index row', {
      eventType: event.eventType,
      eventId: event.id,
      objectType: indexer.objectType,
      objectId,
    });

    if (event.eventType === 'TICKET_UPDATED' && indexer.objectType === 'ticket') {
      const count = await reindexTicketComments(knex, tenant, objectId);
      logger.debug('[SearchIndexSubscriber] Cascaded ticket comment re-index', {
        eventType: event.eventType,
        eventId: event.id,
        ticketId: objectId,
        count,
      });
    }

    if (event.eventType === 'INVOICE_UPDATED' && indexer.objectType === 'invoice') {
      const counts = await reindexInvoiceChildren(knex, tenant, objectId);
      logger.debug('[SearchIndexSubscriber] Cascaded invoice child re-index', {
        eventType: event.eventType,
        eventId: event.id,
        invoiceId: objectId,
        ...counts,
      });
    }

    if (event.eventType === 'PROJECT_UPDATED' && indexer.objectType === 'project') {
      const counts = await reindexProjectChildren(knex, tenant, objectId);
      logger.debug('[SearchIndexSubscriber] Cascaded project child re-index', {
        eventType: event.eventType,
        eventId: event.id,
        projectId: objectId,
        ...counts,
      });
    }

    if (event.eventType === 'PROJECT_TASK_UPDATED' && indexer.objectType === 'project_task') {
      const count = await reindexProjectTaskComments(knex, tenant, objectId);
      logger.debug('[SearchIndexSubscriber] Cascaded project task comment re-index', {
        eventType: event.eventType,
        eventId: event.id,
        taskId: objectId,
        count,
      });
    }

    if (event.eventType === 'USER_ROLES_UPDATED' && indexer.objectType === 'user') {
      await enqueueVisibleUserReindex(tenant, objectId, event);
    }
  }
}

export async function handleSearchIndexEventForTest(event: Event): Promise<void> {
  await handleSearchIndexEvent(event);
}
