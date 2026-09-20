'use server';

/**
 * Availability probe for the Tickets page: is smart ticket search usable for
 * this caller right now? True only when a TypeSafe key is configured and the
 * caller can read tickets. The page hides the affordance otherwise, and the
 * SSE route re-checks both before spending a token.
 */

import { hasPermission, withAuth } from '@alga-psa/auth';

import { isSmartTicketSearchConfigured } from '../../services/smartTicketSearch/typesafeClient';

export interface SmartTicketSearchAvailability {
  available: boolean;
}

export const getSmartTicketSearchAvailability = withAuth(
  async (user): Promise<SmartTicketSearchAvailability> => {
    const configured = await isSmartTicketSearchConfigured();
    if (!configured) {
      return { available: false };
    }
    const canRead = await hasPermission(user, 'ticket', 'read');
    return { available: canRead };
  }
);
