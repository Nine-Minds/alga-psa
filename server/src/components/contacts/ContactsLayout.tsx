'use client';

import React from 'react';
import { IContact } from 'server/src/interfaces';
import { IUser } from '@shared/interfaces/user.interfaces';
import { IClient } from 'server/src/interfaces/client.interfaces';
import Contacts from './Contacts';
import OverallInteractionsFeed from '../interactions/OverallInteractionsFeed';
import { useCollapsiblePreference } from 'server/src/hooks/useCollapsiblePreference';

interface ContactsLayoutProps {
  uniqueContacts: IContact[];
  users: IUser[];
  clients: IClient[];
}

export default function ContactsLayout({
  uniqueContacts,
  users,
  clients
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
    <div
      className="flex flex-col md:flex-row md:space-x-6"
      style={{ opacity: isHidden ? 0 : 1, pointerEvents: isHidden ? 'none' : 'auto' }}
    >
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
  );
}