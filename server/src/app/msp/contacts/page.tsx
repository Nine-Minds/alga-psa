export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.contacts.title', { defaultValue: 'Contacts' }),
  };
}

// server/src/app/msp/contacts/page.tsx
import React from 'react';
import type { IContact } from '@alga-psa/types';
import { getAllContacts } from '@alga-psa/clients/actions';
import { ContactsLayout } from '@alga-psa/clients';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export default async function ContactsPage() {
  const contacts = await getAllContacts('all');

  // Filter out any duplicate contacts based on contact_name_id
  const uniqueContacts = Array.from(
    new Map(contacts.map((contact):[string, IContact] => [contact.contact_name_id, contact])).values()
  );

  return <ContactsLayout uniqueContacts={uniqueContacts} />;
}

export const dynamic = "force-dynamic";
