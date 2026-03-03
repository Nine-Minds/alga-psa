'use server';

import { v4 as uuidv4 } from 'uuid';
import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth/withAuth';
import { hasPermission } from '@alga-psa/auth/rbac';
import {
  normalizeMspSsoDomain,
  normalizeMspSsoDomainClaimStatus,
  validateMspSsoDomain,
  type MspSsoDomainClaimStatus,
} from '@alga-psa/auth/lib/sso/mspSsoResolution';
import type { Knex } from 'knex';

export const MSP_SSO_LOGIN_DOMAIN_TABLE = 'msp_sso_tenant_login_domains';

export interface MspSsoLoginDomain {
  id: string;
  domain: string;
  is_active: boolean;
}

export interface ListMspSsoLoginDomainsResult {
  success: boolean;
  domains?: string[];
  error?: string;
}

export interface MspSsoDomainClaim {
  id: string;
  domain: string;
  is_active: boolean;
  claim_status: MspSsoDomainClaimStatus;
  claim_status_updated_at: string | null;
  claimed_at: string | null;
  verified_at: string | null;
  rejected_at: string | null;
  revoked_at: string | null;
}

export interface ListMspSsoDomainClaimsResult {
  success: boolean;
  claims?: MspSsoDomainClaim[];
  error?: string;
}

export interface SaveMspSsoLoginDomainsResult {
  success: boolean;
  domains?: string[];
  conflicts?: string[];
  error?: string;
}

function normalizeDomain(value: string): string {
  return normalizeMspSsoDomain(value);
}

function validateDomain(domain: string): string | null {
  return validateMspSsoDomain(domain);
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

async function canManageDomains(user: unknown): Promise<boolean> {
  const userRecord = user as { user_type?: string } | null | undefined;
  if (userRecord?.user_type === 'client') return false;
  return hasPermission(user as never, 'system_settings', 'update');
}

async function listActiveTenantDomains(knex: Knex, tenant: string): Promise<string[]> {
  const claims = await listActiveTenantDomainClaims(knex, tenant);
  return uniqueSorted(claims.map((claim) => claim.domain));
}

async function listActiveTenantDomainClaims(knex: Knex, tenant: string): Promise<MspSsoDomainClaim[]> {
  const hasClaimStatus = await knex.schema.hasColumn(MSP_SSO_LOGIN_DOMAIN_TABLE, 'claim_status');

  const rows = await knex(MSP_SSO_LOGIN_DOMAIN_TABLE)
    .select(
      'id',
      'domain',
      'is_active',
      ...(hasClaimStatus
        ? [
            'claim_status',
            'claim_status_updated_at',
            'claimed_at',
            'verified_at',
            'rejected_at',
            'revoked_at',
          ]
        : [])
    )
    .where({ tenant, is_active: true })
    .orderByRaw('lower(domain) asc');

  const claims = rows
    .map((row) => {
      const claim = row as Record<string, unknown>;
      const id = String(claim.id ?? '');
      const domain = normalizeDomain(String(claim.domain ?? ''));
      if (!id || !domain) return null;

      return {
        id,
        domain,
        is_active: true,
        claim_status: normalizeMspSsoDomainClaimStatus(claim.claim_status),
        claim_status_updated_at:
          claim.claim_status_updated_at instanceof Date
            ? claim.claim_status_updated_at.toISOString()
            : typeof claim.claim_status_updated_at === 'string'
              ? claim.claim_status_updated_at
              : null,
        claimed_at:
          claim.claimed_at instanceof Date
            ? claim.claimed_at.toISOString()
            : typeof claim.claimed_at === 'string'
              ? claim.claimed_at
              : null,
        verified_at:
          claim.verified_at instanceof Date
            ? claim.verified_at.toISOString()
            : typeof claim.verified_at === 'string'
              ? claim.verified_at
              : null,
        rejected_at:
          claim.rejected_at instanceof Date
            ? claim.rejected_at.toISOString()
            : typeof claim.rejected_at === 'string'
              ? claim.rejected_at
              : null,
        revoked_at:
          claim.revoked_at instanceof Date
            ? claim.revoked_at.toISOString()
            : typeof claim.revoked_at === 'string'
              ? claim.revoked_at
              : null,
      } satisfies MspSsoDomainClaim;
    })
    .filter((claim): claim is MspSsoDomainClaim => claim !== null);

  const byDomain = new Map<string, MspSsoDomainClaim>();
  for (const claim of claims) {
    if (!byDomain.has(claim.domain)) {
      byDomain.set(claim.domain, claim);
    }
  }

  return Array.from(byDomain.values()).sort((left, right) => left.domain.localeCompare(right.domain));
}

export const listMspSsoLoginDomains = withAuth(async (
  user,
  { tenant }
): Promise<ListMspSsoLoginDomainsResult> => {
  try {
    if (!(await canManageDomains(user))) {
      return { success: false, error: 'Forbidden' };
    }

    const { knex } = await createTenantKnex();
    const domains = await listActiveTenantDomains(knex as Knex, tenant);
    return { success: true, domains };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load MSP SSO login domains',
    };
  }
});

