'use client';

/**
 * Ticket detail "Passwords" section wrapper (flag-gated).
 *
 * The per-entity credentials section embed for tickets, mirroring the
 * asset/contact/document/project-task embeds. Flag off renders nothing (the
 * ticket detail keeps its exact legacy layout); flag on loads the EE/CE
 * EntityCredentialsSection via `@enterprise` scoped to this ticket.
 *
 * // LEVERAGE: pattern entity-attachments — the per-entity section embeds
 * (TicketCredentialsSection, ContactCredentialsSection, etc.) each mount the
 * same entity-scoped credentials panel. A shared entity-attachments engine is
 * a follow-up card (plan §scope expansion, decision 2).
 */

import React from 'react';
import dynamic from 'next/dynamic';
import { useFeatureFlag } from '@alga-psa/ui/hooks';

interface TicketCredentialsSectionProps {
  ticketId: string;
  /** Owning client of the ticket (same-client link/create prefill). */
  clientId: string | null;
}

const VaultEntityCredentialsSection = dynamic(
  () =>
    import('@enterprise/components/credentials/EntityCredentialsSection').then(
      (mod) => mod.EntityCredentialsSection
    ),
  {
    ssr: false,
    loading: () => null,
  }
);

export function TicketCredentialsSection({ ticketId, clientId }: TicketCredentialsSectionProps) {
  const releaseFlag = useFeatureFlag('release-v1.5-feature', { defaultValue: false });
  const flagEnabled = typeof releaseFlag === 'boolean' ? releaseFlag : releaseFlag?.enabled ?? false;

  if (!flagEnabled) {
    return null;
  }

  return (
    <VaultEntityCredentialsSection entityType="ticket" entityId={ticketId} defaultClientId={clientId} />
  );
}

export type { TicketCredentialsSectionProps };
export default TicketCredentialsSection;
