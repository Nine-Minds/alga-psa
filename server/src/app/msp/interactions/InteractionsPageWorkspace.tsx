'use client';

import React, { useCallback } from 'react';
import MspInteractionsWorkspace from '@alga-psa/msp-composition/clients/MspInteractionsWorkspace';
import type { MspInteractionsPageData } from '@alga-psa/msp-composition/clients/loadMspInteractionsPageData';
import { useDrawer } from '@alga-psa/ui';
import UserDetails from '@/components/settings/general/UserDetails';

type InteractionsPageWorkspaceProps = MspInteractionsPageData;

export default function InteractionsPageWorkspace({
  users,
  contacts,
  telephonyOverview,
}: InteractionsPageWorkspaceProps) {
  const { openDrawer } = useDrawer();

  const openUserDetails = useCallback((userId: string, onUpdate?: () => void) => {
    openDrawer(<UserDetails userId={userId} onUpdate={onUpdate ?? (() => undefined)} />);
  }, [openDrawer]);

  return (
    <MspInteractionsWorkspace
      users={users}
      contacts={contacts}
      telephonyOverview={telephonyOverview}
      onOpenUser={openUserDetails}
    />
  );
}
