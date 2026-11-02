import type { IProject } from '@alga-psa/types';

/** A client label is always sourced from the authorized project projection. Client records add picker actions only. */
export function projectClientPresentation(project: Pick<IProject, 'client_id'> & { client_name?: string | null }, clients: Array<{
  client_id: string;
  client_name: string | null;
  logoUrl?: string | null;
}>): { clientName: string | null; logoUrl: string | null; visibleClientId: string | null } {
  const clientName = project.client_name ?? null;
  const client = clientName ? clients.find((candidate) => candidate.client_id === project.client_id && candidate.client_name) : undefined;
  return {
    clientName,
    logoUrl: client ? client.logoUrl ?? null : null,
    visibleClientId: client ? client.client_id : null,
  };
}

/** Table-only client metadata; authorized picker choices remain available even when no project references them. */
export function projectTableClientMetadata<TProject extends Pick<IProject, 'client_id'> & { client_name?: string | null }, TClient extends {
  client_id: string;
  client_name: string;
}>(projects: TProject[], authorizedClients: TClient[]): TClient[] {
  const visibleClientIds = new Set(projects
    .filter((project) => Boolean(project.client_name))
    .map((project) => project.client_id)
    .filter((id): id is string => typeof id === 'string'));
  return authorizedClients.filter((client) => visibleClientIds.has(client.client_id));
}

export function projectClientListsForPage<TProject extends Pick<IProject, 'client_id'> & { client_name?: string | null }, TClient extends {
  client_id: string;
  client_name: string;
}>(projects: TProject[], authorizedClients: TClient[]): { pickerClients: TClient[]; tableMetadata: TClient[] } {
  return {
    pickerClients: authorizedClients,
    tableMetadata: projectTableClientMetadata(projects, authorizedClients),
  };
}
