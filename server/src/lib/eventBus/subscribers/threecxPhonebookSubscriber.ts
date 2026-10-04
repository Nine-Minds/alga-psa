import logger from '@alga-psa/core/logger';
import { enqueueImmediateJob } from '@alga-psa/core';
import type { EventType } from '@alga-psa/event-schemas';
import { isEnterpriseEdition } from '@/lib/features';
import { getEventBus } from '../index';

// Inlined so this module never loads the jobs handler dist; the worker
// inlines forwarded job names for the same reason.
export const THREECX_PHONEBOOK_CONTACT_JOB = 'sync-threecx-phonebook-contact';

export const THREECX_PHONEBOOK_EVENT_TYPES: EventType[] = [
  'CONTACT_CREATED',
  'CONTACT_UPDATED',
  'CONTACT_ARCHIVED',
  'CONTACT_DELETED',
];

type EeThreecxModule = {
  getThreecxProviderConfig: (tenantId: string) => Promise<{ config: unknown } | null>;
  isThreecxPhonebookActive: (config: unknown) => boolean;
};

let isRegistered = false;

export async function handleThreecxPhonebookContactEvent(event: unknown): Promise<void> {
  if (!isEnterpriseEdition()) return;
  const payload =
    typeof event === 'object' && event !== null && 'payload' in event
      ? ((event as { payload?: Record<string, unknown> }).payload ?? {})
      : {};
  const tenantId = typeof payload.tenantId === 'string' ? payload.tenantId : null;
  const contactId = typeof payload.contactId === 'string' ? payload.contactId : null;
  if (!tenantId || !contactId) return;

  try {
    const threecx = (await import('@alga-psa/ee-threecx/lib')) as EeThreecxModule;
    const loaded = await threecx.getThreecxProviderConfig(tenantId);
    if (!loaded || !threecx.isThreecxPhonebookActive(loaded.config)) return;
    await enqueueImmediateJob(THREECX_PHONEBOOK_CONTACT_JOB, { tenantId, contactId });
  } catch (error) {
    logger.error('[ThreecxPhonebookSubscriber] Failed to enqueue contact sync', {
      tenantId,
      contactId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function registerThreecxPhonebookSubscriber(): Promise<void> {
  if (isRegistered) return;
  if (!isEnterpriseEdition()) {
    logger.info('[ThreecxPhonebookSubscriber] Skipping registration outside Enterprise Edition');
    return;
  }
  const bus = getEventBus();
  for (const eventType of THREECX_PHONEBOOK_EVENT_TYPES) {
    await bus.subscribe(eventType, handleThreecxPhonebookContactEvent, { subscriberId: 'threecxPhonebook' });
  }
  isRegistered = true;
  logger.info('[ThreecxPhonebookSubscriber] Registered');
}

export async function unregisterThreecxPhonebookSubscriber(): Promise<void> {
  if (!isRegistered) return;
  const bus = getEventBus();
  for (const eventType of THREECX_PHONEBOOK_EVENT_TYPES) {
    await bus.unsubscribe(eventType, handleThreecxPhonebookContactEvent);
  }
  isRegistered = false;
}
