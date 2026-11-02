'use client';

import type { IClient, IProject } from '@alga-psa/types';
import ClientNameCell from '@alga-psa/ui/components/ClientNameCell';
import { projectClientPresentation } from '../lib/projectClientPresentation';

export function ProjectClientCell({ project, clients, onQuickView }: {
  project: IProject;
  clients: IClient[];
  onQuickView: (clientId: string) => void;
}) {
  const client = projectClientPresentation(project, clients);
  if (!client) return <ClientNameCell clientName={null} />;
  return (
    <ClientNameCell clientId={client.client_id} clientName={client.client_name} logoUrl={client.logoUrl ?? null}>
      <button
        onClick={(event) => {
          event.stopPropagation();
          onQuickView(client.client_id);
        }}
        className="text-blue-500 hover:underline text-left whitespace-normal break-words"
      >
        {client.client_name}
      </button>
    </ClientNameCell>
  );
}
