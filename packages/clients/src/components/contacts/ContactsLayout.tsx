'use client';

import React from 'react';
import { IContact } from '@alga-psa/types';
import { IUser } from '@shared/interfaces/user.interfaces';
import type { IClient } from '@alga-psa/types';
import Contacts from './Contacts';
import OverallInteractionsFeed from '../interactions/OverallInteractionsFeed';
import { useCollapsiblePreference } from '@alga-psa/ui/hooks';

interface ContactsLayoutProps {
  uniqueContacts: IContact[];
  users: IUser[];
  clients: IClient[];
  /**
   * Operational calls surface (telephony) composed in by the app layer so this
   * package never depends on @alga-psa/integrations. Renders full-width below
   * the contacts/interactions columns; hides itself when telephony is absent.
   */
  callsPanel?: React.ReactNode;
}

export default function ContactsLayout({
  uniqueContacts,
  users,
  clients,
  callsPanel
}: ContactsLayoutProps) {
  const {
    isCollapsed: isInteractionsCollapsed,
    setIsCollapsed: setIsInteractionsCollapsed,
    isInitialLoad,
    isHidden
  } = useCollapsiblePreference('contacts_interactions_collapsed', false);

  const handleToggleCollapse = () => {
    setIsInteractionsCollapsed(prev => !prev);
  };

  return (
    <div style={{ opacity: isHidden ? 0 : 1, pointerEvents: isHidden ? 'none' : 'auto' }}>
      <div className="flex flex-col md:flex-row md:space-x-6">
        <div className={`${
          isInitialLoad ? '' : 'transition-all duration-300'
        } ${
          isInteractionsCollapsed
            ? 'w-full md:w-[calc(100%-60px)]'
            : 'w-full md:w-2/3'
        } mb-6 md:mb-0`}>
          <Contacts initialContacts={uniqueContacts} />
        </div>
        <div className={`${
          isInitialLoad ? '' : 'transition-all duration-300'
        } ${
          isInteractionsCollapsed
            ? 'w-full md:w-[60px]'
            : 'w-full md:w-1/3'
        }`}>
          <OverallInteractionsFeed
            users={users}
            contacts={uniqueContacts}
            clients={clients}
            isCollapsed={isInteractionsCollapsed}
            onToggleCollapse={handleToggleCollapse}
          />
        </div>
      </div>
      {callsPanel ? <div className="mt-6">{callsPanel}</div> : null}
    </div>
  );
}
