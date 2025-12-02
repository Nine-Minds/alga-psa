// server/src/app/msp/contacts/page.tsx
import React from 'react';
import ContactModel from 'server/src/lib/models/contact';
import UserModel from 'server/src/lib/models/user';
import { IContact } from 'server/src/interfaces';
import { IUser } from '@shared/interfaces/user.interfaces';
import { IClient } from 'server/src/interfaces/client.interfaces';
import { getAllClients } from 'server/src/lib/actions/client-actions/clientActions';
import ContactsLayout from 'server/src/components/contacts/ContactsLayout';
import { getConnection } from 'server/src/lib/db/db';

export default async function ContactsPage() {
  const knex = await getConnection();
  const contacts = await ContactModel.getAll(knex, true);
  const users: IUser[] = await UserModel.getAll(knex, true);
  const clients: IClient[] = await getAllClients(true);

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
