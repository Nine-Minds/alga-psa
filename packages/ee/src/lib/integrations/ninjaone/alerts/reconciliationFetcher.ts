/**
 * Community Edition stub. The NinjaOne alert fetcher is Enterprise-only;
 * without it the rmm-alert-reconciliation job handler skips NinjaOne
 * integrations (which cannot be configured in CE anyway).
 */

import type { RmmActiveAlertFetcher } from '@alga-psa/shared/rmm/alerts';

export const ninjaOneAlertFetcher: RmmActiveAlertFetcher | undefined = undefined;
