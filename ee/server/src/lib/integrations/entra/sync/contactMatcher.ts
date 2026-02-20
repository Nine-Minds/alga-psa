import { createTenantKnex, runWithTenant } from '@/lib/db';
import type { EntraSyncUser } from './types';

export interface EntraContactMatchCandidate {
  contactNameId: string;
  clientId: string | null;
  email: string | null;
  fullName: string | null;
  isInactive: boolean;
}

function normalizeEmail(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export async function findContactMatchesByEmail(
  tenantId: string,
  clientId: string,
  user: EntraSyncUser
): Promise<EntraContactMatchCandidate[]> {
  const normalizedEmail = normalizeEmail(user.email || user.userPrincipalName);
  if (!normalizedEmail) {
    return [];
  }

  return runWithTenant(tenantId, async () => {
    const { knex } = await createTenantKnex();
    const rows = await knex('contacts')
      .where({
        tenant: tenantId,
        client_id: clientId,
      })
      .andWhereRaw('lower(email) = ?', [normalizedEmail])
      .select(['contact_name_id', 'client_id', 'email', 'full_name', 'is_inactive'])
      .orderBy('updated_at', 'desc');

    return rows.map((row: any) => ({
      contactNameId: String(row.contact_name_id),
      clientId: row.client_id ? String(row.client_id) : null,
      email: row.email ? String(row.email) : null,
      fullName: row.full_name ? String(row.full_name) : null,
      isInactive: Boolean(row.is_inactive),
    }));
  });
}
