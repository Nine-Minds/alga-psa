/**
 * Microsoft calendar delta sync: the one provider-level operation that pulls
 * the changes Graph has recorded since the stored `deltaLink` and applies them
 * to the schedule.
 *
 * Shared by the webhook processor (a notification arrived) and the maintenance
 * service (a subscription was recreated, so changes made while it was dead have
 * to be caught up). Applying a change is idempotent: CalendarSyncService maps an
 * external event id to one schedule entry, so a notification and a maintenance
 * run that both see the same change converge on the same entry.
 */

import { runWithTenant } from '@alga-psa/db';
import type { CalendarProviderConfig } from '@alga-psa/types';
import { CalendarProviderService } from './CalendarProviderService';
import { CalendarSyncService } from './CalendarSyncService';
import { MicrosoftCalendarAdapter } from './providers/MicrosoftCalendarAdapter';
import type { CalendarEventChange } from './providers/base/BaseCalendarAdapter';

export interface MicrosoftDeltaSyncResult {
  /** Changes applied successfully. */
  success: number;
  /** Changes that could not be applied after retries. */
  failed: number;
}

export interface MicrosoftDeltaSyncOptions {
  /**
   * Changes already known from elsewhere (webhook notifications). Merged with
   * the delta result and de-duplicated by `id:changeType`.
   */
  additionalChanges?: CalendarEventChange[];
}

export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  label: string,
  attempts: number = 3
): Promise<T> {
  let lastError: any;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      console.warn(`[CalendarWebhookProcessor] ${label} failed`, {
        attempt,
        attempts,
        error: error instanceof Error ? error.message : error
      });
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 250));
      }
    }
  }
  throw lastError;
}

export type MicrosoftAdapterFactory = (provider: CalendarProviderConfig) => Promise<MicrosoftCalendarAdapter> | MicrosoftCalendarAdapter;

export class MicrosoftDeltaSyncService {
  constructor(
    private readonly syncService: CalendarSyncService = new CalendarSyncService(),
    private readonly providerService: CalendarProviderService = new CalendarProviderService(),
    private readonly createAdapter: MicrosoftAdapterFactory = (provider) => new MicrosoftCalendarAdapter(provider)
  ) {}

  /**
   * Fetch from the stored deltaLink (resetting and refetching when Graph
   * rejects it), persist the new deltaLink, then apply every change.
   *
   * Throws when Graph cannot be reached or the token is unusable; per-change
   * failures are counted, not thrown.
   */
  async syncProviderDelta(
    provider: CalendarProviderConfig,
    options: MicrosoftDeltaSyncOptions = {}
  ): Promise<MicrosoftDeltaSyncResult> {
    return runWithTenant(provider.tenant, async () => {
      const adapter = await this.createAdapter(provider);
      await adapter.connect();

      const deltaLink = provider.provider_config?.deltaLink || undefined;
      let deltaResult = await adapter.fetchDeltaChanges(deltaLink);

      if (deltaResult.resetRequired) {
        console.warn('[CalendarWebhookProcessor] Microsoft delta link invalid, resetting', {
          providerId: provider.id
        });

        await this.providerService.updateProvider(provider.id, provider.tenant, {
          vendorConfig: { deltaLink: null }
        });
        deltaResult = await adapter.fetchDeltaChanges(undefined);
      }

      if (deltaResult.deltaLink && deltaResult.deltaLink !== deltaLink) {
        await this.providerService.updateProvider(provider.id, provider.tenant, {
          vendorConfig: { deltaLink: deltaResult.deltaLink }
        });
      }

      const queuedChanges: CalendarEventChange[] = [];
      const seen = new Set<string>();
      for (const change of [...deltaResult.changes, ...(options.additionalChanges ?? [])]) {
        const key = `${change.id}:${change.changeType}`;
        if (!seen.has(key)) {
          queuedChanges.push(change);
          seen.add(key);
        }
      }

      let success = 0;
      let failed = 0;

      for (const change of queuedChanges) {
        if (change.changeType === 'deleted') {
          try {
            // @removed on an occurrence id must become an exception on the
            // series master, not a delete of the whole series. Graph sends
            // nothing but the opaque id, so the resolver falls back to the
            // occurrence index recorded when that occurrence was synced.
            await executeWithRetry(async () => {
              const result = await this.syncService.handleInboundExternalDelete(change.id, provider.id, {
                recurringEventId: change.recurringEventId,
                originalStart: change.originalStart,
                adapter
              });
              if (!result.success) {
                throw new Error(result.error || 'Failed to delete schedule entry');
              }
              return result;
            }, `microsoft-delete-${change.id}`);

            success++;
          } catch (error: any) {
            failed++;
            console.error(`❌ Failed to process Microsoft deletion for event ${change.id}:`, error?.message || error);
          }
        } else {
          try {
            await executeWithRetry(async () => {
              const result = await this.syncService.syncExternalEventToSchedule(change.id, provider.id);
              if (!result.success) {
                throw new Error(result.error || 'Failed to sync schedule entry');
              }
              return result;
            }, `microsoft-sync-${change.id}`);

            success++;
          } catch (error: any) {
            failed++;
            console.error(`❌ Failed to sync Microsoft event ${change.id}:`, error?.message || error);
          }
        }
      }

      return { success, failed };
    });
  }
}
