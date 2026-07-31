'use client';

import { useState } from 'react';
// Components subpath only: the @alga-psa/clients root barrel re-exports
// models, and importing it from a client component drags knex/pg into the
// browser bundle ("Can't resolve 'fs'").
import { InteractionsFeed } from '@alga-psa/clients/components';
import type { IInteraction } from '@alga-psa/types';

/**
 * Client boundary for the activity feed: InteractionsFeed is a controlled
 * component (interactions + setInteractions), and a server page cannot pass
 * a state setter across the RSC boundary.
 */
export default function ContactActivityFeed({
  entityId,
  initialInteractions,
}: {
  entityId: string;
  initialInteractions: IInteraction[];
}) {
  const [interactions, setInteractions] = useState<IInteraction[]>(initialInteractions);
  return (
    <InteractionsFeed
      entityId={entityId}
      entityType="contact"
      interactions={interactions}
      setInteractions={setInteractions}
    />
  );
}
