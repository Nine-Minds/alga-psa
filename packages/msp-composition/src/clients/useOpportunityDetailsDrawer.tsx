'use client';

import React, { useCallback } from 'react';
import { useDrawer } from '@alga-psa/ui';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { OpportunityDetailHost } from '@alga-psa/opportunities/components';
import { getOpportunity } from '@alga-psa/opportunities/actions';
import InteractionDetails from '@alga-psa/clients/components/interactions/InteractionDetails';
import { getInteractionById } from '@alga-psa/clients/actions/interactionActions';

/**
 * Open an opportunity in the shared drawer, keeping the current page
 * underneath. Mirrors useTicketDetailsDrawer so a deal opened from a client's
 * Opportunities tab does not throw the user out to the module.
 */
export function useOpportunityDetailsDrawer(): (opportunityId: string) => Promise<void> {
  const { openDrawer, replaceDrawer } = useDrawer();
  const { t } = useTranslation('msp/opportunities');
  const openInteraction = useCallback(async (interactionId: string) => {
    try {
      const interaction = await getInteractionById(interactionId);
      if (!interaction || 'error' in (interaction as object)) return;
      openDrawer(<InteractionDetails interaction={interaction as any} />);
    } catch {
      // Deleted or unreadable interactions cannot be opened.
    }
  }, [openDrawer]);

  return useCallback(async (opportunityId: string) => {
    openDrawer(
      <div className="p-4 text-sm text-[rgb(var(--color-text-600))]">
        {t('opportunities.detail.loading', { defaultValue: 'Loading opportunity...' })}
      </div>
    );
    try {
      const detail = await getOpportunity(opportunityId);
      replaceDrawer(
        <div className="p-4">
          {/* isInDrawer makes the host own the detail state: mutations inside
              the drawer re-run getOpportunity themselves, so this initial
              fetch is a starting point rather than a frozen snapshot. */}
          <OpportunityDetailHost detail={detail} isInDrawer onOpenInteraction={openInteraction} />
        </div>
      );
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : t('opportunities.detail.loadFailed', { defaultValue: 'Failed to load opportunity' });
      replaceDrawer(<div className="p-4 text-sm text-[rgb(var(--color-destructive))]">{message}</div>);
    }
  }, [openDrawer, openInteraction, replaceDrawer, t]);
}
