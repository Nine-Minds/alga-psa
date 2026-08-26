import React from 'react';
import type { IContact } from '@alga-psa/types';
import { getAllClients, getAllContacts } from '@alga-psa/clients/actions';
import { InteractionsWorkspace } from '@alga-psa/clients';
import { getTelephonyOverview } from '@alga-psa/integrations/actions/integrations/telephonyActions';
import TelephonyCallsPanel from '@alga-psa/integrations/components/telephony/TelephonyCallsPanel';
import { getAllUsersBasic } from '@alga-psa/user-composition/actions';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'msp/core');

  return {
    title: t('nav.interactions', { defaultValue: 'Interactions' }),
  };
}

export default async function InteractionsPage() {
  const [contacts, users, clients, telephonyOverview] = await Promise.all([
    getAllContacts('all'),
    getAllUsersBasic(true),
    getAllClients(true),
    getTelephonyOverview().catch(() => null),
  ]);

  const uniqueContacts = Array.from(
    new Map(contacts.map((contact): [string, IContact] => [contact.contact_name_id, contact])).values(),
  );
  const callsAvailable = Boolean(
    telephonyOverview?.success && telephonyOverview.available,
  );

  return (
    <InteractionsWorkspace
      users={users}
      contacts={uniqueContacts}
      clients={clients}
      callsPanel={callsAvailable ? (
        <TelephonyCallsPanel
          variant="operational"
          initialOverview={telephonyOverview}
          showHeading={false}
        />
      ) : undefined}
    />
  );
}

export const dynamic = 'force-dynamic';
