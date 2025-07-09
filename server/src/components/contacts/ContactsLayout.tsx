'use client';

import React from 'react';
import { IContact, IUserWithRoles } from 'server/src/interfaces';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import Contacts from './Contacts';
import OverallInteractionsFeed from '../interactions/OverallInteractionsFeed';
import { useUserPreference } from 'server/src/hooks/useUserPreference';

interface ContactsLayoutProps {
  uniqueContacts: IContact[];
  usersWithRoles: IUserWithRoles[];
  companies: ICompany[];
}

export default function ContactsLayout({ 
  uniqueContacts, 
  usersWithRoles, 
  companies 
}: ContactsLayoutProps) {
  const { 
    value: isInteractionsCollapsed, 
    setValue: setIsInteractionsCollapsed,
    isLoading 
  } = useUserPreference<boolean>(
    'contacts_interactions_collapsed',
    {
      defaultValue: false,
      localStorageKey: 'contacts_interactions_collapsed',
      debounceMs: 300
    }
  );

  const handleToggleCollapse = () => {
    setIsInteractionsCollapsed(prev => !prev);
  };

  return (
    <div className="flex flex-col md:flex-row md:space-x-6">
      <div className={`transition-all duration-300 ${
        isInteractionsCollapsed 
          ? 'w-full md:w-[calc(100%-60px)]' 
          : 'w-full md:w-2/3'
      } mb-6 md:mb-0`}>
        <Contacts initialContacts={uniqueContacts} />
      </div>
      <div className={`transition-all duration-300 ${
        isInteractionsCollapsed 
          ? 'w-full md:w-[60px]' 
          : 'w-full md:w-1/3'
      }`}>
        <OverallInteractionsFeed 
          users={usersWithRoles}
          contacts={uniqueContacts}
          companies={companies}
          isCollapsed={isInteractionsCollapsed}
          onToggleCollapse={handleToggleCollapse}
        />
      </div>
    </div>
  );
}