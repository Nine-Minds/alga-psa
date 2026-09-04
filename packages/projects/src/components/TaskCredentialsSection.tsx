'use client';

/**
 * Project task detail "Passwords" section wrapper.
 *
 * The per-entity credentials section embed for project tasks, mirroring the
 * asset/ticket/contact/document embeds. Loads the EE/CE
 * EntityCredentialsSection via `@enterprise` scoped to this task.
 *
 * // LEVERAGE: pattern entity-attachments — the per-entity section embeds
 * (TaskCredentialsSection, TicketCredentialsSection, etc.) each mount the
 * same entity-scoped credentials panel. A shared entity-attachments engine is
 * a follow-up card (plan §scope expansion, decision 2).
 */

import React from 'react';
import dynamic from 'next/dynamic';

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
