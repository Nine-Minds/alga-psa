'use server';

/**
 * Availability probe for the Tickets page: is smart ticket search usable for
 * this caller right now? The page hides the affordance when not. The decision
 * (permission, release flag, AI add-on, key) is shared with the SSE route
 * through evaluateSmartTicketSearchAccess, so the two never disagree.
 */

import { withAuth } from '@alga-psa/auth';

import { evaluateSmartTicketSearchAccess } from '../../services/smartTicketSearch/smartSearchAccess';

export interface SmartTicketSearchAvailability {
  available: boolean;
}

export const getSmartTicketSearchAvailability = withAuth(
  async (user): Promise<SmartTicketSearchAvailability> => {
    const access = await evaluateSmartTicketSearchAccess(user);
    return { available: access.allowed };
  }
);
