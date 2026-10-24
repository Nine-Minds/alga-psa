import { DattoRmmPermissionError } from './dattoApiClient';
import { buildDattoClientForTenant } from './buildClient';

export interface DattoComponentSummary {
  uid: string;
  name: string;
  description: string;
  categoryCode: string;
  variables: Array<{ name: string; type: string; defaultVal: string; description: string; direction: boolean }>;
}

/**
 * Components (scripts) the Datto API user can run, for the reboot-component
 * and run-script pickers. Returns [] when the integration is not configured or
 * the API user's security level cannot read components (403).
 */
export async function listDattoComponents(tenant: string): Promise<DattoComponentSummary[]> {
  const client = await buildDattoClientForTenant(tenant, { allowInactive: true });
  if (!client) return [];

  let components;
  try {
    components = await client.listComponents();
  } catch (err) {
    if (err instanceof DattoRmmPermissionError) return [];
    throw err;
  }

  return components
    .filter((c) => c?.uid)
    .map((c) => ({
      uid: String(c.uid),
      name: String(c.name ?? c.uid),
      description: String(c.description ?? ''),
      categoryCode: String(c.categoryCode ?? ''),
      variables: (c.variables ?? []).map((v) => ({
        name: String(v?.name ?? ''),
        type: String(v?.type ?? ''),
        defaultVal: String(v?.defaultVal ?? ''),
        description: String(v?.description ?? ''),
        direction: Boolean(v?.direction),
      })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
