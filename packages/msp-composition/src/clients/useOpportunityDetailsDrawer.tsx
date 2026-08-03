'use client';

import React, { useCallback } from 'react';
import { useDrawer } from '@alga-psa/ui';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { OpportunityDetailHost } from '@alga-psa/opportunities/components';
import { getOpportunity } from '@alga-psa/opportunities/actions';

/**
 * Open an opportunity in the shared drawer, keeping the current page
 * underneath. Mirrors useTicketDetailsDrawer so a deal opened from a client's
 * Opportunities tab does not throw the user out to the module.
 */
export function useOpportunityDetailsDrawer(): (opportunityId: string) => Promise<void> {
  const { openDrawer, replaceDrawer } = useDrawer();
  const { t } = useTranslation('msp/opportunities');

  return useCallback(async (opportunityId: string) => {
    openDrawer(
      <div className="p-4 text-sm text-gray-600">
        {t('opportunities.detail.loading', { defaultValue: 'Loading opportunity...' })}
      </div>
    );
    try {
      const detail = await getOpportunity(opportunityId);
      replaceDrawer(
        <div className="p-4">
          <OpportunityDetailHost detail={detail} isInDrawer />
        </div>
      );
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : t('opportunities.detail.loadFailed', { defaultValue: 'Failed to load opportunity' });
      replaceDrawer(<div className="p-4 text-sm text-red-600">{message}</div>);
    }
  }, [openDrawer, replaceDrawer, t]);
}
