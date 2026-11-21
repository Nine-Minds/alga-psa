'use client';

import type { IProject } from '@alga-psa/types';
import ClientNameCell from '@alga-psa/ui/components/ClientNameCell';
import { projectClientPresentation } from '../lib/projectClientPresentation';
import type { ProjectPickerClient } from '../actions/projectActions';

export function ProjectClientCell({
  project,
  clients,
  onOpenClient,
}: {
  project: IProject;
  clients: ProjectPickerClient[];
  onOpenClient?: (clientId: string, projectId: string) => void;
}) {
  const presentation = projectClientPresentation(project, clients);
  const clientName = presentation.clientName;
  if (!clientName) return <ClientNameCell clientName={null} />;

  const visibleClient = presentation.visibleClientId
    ? clients.find((client) => client.client_id === presentation.visibleClientId)
    : undefined;
  if (!visibleClient || !onOpenClient) return <ClientNameCell clientName={clientName} />;

  return (
    <ClientNameCell clientId={visibleClient.client_id} clientName={clientName} logoUrl={presentation.logoUrl}>
      <button
        id={`project-client-summary-${project.project_id}`}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onOpenClient(visibleClient.client_id, project.project_id);
        }}
        className="text-left whitespace-normal break-words text-[rgb(var(--color-primary-600))] hover:underline"
      >
        {clientName}
      </button>
    </ClientNameCell>
  );
}
