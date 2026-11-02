import type { IClient, IProject } from '@alga-psa/types';

/** A masked projection deliberately has a null client_name even when client_id remains visible. */
export function projectClientPresentation(project: IProject, clients: IClient[]): IClient | null {
  if (project.client_name == null || !project.client_id) return null;
  return clients.find((client) => client.client_id === project.client_id) ?? null;
}
