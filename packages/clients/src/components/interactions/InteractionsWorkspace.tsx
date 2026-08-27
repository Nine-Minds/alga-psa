'use client';

import React, { useState } from 'react';
import type { IClient, IContact } from '@alga-psa/types';
import type { IUser } from '@shared/interfaces/user.interfaces';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@alga-psa/ui/components/Tabs';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import OverallInteractionsFeed from './OverallInteractionsFeed';

interface InteractionsWorkspaceProps {
  users: IUser[];
  contacts: IContact[];
  clients: IClient[];
  callsPanel?: React.ReactNode;
  onOpenUser?: (userId: string, onUpdate?: () => void) => void;
}

export default function InteractionsWorkspace({
  users,
  contacts,
  clients,
  callsPanel,
  onOpenUser,
}: InteractionsWorkspaceProps) {
  const { t: tCore } = useTranslation('msp/core');
  const { t: tIntegrations } = useTranslation('msp/integrations');
  const [activeTab, setActiveTab] = useState('interactions');

  return (
    <div className="space-y-6" id="interactions-workspace">
      <h1 className="text-2xl font-bold">
        {tCore('nav.interactions', { defaultValue: 'Interactions' })}
      </h1>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger id="interactions-workspace-feed-tab" value="interactions">
            {tCore('settings.tabs.interactions', { defaultValue: 'Interactions' })}
          </TabsTrigger>
          {callsPanel ? (
            <TabsTrigger id="interactions-workspace-calls-tab" value="calls">
              {tIntegrations('integrations.telephony.callsPanel.title', { defaultValue: 'Calls' })}
            </TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="interactions" className="mt-6">
          <OverallInteractionsFeed
            users={users}
            contacts={contacts}
            clients={clients}
            onOpenUser={onOpenUser}
          />
        </TabsContent>
        {callsPanel ? (
          <TabsContent value="calls" className="mt-6">
            {callsPanel}
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
