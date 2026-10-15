import logger from '@alga-psa/core/logger';
import { runWithTenant } from '@alga-psa/db';

export const THREECX_PHONEBOOK_CONTACT_JOB = 'sync-threecx-phonebook-contact';
export const THREECX_PHONEBOOK_RECONCILE_JOB = 'reconcile-threecx-phonebook';

export interface ThreecxPhonebookContactJobData extends Record<string, unknown> {
  tenantId: string;
  contactId: string;
}

export interface ThreecxPhonebookReconcileJobData extends Record<string, unknown> {
  tenantId: string;
}

interface PhonebookCounts {
  created: number;
  updated: number;
  deleted: number;
  imported: number;
  skipped: number;
}

type EeThreecxModule = {
  getThreecxProviderConfig: (tenantId: string) => Promise<{ config: unknown } | null>;
  isThreecxPhonebookActive: (config: unknown) => boolean;
  syncThreecxPhonebookContact: (tenantId: string, contactId: string) => Promise<PhonebookCounts>;
  reconcileThreecxPhonebook: (
    tenantId: string,
  ) => Promise<{ ran: boolean; push?: PhonebookCounts; import?: PhonebookCounts }>;
};

const isEnterpriseEdition =
  (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
  (process.env.EDITION ?? '').toLowerCase() === 'enterprise' ||
  (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise';

function loadThreecx(): Promise<EeThreecxModule> {
  return import('@alga-psa/ee-threecx/lib') as Promise<EeThreecxModule>;
}

/** Event-driven push of one contact; re-checks the gate since the event may predate a disable. */
export async function syncThreecxPhonebookContactHandler(data: ThreecxPhonebookContactJobData): Promise<void> {
  if (!isEnterpriseEdition) {
    logger.info('[Threecx] Skipping phonebook contact sync outside Enterprise Edition', { tenantId: data.tenantId });
    return;
  }
  await runWithTenant(data.tenantId, async () => {
    const threecx = await loadThreecx();
    const loaded = await threecx.getThreecxProviderConfig(data.tenantId);
    if (!loaded || !threecx.isThreecxPhonebookActive(loaded.config)) {
      logger.info('[Threecx] Phonebook sync inactive; contact sync skipped', {
        tenantId: data.tenantId,
        contactId: data.contactId,
      });
      return;
    }
    const counts = await threecx.syncThreecxPhonebookContact(data.tenantId, data.contactId);
    logger.info('[Threecx] Phonebook contact synced', { tenantId: data.tenantId, contactId: data.contactId, ...counts });
  });
}

/** Hourly fanout entry; the lib decides whether this tenant is due. */
export async function reconcileThreecxPhonebookHandler(data: ThreecxPhonebookReconcileJobData): Promise<void> {
  if (!isEnterpriseEdition) {
    logger.info('[Threecx] Skipping phonebook reconcile outside Enterprise Edition', { tenantId: data.tenantId });
    return;
  }
  await runWithTenant(data.tenantId, async () => {
    const threecx = await loadThreecx();
    const result = await threecx.reconcileThreecxPhonebook(data.tenantId);
    logger.info('[Threecx] Phonebook reconcile finished', {
      tenantId: data.tenantId,
      ran: result.ran,
      push: result.push,
      import: result.import,
    });
  });
}
