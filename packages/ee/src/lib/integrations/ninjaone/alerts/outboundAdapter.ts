/**
 * Community Edition stub. The NinjaOne outbound alert adapter is only
 * available in the Enterprise Edition; without it the ticket-close subscriber
 * skips the outbound reset.
 */

import type { RmmAlertOutboundAdapter } from '@alga-psa/shared/rmm/alerts';

export const ninjaOneAlertOutboundAdapter: RmmAlertOutboundAdapter | undefined = undefined;
