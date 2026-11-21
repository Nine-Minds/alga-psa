'use client';

import type { ReactNode } from 'react';
import type { IOpportunityListItem, IWorkQueue } from '@alga-psa/types';
import { OpportunitiesHub } from '@alga-psa/opportunities/components';
import { QuickAddClient } from '@alga-psa/clients/components';

export function OpportunitiesHubHost({
  initialItems,
  initialTotal,
  initialQueue,
  draftingAvailable,
  eeTabs,
  userPreferenceKey,
}: {
  initialItems: IOpportunityListItem[];
  initialTotal: number;
  initialQueue: IWorkQueue;
  draftingAvailable: boolean;
  eeTabs: Array<{ id: string; label: string; content: ReactNode }>;
  userPreferenceKey: string;
}) {
  return (
    <OpportunitiesHub
      initialItems={initialItems}
      initialTotal={initialTotal}
      initialQueue={initialQueue}
      draftingAvailable={draftingAvailable}
      eeTabs={eeTabs}
      userPreferenceKey={userPreferenceKey}
      renderClientCreator={({ open, onOpenChange, onCreated }) => (
        <QuickAddClient
          open={open}
          onOpenChange={onOpenChange}
          initialLifecycleStatus="prospect"
          skipSuccessDialog
          onClientAdded={(client) => {
            onCreated(client);
          }}
        />
      )}
    />
  );
}
