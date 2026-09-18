'use client';

/**
 * Contact detail "Passwords" section wrapper.
 *
 * The per-entity credentials section embed for contacts, mirroring the
 * asset/ticket/document/project-task embeds. Loads the EE/CE
 * EntityCredentialsSection via `@enterprise` scoped to this contact.
 *
 * // LEVERAGE: pattern entity-attachments — the per-entity section embeds
 * (ContactCredentialsSection, TicketCredentialsSection, etc.) each mount the
 * same entity-scoped credentials panel. A shared entity-attachments engine is
 * a follow-up card (plan §scope expansion, decision 2).
 */

import React from 'react';
import dynamic from 'next/dynamic';

interface ContactCredentialsSectionProps {
  contactId: string;
  /** Owning client of the contact (same-client link/create prefill). */
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

export function ContactCredentialsSection({ contactId, clientId }: ContactCredentialsSectionProps) {
  return (
    <VaultEntityCredentialsSection
      entityType="contact"
      entityId={contactId}
      defaultClientId={clientId}
    />
  );
}

export type { ContactCredentialsSectionProps };
export default ContactCredentialsSection;
