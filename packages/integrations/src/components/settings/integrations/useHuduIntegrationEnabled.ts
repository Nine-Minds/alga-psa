'use client';

import { isCalendarEnterpriseEdition } from '../../../lib/calendarAvailability';

/**
 * Client-side gating helper for Hudu UI surfaces.
 *
 * EE-edition detection only. Use this to decide whether to render the Hudu
 * settings item, the client "Hudu" tab, and the client "Passwords" tab.
 */
export function useHuduIntegrationEnabled(): {
  enabled: boolean;
  loading: boolean;
} {
  const isEEAvailable = isCalendarEnterpriseEdition();

  return {
    enabled: isEEAvailable,
    loading: false,
  };
}
