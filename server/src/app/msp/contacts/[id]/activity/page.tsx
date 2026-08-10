import { cache } from 'react';
import { getContactByContactNameId, getInteractionsForEntity } from '@alga-psa/clients/actions';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import type { Metadata } from 'next';
import ContactActivityFeed from './ContactActivityFeed';

const getCachedContact = cache((id: string) => getContactByContactNameId(id));

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  try {
    const { id } = await params;
    const contact = await getCachedContact(id);
    if (contact) {
      return {
        title: t('msp.contacts.detail.activity.title', {
          contactName: contact.full_name,
          defaultValue: '{{contactName}} - Activity',
        }),
      };
    }
  } catch (error) {
    console.error('[generateMetadata] Failed to fetch contact title:', error);
  }
  return {
    title: t('msp.contacts.detail.activity.fallbackTitle', { defaultValue: 'Contact Activity' }),
  };
}

export default async function ContactActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  const contact = await getCachedContact(resolvedParams.id);
  const interactions = await getInteractionsForEntity(resolvedParams.id, 'contact');

  if (!contact) {
    const { t } = await getServerTranslation(undefined, 'common');
    return <div>{t('pages.errors.contactNotFound')}</div>;
  }

  return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">Activity Feed for {contact.full_name}</h1>
        <ContactActivityFeed
          entityId={contact.contact_name_id}
          initialInteractions={interactions}
        />
      </div>
  );
}
