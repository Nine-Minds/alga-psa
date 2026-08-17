import { getNinjaOneSyncStrategy } from './syncStrategy';

/**
 * Adapts NinjaOne's existing incremental device sync to the shape the
 * rmm-device-sync job expects.
 *
 * Deliberately a thin adapter rather than a second implementation. The
 * incremental sync has existed and been reachable from a server action since
 * before this job did — production shows it has simply never run, because
 * nothing scheduled it. Reimplementing it here would give the manual and
 * scheduled paths two behaviours to drift apart; this way there is one.
 */
export const ninjaOneDeviceSyncStrategy = {
  async syncDevicesIncremental(input: {
    tenantId: string;
    integrationId: string;
    since: Date;
  }): Promise<{ devicesProcessed: number }> {
    const strategy = getNinjaOneSyncStrategy();
    const result = await strategy.syncDevicesIncremental({
      tenantId: input.tenantId,
      integrationId: input.integrationId,
      since: input.since,
      // No performedBy: a scheduled run has no acting user. The manual path
      // passes the user id, which is the only intended difference.
      options: {},
    });

    // RmmSyncResult reports failure in a field rather than by throwing. The
    // job treats a resolved promise as success and advances the delta cursor,
    // so returning normally here would skip whatever changed in the failed
    // window and never revisit it. Translate it into the failure the caller
    // expects.
    if (!result.success) {
      const detail = result.errors?.length ? `: ${result.errors.join('; ')}` : '';
      throw new Error(
        `NinjaOne incremental device sync reported failure (${result.items_failed} failed)${detail}`,
      );
    }

    return { devicesProcessed: result.items_processed };
  },
};
