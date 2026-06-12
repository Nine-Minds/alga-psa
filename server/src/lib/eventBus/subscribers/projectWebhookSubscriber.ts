import logger from '@alga-psa/core/logger';
import type { Event } from '@alga-psa/event-schemas';
import { getConnection } from '../../db/db';
import { getEventBus } from '../index';
import {
  isProjectTaskEvent,
  publicEventsForProject,
  type ProjectWebhookInternalEvent,
} from './webhook/webhookProjectEventMap';
import {
  buildProjectTaskWebhookPayload,
  buildProjectWebhookPayload,
  fetchProjectPhasesForWebhook,
  fetchProjectTaskCountsForWebhook,
  type ProjectTaskWebhookPayload,
  type ProjectWebhookPayload,
  type ProjectWebhookSourceEvent,
} from './webhook/webhookProjectPayload';
import { applyPayloadAllowlist, webhookEntityForEventType } from '../../webhooks/payloadFields';
import { webhookModel } from '../../webhooks/webhookModel';
import { WebhookDeliveryQueue } from '../../webhooks/WebhookDeliveryQueue';

export const WEBHOOK_PROJECT_EVENT_TYPES = [
  'PROJECT_CREATED',
  'PROJECT_UPDATED',
  'PROJECT_STATUS_CHANGED',
  'PROJECT_ASSIGNED',
  'PROJECT_CLOSED',
  'PROJECT_TASK_CREATED',
  'PROJECT_TASK_UPDATED',
  'PROJECT_TASK_STATUS_CHANGED',
  'PROJECT_TASK_ASSIGNED',
  'PROJECT_TASK_COMPLETED',
] as const satisfies readonly ProjectWebhookInternalEvent[];

let isRegistered = false;

export async function registerProjectWebhookSubscriber(): Promise<void> {
  if (isRegistered) {
    return;
  }

  for (const eventType of WEBHOOK_PROJECT_EVENT_TYPES) {
    await getEventBus().subscribe(eventType, handleProjectEvent);
  }

  isRegistered = true;
  logger.info('[ProjectWebhookSubscriber] Registered webhook project event handlers');
}

export async function unregisterProjectWebhookSubscriber(): Promise<void> {
  if (!isRegistered) {
    return;
  }

  for (const eventType of WEBHOOK_PROJECT_EVENT_TYPES) {
    await getEventBus().unsubscribe(eventType, handleProjectEvent);
  }

  isRegistered = false;
  logger.info('[ProjectWebhookSubscriber] Unregistered webhook project event handlers');
}

export async function handleProjectEvent(event: unknown): Promise<void> {
  const rawEventType =
    typeof event === 'object' && event !== null && 'eventType' in event
      ? String((event as { eventType?: unknown }).eventType)
      : 'unknown';

  try {
    const internalEvent = toProjectWebhookSourceEvent(event);
    if (!internalEvent) {
      logger.info('[ProjectWebhookSubscriber] event rejected by toProjectWebhookSourceEvent', {
        eventType: rawEventType,
      });
      return;
    }

    const publicEvents = publicEventsForProject(internalEvent.eventType);
    if (publicEvents.length === 0) {
      return;
    }

    const tenantId = internalEvent.payload.tenantId;
    const taskEvent = isProjectTaskEvent(internalEvent.eventType);
    const entityId = taskEvent
      ? resolveTaskId(internalEvent)
      : internalEvent.payload.projectId;

    if (!entityId) {
      return;
    }

    const knex = await getConnection(tenantId);
    const basePayload = taskEvent
      ? await buildProjectTaskWebhookPayload(internalEvent, knex)
      : await buildProjectWebhookPayload(internalEvent, knex);

    let phasesPromise: Promise<ProjectWebhookPayload['phases']> | null = null;
    let taskCountsPromise: Promise<ProjectWebhookPayload['task_counts']> | null = null;

    for (const publicEventType of publicEvents) {
      const subscribers = await webhookModel.listForEventType(tenantId, publicEventType);
      if (subscribers.length === 0) {
        continue;
      }

      const matchingSubscribers = subscribers.filter((subscriber) =>
        matchesEntityIdFilter(subscriber.eventFilter, entityId),
      );
      if (matchingSubscribers.length === 0) {
        continue;
      }

      const entity = webhookEntityForEventType(publicEventType);
      const allowlistFor = (sub: {
        payloadFields: Record<string, string[] | null> | null | undefined;
      }): string[] | null => {
        if (sub.payloadFields == null) return null;
        const perEntity = sub.payloadFields[entity];
        return perEntity === undefined || perEntity === null ? null : perEntity;
      };

      const wantsFieldFor = (
        sub: { payloadFields: Record<string, string[] | null> | null | undefined },
        field: string,
      ) => {
        const fields = allowlistFor(sub);
        return fields === null || fields.includes(field);
      };

      const shouldFetchPhases = !taskEvent && matchingSubscribers.some((sub) =>
        wantsFieldFor(sub, 'phases')
      );
      const shouldFetchTaskCounts = !taskEvent && matchingSubscribers.some((sub) =>
        wantsFieldFor(sub, 'task_counts')
      );

      if (shouldFetchPhases && !phasesPromise) {
        phasesPromise = fetchProjectPhasesForWebhook(knex, tenantId, internalEvent.payload.projectId);
      }
      if (shouldFetchTaskCounts && !taskCountsPromise) {
        taskCountsPromise = fetchProjectTaskCountsForWebhook(knex, tenantId, internalEvent.payload.projectId);
      }

      const phases = shouldFetchPhases ? await phasesPromise : null;
      const taskCounts = shouldFetchTaskCounts ? await taskCountsPromise : null;

      for (const subscriber of matchingSubscribers) {
        const payloadWithOptIns = addOptInProjectSections(
          basePayload,
          !taskEvent && wantsFieldFor(subscriber, 'phases') ? phases ?? undefined : undefined,
          !taskEvent && wantsFieldFor(subscriber, 'task_counts') ? taskCounts ?? undefined : undefined,
        );
        const subscriberPayload = applyPayloadAllowlist(
          entity,
          payloadWithOptIns,
          allowlistFor(subscriber),
          taskEvent ? ['task_id'] : [],
        );

        await WebhookDeliveryQueue.getInstance().enqueue({
          webhookId: subscriber.webhookId,
          eventId: internalEvent.id,
          eventType: publicEventType,
          occurredAt: internalEvent.timestamp,
          tenantId,
          payload: subscriberPayload,
          attempt: 1,
          deliverAt: Date.now(),
        });
      }
    }
  } catch (error) {
    logger.error('[ProjectWebhookSubscriber] Failed to handle project event', {
      error: error instanceof Error ? error.message : 'Unknown error',
      eventType: rawEventType,
    });
  }
}

