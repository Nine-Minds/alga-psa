import logger from '@alga-psa/core/logger';
import { runWithTenant } from '@alga-psa/db';

export const THREECX_CDR_BACKFILL_JOB = 'backfill-threecx-cdr';

export interface ThreecxCdrBackfillJobData extends Record<string, unknown> {
  tenantId: string;
}

type EeThreecxModule = {
  backfillThreecxCdr: (
    tenantId: string,
  ) => Promise<{ scanned: number; added: number; skipped: number; watermark: string | null }>;
};

const isEnterpriseEdition =
  (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
  (process.env.EDITION ?? '').toLowerCase() === 'enterprise' ||
  (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise';

/**
 * Hourly per-tenant pass over the 3CX call log. The EE module decides whether
 * the tenant qualifies (import enabled, PBX connected, XAPI available) and
 * enqueues survivors as canonical-call jobs; this handler only supplies the
 * tenant context and records the outcome.
 */
export async function backfillThreecxCdrHandler(data: ThreecxCdrBackfillJobData): Promise<void> {
  if (!isEnterpriseEdition) {
    logger.info('[Telephony] Skipping 3CX call-history backfill outside Enterprise Edition', {
      tenantId: data.tenantId,
    });
    return;
  }

  await runWithTenant(data.tenantId, async () => {
    const threecx = (await import('@alga-psa/ee-threecx/lib')) as EeThreecxModule;
    const result = await threecx.backfillThreecxCdr(data.tenantId);
    logger.info('[Telephony] 3CX call-history backfill finished', { tenantId: data.tenantId, ...result });
  });
}
