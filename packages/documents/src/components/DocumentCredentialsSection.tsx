'use client';

/**
 * Document drawer/viewer "Passwords" section wrapper.
 *
 * The per-entity credentials section embed for documents, mirroring the
 * asset/ticket/contact/project-task embeds. Loads the EE/CE
 * EntityCredentialsSection via `@enterprise` scoped to this document.
 *
 * Documents are clientless attachment targets: the same-client rule does not
 * apply, so no client filter is passed.
 *
 * // LEVERAGE: pattern entity-attachments — the per-entity section embeds
 * (DocumentCredentialsSection, TicketCredentialsSection, etc.) each mount the
 * same entity-scoped credentials panel. A shared entity-attachments engine is
 * a follow-up card (plan §scope expansion, decision 2).
 */

import React from 'react';
import dynamic from 'next/dynamic';

interface DocumentCredentialsSectionProps {
  documentId: string;
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

export function DocumentCredentialsSection({ documentId }: DocumentCredentialsSectionProps) {
  return <VaultEntityCredentialsSection entityType="document" entityId={documentId} />;
}

export type { DocumentCredentialsSectionProps };
export default DocumentCredentialsSection;
