'use client';

import { useState, type ReactNode } from 'react';
import type { IClient, IOpportunityListItem, IWorkQueue } from '@alga-psa/types';
import { OpportunitiesHub } from '@alga-psa/opportunities/components';
import { QuickAddClient } from '@alga-psa/clients/components';

export function OpportunitiesHubHost({
  initialItems,
  initialTotal,
  initialQueue,
  initialClients,
  draftingAvailable,
  eeTabs,
  userPreferenceKey,
}: {
  initialItems: IOpportunityListItem[];
  initialTotal: number;
  initialQueue: IWorkQueue;
  initialClients: IClient[];
  draftingAvailable: boolean;
  eeTabs: Array<{ id: string; label: string; content: ReactNode }>;
  userPreferenceKey: string;
}) {
  const [clients, setClients] = useState(initialClients);

  return (
    <OpportunitiesHub
      initialItems={initialItems}
      initialTotal={initialTotal}
      initialQueue={initialQueue}
      clients={clients}
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
            setClients((current) => [client, ...current.filter((item) => item.client_id !== client.client_id)]);
            onCreated(client);
          }}
        />
      )}
    />
  );
}