type ProjectEventPayloadShape = {
  tenantId: string;
  projectId: string;
  projectTaskId?: string;
  taskId?: string;
  occurredAt?: string;
  changes?: unknown;
  [key: string]: unknown;
};

type ProjectWebhookBusEvent = ProjectWebhookSourceEvent & {
  id: string;
  timestamp: string;
};

function toProjectWebhookSourceEvent(event: unknown): ProjectWebhookBusEvent | null {
  if (!event || typeof event !== 'object') {
    return null;
  }

  const candidate = event as Partial<Event> & {
    payload?: ProjectEventPayloadShape;
  };

  if (
    typeof candidate.id !== 'string'
    || typeof candidate.timestamp !== 'string'
    || typeof candidate.eventType !== 'string'
    || !WEBHOOK_PROJECT_EVENT_TYPES.includes(candidate.eventType as ProjectWebhookInternalEvent)
    || !candidate.payload
    || typeof candidate.payload.tenantId !== 'string'
    || typeof candidate.payload.projectId !== 'string'
  ) {
    return null;
  }

  const taskEvent = isProjectTaskEvent(candidate.eventType);
  if (taskEvent && !resolveTaskId({ payload: candidate.payload } as ProjectWebhookSourceEvent)) {
    return null;
  }

  return {
    id: candidate.id,
    timestamp: candidate.timestamp,
    eventType: candidate.eventType as ProjectWebhookInternalEvent,
    payload: candidate.payload,
  };
}

function resolveTaskId(event: ProjectWebhookSourceEvent): string | null {
  const taskId = event.payload.projectTaskId ?? event.payload.taskId;
  return typeof taskId === 'string' && taskId.length > 0 ? taskId : null;
}

function matchesEntityIdFilter(
  eventFilter: Record<string, unknown> | null,
  entityId: string,
): boolean {
  const entityIds = eventFilter?.entity_ids;

  if (!Array.isArray(entityIds) || entityIds.length === 0) {
    return true;
  }

  return entityIds.includes(entityId);
}

function addOptInProjectSections(
  payload: ProjectWebhookPayload | ProjectTaskWebhookPayload,
  phases?: ProjectWebhookPayload['phases'],
  taskCounts?: ProjectWebhookPayload['task_counts'],
): ProjectWebhookPayload | ProjectTaskWebhookPayload {
  if (!phases && !taskCounts) {
    return payload;
  }

  return {
    ...payload,
    ...(phases ? { phases } : {}),
    ...(taskCounts ? { task_counts: taskCounts } : {}),
  };
}
