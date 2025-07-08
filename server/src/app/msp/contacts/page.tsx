// server/src/app/msp/contacts/page.tsx
import React from 'react';
import ContactModel from 'server/src/lib/models/contact';
import UserModel from 'server/src/lib/models/user';
import { User } from 'next-auth';
import { IContact, IUserWithRoles } from 'server/src/interfaces';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import { getAllCompanies } from 'server/src/lib/actions/company-actions/companyActions';
import Contacts from 'server/src/components/contacts/Contacts';
import OverallInteractionsFeed from 'server/src/components/interactions/OverallInteractionsFeed';
import { getConnection } from 'server/src/lib/db/db';

type IdName = { id: string; name: string };

export default async function ContactsPage() {
  const knex = await getConnection();
  const contacts = await ContactModel.getAll(knex, true);
  const usersData = await UserModel.getAll(knex, true);
  const companies: ICompany[] = await getAllCompanies(true);

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
    <div className="flex flex-col md:flex-row md:space-x-6">
      <div className="w-full md:w-2/3 mb-6 md:mb-0">
        <Contacts initialContacts={uniqueContacts} />
      </div>
      <div className="w-full md:w-1/3">
        <OverallInteractionsFeed 
          users={usersWithRoles}
          contacts={uniqueContacts}
          companies={companies}
        />
      </div>
    </div>
  );
}

export const dynamic = "force-dynamic";
