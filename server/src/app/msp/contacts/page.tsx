// server/src/app/msp/contacts/page.tsx
import React from 'react';
import type { IClient } from '@alga-psa/types';
import type { IContact } from '@alga-psa/types';
import type { IUser } from '@shared/interfaces/user.interfaces';
import { getAllClients, getAllContacts } from '@alga-psa/clients/actions';
import { getAllUsersBasic } from '@alga-psa/users/actions';
import { ContactsLayout } from '@alga-psa/clients';

export default async function ContactsPage() {
  const [contacts, users, clients] = await Promise.all([
    getAllContacts('all'),
    getAllUsersBasic(true),
    getAllClients(true),
  ]);

  // Filter out any duplicate contacts based on contact_name_id
  const uniqueContacts = Array.from(
    new Map(contacts.map((contact):[string, IContact] => [contact.contact_name_id, contact])).values()
  );

  return (
    <ContactsLayout
      uniqueContacts={uniqueContacts}
      users={users}
      clients={clients}
    />
  );
}

export const dynamic = "force-dynamic";
