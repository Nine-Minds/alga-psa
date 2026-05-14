import logger from '@alga-psa/core/logger';
import type { Event, EventType } from '@alga-psa/event-schemas';
import { createTenantKnex } from '@alga-psa/db';
import type { Knex } from 'knex';

import { getEventBus } from '../index';
import { allIndexers, getIndexer } from '../../search';
import { deleteSearchDoc, upsertSearchDoc } from '../../search/upsert';
import type { EntityIndexer, SearchObjectType } from '../../search/types';

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
};

function buildIndexersByEvent(): Map<EventType, EntityIndexer[]> {
  const byEvent = new Map<EventType, EntityIndexer[]>();

  for (const indexer of allIndexers()) {
    for (const eventType of indexer.sourceEvents) {
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

  const rows = await knex<{ comment_id: string }>('comments')
    .select('comment_id')
    .where({ tenant, ticket_id: ticketId })
    .orderBy('comment_id', 'asc');

  for (const row of rows) {
    const doc = await commentIndexer.loadOne(knex, tenant, row.comment_id);
    if (doc) {
      await upsertSearchDoc(knex, doc);
    }
  }

  return rows.length;
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
  }
}
