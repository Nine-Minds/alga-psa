// server/src/app/msp/contacts/[id]/activity/page.tsx
import InteractionsFeed from 'server/src/components/interactions/InteractionsFeed';
import { getInteractionsForEntity } from '@product/actions/interactionActions';
import ContactModel from 'server/src/lib/models/contact';
import { getConnection } from 'server/src/lib/db/db';

export default async function ContactActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  const knex = await getConnection();
  const contact = await ContactModel.get(knex, resolvedParams.id);
  const interactions = await getInteractionsForEntity(resolvedParams.id, 'contact');

  if (!contact) {
    return <div>Contact not found</div>;
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

