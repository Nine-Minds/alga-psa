// server/src/app/msp/contacts/page.tsx
import React from 'react';
import ContactModel from 'server/src/lib/models/contact';
import UserModel from 'server/src/lib/models/user';
import { IContact, IUserWithRoles } from 'server/src/interfaces';
import { IClient } from 'server/src/interfaces/client.interfaces';
import { getAllClients } from '@product/actions/client-actions/clientActions';
import ContactsLayout from 'server/src/components/contacts/ContactsLayout';
import { getConnection } from 'server/src/lib/db/db';

export default async function ContactsPage() {
  const knex = await getConnection();
  const contacts = await ContactModel.getAll(knex, true);
  const usersData = await UserModel.getAll(knex, true);
  const clients: IClient[] = await getAllClients(true);

  // Fetch roles for each user and combine data
  const usersWithRoles: IUserWithRoles[] = await Promise.all(
    usersData.map(async (user) => {
      const roles = await UserModel.getUserRoles(knex, user.user_id);
      return { ...user, roles };
    })
  );

  // Filter out any duplicate contacts based on contact_name_id
  const uniqueContacts = Array.from(
    new Map(contacts.map((contact):[string, IContact] => [contact.contact_name_id, contact])).values()
  );


  return (
    <ContactsLayout
      uniqueContacts={uniqueContacts}
      usersWithRoles={usersWithRoles}
      clients={clients}
    />
  );
}

export const dynamic = "force-dynamic";
