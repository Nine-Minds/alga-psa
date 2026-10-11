'use client';

import { useState } from 'react';
// Components subpath only: the @alga-psa/clients root barrel re-exports
// models, and importing it from a client component drags knex/pg into the
// browser bundle ("Can't resolve 'fs'").
import { InteractionsFeed } from '@alga-psa/clients/components';
import type { IInteraction } from '@alga-psa/types';

/**
 * Client boundary for the deal's activity feed. InteractionsFeed is a
 * controlled component (interactions + setInteractions) and lives in
 * @alga-psa/clients, which packages/opportunities must not depend on — so the
 * server-app layer builds the section here and injects it as a ReactNode.
 */
export function OpportunityInteractionsSection({
  opportunityId,
  clientId,
  contactId,
  initialInteractions = [],
}: {
  opportunityId: string;
  clientId: string;
  contactId?: string;
  initialInteractions?: IInteraction[];
}) {
  const [interactions, setInteractions] = useState<IInteraction[]>(initialInteractions);
  return (
    <InteractionsFeed
      id="opportunity-interactions-feed"
      entityId={opportunityId}
      entityType="opportunity"
      clientId={clientId}
      contactId={contactId}
      interactions={interactions}
      setInteractions={setInteractions}
    />
  );
}
