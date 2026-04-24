import { cache } from 'react';
import { InteractionsFeed } from '@alga-psa/clients';
import { getContactByContactNameId, getInteractionsForEntity } from '@alga-psa/clients/actions';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import type { Metadata } from 'next';

const getCachedContact = cache((id: string) => getContactByContactNameId(id));

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  try {
    const { id } = await params;
    const contact = await getCachedContact(id);
    if (contact) {
      return { title: `${contact.full_name} - Activity` };
    }
  } catch (error) {
    console.error('[generateMetadata] Failed to fetch contact title:', error);
  }
  return { title: 'Contact Activity' };
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
        <InteractionsFeed
          entityId={contact.contact_name_id}
          entityType="contact"
          interactions={interactions}
          setInteractions={() => {}}
        />
      </div>
  );
}
