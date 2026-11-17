// Pure (no server imports) so client components can read the same definition.
import type { MicrosoftProfileConsumer } from '../actions/integrations/microsoftShared';
import { getVisibleMicrosoftConsumerTypes } from './microsoftConsumerVisibility';

/**
 * The single definition of what the AlgaPSA-supplied Microsoft app serves on
 * this build: `email` always, `calendar` only where the calendar package is
 * present (the same EE edition gate that makes the Calendar consumer visible).
 * Setup, consent-time binding, reconciliation and status surfaces all read this.
 */
export function getMicrosoftPlatformAppServedConsumers(
  visibleConsumers: readonly MicrosoftProfileConsumer[] = getVisibleMicrosoftConsumerTypes()
): MicrosoftProfileConsumer[] {
  return visibleConsumers.includes('calendar') ? ['email', 'calendar'] : ['email'];
}
