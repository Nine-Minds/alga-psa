export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.contacts.title', { defaultValue: 'Contacts' }),
  };
}

// server/src/app/msp/contacts/page.tsx
import React from 'react';
import type { IClient } from '@alga-psa/types';
import type { IContact } from '@alga-psa/types';
import type { IUser } from '@shared/interfaces/user.interfaces';
import { getAllClients, getAllContacts } from '@alga-psa/clients/actions';
import { getAllUsersBasic } from '@alga-psa/user-composition/actions';
import { ContactsLayout } from '@alga-psa/clients';
import TelephonyCallsPanel from '@alga-psa/integrations/components/telephony/TelephonyCallsPanel';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

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
      // Operational telephony surface for techs/dispatchers. The panel gates
      // itself on getTelephonyOverview (telephony availability + interaction
      // permissions — never system_settings) and renders nothing otherwise.
      callsPanel={<TelephonyCallsPanel variant="operational" />}
    />
  );
}

export const dynamic = "force-dynamic";
