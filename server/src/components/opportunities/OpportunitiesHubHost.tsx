'use client';

import { useState, type ReactNode } from 'react';
import type { IClient, IOpportunityListItem, IWorkQueue } from '@alga-psa/types';
import { OpportunitiesHub } from '@alga-psa/opportunities/components';
import { QuickAddClient } from '@alga-psa/clients/components';
import { Button } from '@alga-psa/ui/components/Button';

export function OpportunitiesHubHost({
  initialItems,
  initialTotal,
  initialQueue,
  initialClients,
  draftingAvailable,
  eeTabs,
}: {
  initialItems: IOpportunityListItem[];
  initialTotal: number;
  initialQueue: IWorkQueue;
  initialClients: IClient[];
  draftingAvailable: boolean;
  eeTabs: Array<{ id: string; label: string; content: ReactNode }>;
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
      renderProspectCreator={(onCreated) => (
        <ProspectCreator
          onCreated={(client) => {
            setClients((current) => [client, ...current.filter((item) => item.client_id !== client.client_id)]);
            onCreated(client);
          }}
        />
      )}
    />
  );
}

function ProspectCreator({ onCreated }: { onCreated: (client: IClient) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button id="opportunity-add-prospect" type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Add prospect
      </Button>
      <QuickAddClient
        open={open}
        onOpenChange={setOpen}
        onClientAdded={onCreated}
        initialLifecycleStatus="prospect"
        skipSuccessDialog
      />
    </>
  );
}
