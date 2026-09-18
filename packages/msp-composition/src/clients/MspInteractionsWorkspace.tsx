'use client';

import React from 'react';
import InteractionsWorkspace from '@alga-psa/clients/components/interactions/InteractionsWorkspace';
import TelephonyCallsPanel from '@alga-psa/integrations/components/telephony/TelephonyCallsPanel';
import type { TelephonyOverview } from '@alga-psa/integrations/actions/integrations/telephonyActions';
import type { IClient, IContact, IUser } from '@alga-psa/types';

interface MspInteractionsWorkspaceProps {
  users: IUser[];
  contacts: IContact[];
  clients: IClient[];
  telephonyOverview?: TelephonyOverview | null;
  onOpenUser?: (userId: string, onUpdate?: () => void) => void;
}

export default function MspInteractionsWorkspace({
  users,
  contacts,
  clients,
  telephonyOverview,
  onOpenUser,
}: MspInteractionsWorkspaceProps) {
  const callsAvailable = Boolean(
    telephonyOverview?.success && telephonyOverview.available,
  );

  return (
    <InteractionsWorkspace
      users={users}
      contacts={contacts}
      clients={clients}
      onOpenUser={onOpenUser}
      callsPanel={callsAvailable ? (
        <TelephonyCallsPanel
          initialOverview={telephonyOverview}
          showHeading={false}
        />
      ) : undefined}
    />
  );
}
