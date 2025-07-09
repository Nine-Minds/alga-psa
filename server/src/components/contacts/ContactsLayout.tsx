'use client';

import React, { useState, useEffect } from 'react';
import { IContact, IUserWithRoles } from 'server/src/interfaces';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import Contacts from './Contacts';
import OverallInteractionsFeed from '../interactions/OverallInteractionsFeed';
import { getCurrentUser, getUserPreference, setUserPreference } from 'server/src/lib/actions/user-actions/userActions';

const INTERACTIONS_COLLAPSED_SETTING = 'contacts_interactions_collapsed';

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
  const [isInteractionsCollapsed, setIsInteractionsCollapsed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadUserPreference = async () => {
      try {
        const user = await getCurrentUser();
        if (user) {
          const collapsed = await getUserPreference(user.user_id, INTERACTIONS_COLLAPSED_SETTING);
          if (collapsed !== null) {
            setIsInteractionsCollapsed(collapsed);
          }
        }
      } catch (error) {
        console.error('Failed to load user preference:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadUserPreference();
  }, []);

  const handleToggleCollapse = async () => {
    const newCollapsedState = !isInteractionsCollapsed;
    setIsInteractionsCollapsed(newCollapsedState);
    
    try {
      const user = await getCurrentUser();
      if (user) {
        await setUserPreference(user.user_id, INTERACTIONS_COLLAPSED_SETTING, newCollapsedState);
      }
    } catch (error) {
      console.error('Failed to save user preference:', error);
    }
  };

  if (isLoading) {
    // Render with default state to prevent layout shift
    return (
      <div className="flex flex-col md:flex-row md:space-x-6">
        <div className="w-full md:w-2/3 mb-6 md:mb-0">
          <Contacts initialContacts={uniqueContacts} />
        </div>
        <div className="w-full md:w-1/3">
          <OverallInteractionsFeed 
            users={usersWithRoles}
            contacts={uniqueContacts}
            companies={companies}
            isCollapsed={false}
            onToggleCollapse={handleToggleCollapse}
          />
        </div>
      </div>
    );
  }

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