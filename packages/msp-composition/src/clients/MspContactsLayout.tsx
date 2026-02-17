'use client';

import React from 'react';
import type { IContact } from '@alga-psa/types';
import type { IUser } from '@shared/interfaces/user.interfaces';
import type { IClient } from '@alga-psa/types';
import ContactsLayout from '@alga-psa/clients/components/contacts/ContactsLayout';
import ContactDetails from './ContactDetails';
import ClientDetails from './ClientDetails';

interface MspContactsLayoutProps {
  uniqueContacts: IContact[];
  users: IUser[];
  clients: IClient[];
}

export default function MspContactsLayout({ uniqueContacts, users, clients }: MspContactsLayoutProps) {
  return (
    <ContactsLayout
      uniqueContacts={uniqueContacts}
      users={users}
      clients={clients}
      ContactDetailsComponent={ContactDetails}
      ClientDetailsComponent={ClientDetails}
    />
  );
}
