'use client';

import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { isCalendarEnterpriseEdition } from '../../../lib/calendarAvailability';

/**
 * Client-side gating helper for Hudu UI surfaces.
 *
 * Mirrors the Entra UI gate (IntegrationsSettingsPage.tsx): combine EE-edition
 * detection with the `hudu-integration` feature flag. Use this to decide
 * whether to render the Hudu settings item, the client "Hudu" tab, and the
 * client "Passwords" tab.
 *
 * The flag defaults off; `loading` reflects the underlying PostHog probe.
 */
export function useHuduIntegrationEnabled(): {
  enabled: boolean;
  loading: boolean;
} {
  const isEEAvailable = isCalendarEnterpriseEdition();
  const flag = useFeatureFlag('hudu-integration', { defaultValue: false });

  return {
    enabled: isEEAvailable && !!flag.enabled,
    loading: flag.loading,
  };
}
