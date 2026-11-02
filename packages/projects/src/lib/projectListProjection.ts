import type { IClient, IProject } from '@alga-psa/types';

export interface ProjectRowDecision<T> {
  project: T;
  allowed: boolean;
  redactedFields: string[];
}

export function projectPickerProjection<T extends { client_id: string; client_name: string; client_type: IClient['client_type']; is_inactive: boolean }>(
  rows: T[],
  decisions: Array<{ allowed: boolean; redactedFields: string[] }>,
): Array<{ client_id: string; client_name: string | null; client_type: IClient['client_type']; is_inactive: boolean | null }> {
  return rows.flatMap((client, index) => {
    const decision = decisions[index];
    if (!decision?.allowed) return [];
    const hidden = new Set(decision.redactedFields);
    return [{
      client_id: client.client_id,
      client_name: ['client_name', 'clients.client_name', 'name'].some((field) => hidden.has(field)) ? null : client.client_name,
      client_type: ['client_type', 'clients.client_type'].some((field) => hidden.has(field)) ? null : client.client_type,
      is_inactive: ['is_inactive', 'clients.is_inactive'].some((field) => hidden.has(field)) ? null : client.is_inactive,
    }];
  });
}

/** Group identity decisions by effective mask, fetch safe projections, and restore the identity query's order. */
export async function loadProjectRowsByDecision<T extends { project_id: string }>(input: {
  identities: T[];
  decisions: ProjectRowDecision<T>[];
  callerRedactions?: Record<string, string[]>;
  loadUnmasked: (ids: string[]) => Promise<IProject[]>;
  loadMasked: (ids: string[], fields: string[]) => Promise<IProject[]>;
}): Promise<IProject[]> {
  const groups = new Map<string, { fields: string[]; ids: string[] }>();
  for (const { project, allowed, redactedFields } of input.decisions) {
    if (!allowed) continue;
    const fields = Array.from(new Set([...redactedFields, ...(input.callerRedactions?.[project.project_id] ?? [])])).sort();
    const key = JSON.stringify(fields);
    const group = groups.get(key) ?? { fields, ids: [] };
    group.ids.push(project.project_id);
    groups.set(key, group);
  }
  const fetched: IProject[] = [];
  for (const group of groups.values()) {
    fetched.push(...(group.fields.length === 0
      ? await input.loadUnmasked(group.ids)
      : await input.loadMasked(group.ids, group.fields)));
  }
  const byId = new Map(fetched.map((project) => [project.project_id, project] as const));
  return input.identities.flatMap((identity) => {
    const row = byId.get(identity.project_id);
    return row ? [row] : [];
  });
}

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