export const listMspSsoDomainClaims = withAuth(async (
  user,
  { tenant }
): Promise<ListMspSsoDomainClaimsResult> => {
  try {
    if (!(await canManageDomains(user))) {
      return { success: false, error: 'Forbidden' };
    }

    const { knex } = await createTenantKnex();
    const claims = await listActiveTenantDomainClaims(knex as Knex, tenant);
    return { success: true, claims };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load MSP SSO domain claims',
    };
  }
});

export const saveMspSsoLoginDomains = withAuth(async (
  user,
  { tenant },
  input: { domains: string[] }
): Promise<SaveMspSsoLoginDomainsResult> => {
  try {
    if (!(await canManageDomains(user))) {
      return { success: false, error: 'Forbidden' };
    }

    const rawDomains = Array.isArray(input?.domains) ? input.domains : [];
    const normalizedDomains = rawDomains.map(normalizeDomain);

    for (const domain of normalizedDomains) {
      const validationError = validateDomain(domain);
      if (validationError) {
        return { success: false, error: validationError };
      }
    }

    if (normalizedDomains.length !== new Set(normalizedDomains).size) {
      return { success: false, error: 'Duplicate domains are not allowed.' };
    }

    const desiredDomains = uniqueSorted(normalizedDomains);
    const { knex } = await createTenantKnex();

    if (desiredDomains.length > 0) {
      const conflicts = await knex(MSP_SSO_LOGIN_DOMAIN_TABLE)
        .select('domain')
        .where({ is_active: true })
        .whereNot({ tenant })
        .whereIn(knex.raw('lower(domain)'), desiredDomains);

      if (conflicts.length > 0) {
        const conflictDomains = uniqueSorted(
          conflicts
            .map((row) => normalizeDomain(String((row as { domain?: string }).domain ?? '')))
            .filter(Boolean)
        );

        return {
          success: false,
          error: 'One or more domains are already in use.',
          conflicts: conflictDomains,
        };
      }
    }

    await knex.transaction(async (trx: Knex.Transaction) => {
      const existingRows = await trx(MSP_SSO_LOGIN_DOMAIN_TABLE)
        .select('id', 'domain', 'is_active')
        .where({ tenant });

      const existingByDomain = new Map<string, MspSsoLoginDomain>();
      for (const row of existingRows as MspSsoLoginDomain[]) {
        existingByDomain.set(normalizeDomain(row.domain), row);
      }

      if (desiredDomains.length > 0) {
        await trx(MSP_SSO_LOGIN_DOMAIN_TABLE)
          .where({ tenant, is_active: true })
          .whereNotIn(trx.raw('lower(domain)'), desiredDomains)
          .update({
            is_active: false,
            updated_by: (user as { user_id?: string })?.user_id ?? null,
            updated_at: trx.fn.now(),
          });
      } else {
        await trx(MSP_SSO_LOGIN_DOMAIN_TABLE)
          .where({ tenant, is_active: true })
          .update({
            is_active: false,
            updated_by: (user as { user_id?: string })?.user_id ?? null,
            updated_at: trx.fn.now(),
          });
      }

      for (const domain of desiredDomains) {
        const existing = existingByDomain.get(domain);
        if (existing) {
          await trx(MSP_SSO_LOGIN_DOMAIN_TABLE)
            .where({ tenant, id: existing.id })
            .update({
              domain,
              is_active: true,
              updated_by: (user as { user_id?: string })?.user_id ?? null,
              updated_at: trx.fn.now(),
            });
          continue;
        }

        await trx(MSP_SSO_LOGIN_DOMAIN_TABLE).insert({
          tenant,
          id: uuidv4(),
          domain,
          is_active: true,
          created_by: (user as { user_id?: string })?.user_id ?? null,
          updated_by: (user as { user_id?: string })?.user_id ?? null,
          created_at: trx.fn.now(),
          updated_at: trx.fn.now(),
        });
      }
    });

    const domains = await listActiveTenantDomains(knex as Knex, tenant);
    return { success: true, domains };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save MSP SSO login domains',
    };
  }
});

export const __testExports = {
  normalizeDomain,
  validateDomain,
};
