'use client';

/**
 * Document drawer/viewer "Passwords" section wrapper (flag-gated).
 *
 * The per-entity credentials section embed for documents, mirroring the
 * asset/ticket/contact/project-task embeds. Flag off renders nothing (the
 * document surface keeps its exact legacy layout); flag on loads the EE/CE
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
import { useFeatureFlag } from '@alga-psa/ui/hooks';

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
  const releaseFlag = useFeatureFlag('release-v1-5-feature', { defaultValue: false });
  const flagEnabled = typeof releaseFlag === 'boolean' ? releaseFlag : releaseFlag?.enabled ?? false;

  if (!flagEnabled) {
    return null;
  }

  return <VaultEntityCredentialsSection entityType="document" entityId={documentId} />;
}

export type { DocumentCredentialsSectionProps };
export default DocumentCredentialsSection;
