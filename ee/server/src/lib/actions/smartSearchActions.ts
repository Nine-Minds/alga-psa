'use server';

/**
 * Availability probe for list pages: is smart search on this entity usable for
 * this caller right now? The page hides the affordance when not. The decision
 * (permission, release flag, AI add-on, key) is shared with the SSE route
 * through evaluateSmartSearchAccess, so the two never disagree.
 */

import { withAuth } from '@alga-psa/auth';
import { isSmartSearchEntity, type SmartSearchEntity } from '@alga-psa/ui/lib/smartSearch/types';

import { evaluateSmartSearchAccess } from '../../services/smartSearch/access';
import { getSmartSearchEntity } from '../../services/smartSearch/entities';

export interface SmartSearchAvailability {
  available: boolean;
}

export const getSmartSearchAvailability = withAuth(
  async (user, _context, entity: SmartSearchEntity): Promise<SmartSearchAvailability> => {
    if (!isSmartSearchEntity(entity)) {
      return { available: false };
    }
    const access = await evaluateSmartSearchAccess(user, getSmartSearchEntity(entity));
    return { available: access.allowed };
  }
);
