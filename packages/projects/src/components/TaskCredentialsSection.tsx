'use client';

/**
 * Project task detail "Passwords" section wrapper (flag-gated).
 *
 * The per-entity credentials section embed for project tasks, mirroring the
 * asset/ticket/contact/document embeds. Flag off renders nothing (the task
 * surface keeps its exact legacy layout); flag on loads the EE/CE
 * EntityCredentialsSection via `@enterprise` scoped to this task.
 *
 * // LEVERAGE: pattern entity-attachments — the per-entity section embeds
 * (TaskCredentialsSection, TicketCredentialsSection, etc.) each mount the
 * same entity-scoped credentials panel. A shared entity-attachments engine is
 * a follow-up card (plan §scope expansion, decision 2).
 */

import React from 'react';
import dynamic from 'next/dynamic';
import { useFeatureFlag } from '@alga-psa/ui/hooks';

interface TaskCredentialsSectionProps {
  taskId: string;
  /** Owning client of the task's project (same-client link/create prefill). */
  clientId?: string | null;
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

export function TaskCredentialsSection({ taskId, clientId }: TaskCredentialsSectionProps) {
  const releaseFlag = useFeatureFlag('release-v1-5-feature', { defaultValue: false });
  const flagEnabled = typeof releaseFlag === 'boolean' ? releaseFlag : releaseFlag?.enabled ?? false;

  if (!flagEnabled) {
    return null;
  }

  return (
    <VaultEntityCredentialsSection
      entityType="project_task"
      entityId={taskId}
      defaultClientId={clientId ?? null}
    />
  );
}

export type { TaskCredentialsSectionProps };
export default TaskCredentialsSection;
