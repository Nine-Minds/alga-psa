'use client';

/**
 * Ticket detail "Passwords" section wrapper.
 *
 * The per-entity credentials section embed for tickets, mirroring the
 * asset/contact/document/project-task embeds. Loads the EE/CE
 * EntityCredentialsSection via `@enterprise` scoped to this ticket.
 *
 * // LEVERAGE: pattern entity-attachments — the per-entity section embeds
 * (TicketCredentialsSection, ContactCredentialsSection, etc.) each mount the
 * same entity-scoped credentials panel. A shared entity-attachments engine is
 * a follow-up card (plan §scope expansion, decision 2).
 */

import React from 'react';
import dynamic from 'next/dynamic';

interface TicketCredentialsSectionProps {
  ticketId: string;
  /** Owning client of the ticket (same-client link/create prefill). */
  clientId: string | null;
  /** The ticket screen is read-only (for example an ended workspace): list without attach/manage. */
  readOnly?: boolean;
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

export function TicketCredentialsSection({ ticketId, clientId, readOnly = false }: TicketCredentialsSectionProps) {
  return (
    <VaultEntityCredentialsSection entityType="ticket" entityId={ticketId} defaultClientId={clientId} readOnly={readOnly} />
  );
}

export type { TicketCredentialsSectionProps };
export default TicketCredentialsSection;
