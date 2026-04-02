'use server';

import { createHash, randomBytes } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';
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

const MSP_SSO_LOGIN_DOMAIN_TABLE = 'msp_sso_tenant_login_domains';
const MSP_SSO_DOMAIN_VERIFICATION_CHALLENGE_TABLE =
  'msp_sso_domain_verification_challenges';

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
  active_challenge_label?: string | null;
  active_challenge_value?: string | null;
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

export interface MspSsoDomainVerificationChallenge {
  id: string;
  claim_id: string;
  challenge_type: 'dns_txt';
  challenge_label: string;
  challenge_value: string;
  challenge_token_hash: string;
  is_active: boolean;
  expires_at: string | null;
  verified_at: string | null;
  invalidated_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface RequestMspSsoDomainClaimResult {
  success: boolean;
  claim?: MspSsoDomainClaim;
  challenge?: MspSsoDomainVerificationChallenge;
  idempotent?: boolean;
  error?: string;
}

export interface RefreshMspSsoDomainClaimChallengeResult {
  success: boolean;
  claim?: MspSsoDomainClaim;
  challenge?: MspSsoDomainVerificationChallenge;
  error?: string;
}

export interface VerifyMspSsoDomainClaimResult {
  success: boolean;
  claim?: MspSsoDomainClaim;
  error?: string;
}

export interface RevokeMspSsoDomainClaimResult {
  success: boolean;
  claim?: MspSsoDomainClaim;
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

function toIsoOrNull(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : null;
}

function hashChallengeValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function lookupDnsTxtValues(hostname: string): Promise<string[]> {
  try {
    const rows = await resolveTxt(hostname);
    return rows
      .map((record) => record.join(''))
      .map((value) => value.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function buildDnsTxtChallenge(domain: string): {
  challengeType: 'dns_txt';
  challengeLabel: string;
  challengeValue: string;
} {
  const token = randomBytes(24).toString('hex');
  return {
    challengeType: 'dns_txt',
    challengeLabel: `_alga-msp-sso.${domain}`,
    challengeValue: `alga-sso-verification=${token}`,
  };
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
  const hasChallengeTable = await knex.schema.hasTable(MSP_SSO_DOMAIN_VERIFICATION_CHALLENGE_TABLE);

  const rows = await knex(MSP_SSO_LOGIN_DOMAIN_TABLE)
    .select(
      'id',
      'domain',
      'is_active',
      'claim_status',
      'claim_status_updated_at',
      'claimed_at',
      'verified_at',
      'rejected_at',
      'revoked_at'
    )
    .where({ tenant, is_active: true })
    .orderByRaw('lower(domain) asc');

  const claims = rows
    .map<MspSsoDomainClaim | null>((row) => {
      const claim = row as Record<string, unknown>;
      const id = String(claim.id ?? '');
      const domain = normalizeDomain(String(claim.domain ?? ''));
      if (!id || !domain) return null;

      return {
        id,
        domain,
        is_active: Boolean(claim.is_active),
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

  const dedupedClaims = Array.from(byDomain.values()).sort((left, right) => left.domain.localeCompare(right.domain));
  if (!hasChallengeTable || dedupedClaims.length === 0) {
    return dedupedClaims;
  }

  const claimIds = dedupedClaims.map((claim) => claim.id);
  const challengeRows = await knex(MSP_SSO_DOMAIN_VERIFICATION_CHALLENGE_TABLE)
    .select('claim_id', 'challenge_label', 'challenge_value', 'created_at')
    .where({ tenant, is_active: true })
    .whereIn('claim_id', claimIds)
    .orderBy('created_at', 'desc');

  const challengeByClaimId = new Map<string, { label: string; value: string }>();
  for (const row of challengeRows as Array<Record<string, unknown>>) {
    const claimId = String(row.claim_id ?? '');
    if (!claimId || challengeByClaimId.has(claimId)) continue;
    challengeByClaimId.set(claimId, {
      label: String(row.challenge_label ?? ''),
      value: String(row.challenge_value ?? ''),
    });
  }

  return dedupedClaims.map((claim) => {
    const challenge = challengeByClaimId.get(claim.id);
    return {
      ...claim,
      active_challenge_label: challenge?.label ?? null,
      active_challenge_value: challenge?.value ?? null,
    };
  });
}

async function toDomainClaim(
  knex: Knex | Knex.Transaction,
  tenant: string,
  claimId: string
): Promise<MspSsoDomainClaim | null> {
  const row = await knex(MSP_SSO_LOGIN_DOMAIN_TABLE)
    .select(
      'id',
      'domain',
      'is_active',
      'claim_status',
      'claim_status_updated_at',
      'claimed_at',
      'verified_at',
      'rejected_at',
      'revoked_at'
    )
    .where({ tenant, id: claimId })
    .first();

  if (!row) return null;
  const record = row as Record<string, unknown>;
  const id = String(record.id ?? '');
  const domain = normalizeDomain(String(record.domain ?? ''));
  if (!id || !domain) return null;

  return {
    id,
    domain,
    is_active: Boolean(record.is_active),
    claim_status: normalizeMspSsoDomainClaimStatus(record.claim_status),
    claim_status_updated_at: toIsoOrNull(record.claim_status_updated_at),
    claimed_at: toIsoOrNull(record.claimed_at),
    verified_at: toIsoOrNull(record.verified_at),
    rejected_at: toIsoOrNull(record.rejected_at),
    revoked_at: toIsoOrNull(record.revoked_at),
  };
}

async function toVerificationChallenge(
  knex: Knex | Knex.Transaction,
  tenant: string,
  claimId: string
): Promise<MspSsoDomainVerificationChallenge | null> {
  const row = await knex(MSP_SSO_DOMAIN_VERIFICATION_CHALLENGE_TABLE)
    .select(
      'id',
      'claim_id',
      'challenge_type',
      'challenge_label',
      'challenge_value',
      'challenge_token_hash',
      'is_active',
      'expires_at',
      'verified_at',
      'invalidated_at',
      'created_at',
      'updated_at'
    )
    .where({ tenant, claim_id: claimId, is_active: true })
    .orderBy('created_at', 'desc')
    .first();

  if (!row) return null;
  const record = row as Record<string, unknown>;
  return {
    id: String(record.id ?? ''),
    claim_id: String(record.claim_id ?? ''),
    challenge_type: 'dns_txt',
    challenge_label: String(record.challenge_label ?? ''),
    challenge_value: String(record.challenge_value ?? ''),
    challenge_token_hash: String(record.challenge_token_hash ?? ''),
    is_active: Boolean(record.is_active),
    expires_at: toIsoOrNull(record.expires_at),
    verified_at: toIsoOrNull(record.verified_at),
    invalidated_at: toIsoOrNull(record.invalidated_at),
    created_at: toIsoOrNull(record.created_at),
    updated_at: toIsoOrNull(record.updated_at),
  };
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

export const requestMspSsoDomainClaim = withAuth(async (
  user,
  { tenant },
  input: { domain: string }
): Promise<RequestMspSsoDomainClaimResult> => {
  try {
    if (!(await canManageDomains(user))) {
      return { success: false, error: 'Forbidden' };
    }

    const normalizedDomain = normalizeDomain(input?.domain ?? '');
    const validationError = validateDomain(normalizedDomain);
    if (validationError) {
      return { success: false, error: validationError };
    }

    const { knex } = await createTenantKnex();

    const result = await knex.transaction(async (trx: Knex.Transaction) => {
      const now = trx.fn.now();
      const actorId = (user as { user_id?: string })?.user_id ?? null;

      let claimRow = await trx(MSP_SSO_LOGIN_DOMAIN_TABLE)
        .select('id', 'domain', 'is_active', 'claim_status')
        .where({ tenant })
        .whereRaw('lower(domain) = ?', [normalizedDomain])
        .first();

      let claimId = String((claimRow as { id?: string } | undefined)?.id ?? '');
      const existingClaimStatus = normalizeMspSsoDomainClaimStatus(
        (claimRow as { claim_status?: unknown } | undefined)?.claim_status
      );

      if (!claimId) {
        claimId = uuidv4();
        await trx(MSP_SSO_LOGIN_DOMAIN_TABLE).insert({
          tenant,
          id: claimId,
          domain: normalizedDomain,
          is_active: true,
          claim_status: 'pending',
          claim_status_updated_at: now,
          claim_status_updated_by: actorId,
          claimed_at: now,
          created_by: actorId,
          updated_by: actorId,
          created_at: now,
          updated_at: now,
        });
      } else if (existingClaimStatus !== 'pending') {
        await trx(MSP_SSO_LOGIN_DOMAIN_TABLE)
          .where({ tenant, id: claimId })
          .update({
            domain: normalizedDomain,
            is_active: true,
            claim_status: 'pending',
            claim_status_updated_at: now,
            claim_status_updated_by: actorId,
            claimed_at: now,
            rejected_at: null,
            revoked_at: null,
            updated_by: actorId,
            updated_at: now,
          });
      }

      const existingActiveChallenge = await toVerificationChallenge(trx, tenant, claimId);
      if (existingClaimStatus === 'pending' && existingActiveChallenge) {
        const claim = await toDomainClaim(trx, tenant, claimId);
        return {
          claim,
          challenge: existingActiveChallenge,
          idempotent: true,
        };
      }

      await trx(MSP_SSO_DOMAIN_VERIFICATION_CHALLENGE_TABLE)
        .where({ tenant, claim_id: claimId, is_active: true })
        .update({
          is_active: false,
          invalidated_at: now,
          updated_by: actorId,
          updated_at: now,
        });

      const challenge = buildDnsTxtChallenge(normalizedDomain);
      const challengeId = uuidv4();
      await trx(MSP_SSO_DOMAIN_VERIFICATION_CHALLENGE_TABLE).insert({
        tenant,
        id: challengeId,
        claim_id: claimId,
        challenge_type: challenge.challengeType,
        challenge_label: challenge.challengeLabel,
        challenge_value: challenge.challengeValue,
        challenge_token_hash: hashChallengeValue(challenge.challengeValue),
        is_active: true,
        created_by: actorId,
        updated_by: actorId,
        created_at: now,
        updated_at: now,
      });

      const [claim, activeChallenge] = await Promise.all([
        toDomainClaim(trx, tenant, claimId),
        toVerificationChallenge(trx, tenant, claimId),
      ]);

      return {
        claim,
        challenge: activeChallenge,
        idempotent: false,
      };
    });

    if (!result.claim || !result.challenge) {
      return { success: false, error: 'Unable to create or load domain claim challenge.' };
    }

    return {
      success: true,
      claim: result.claim,
      challenge: result.challenge,
      idempotent: result.idempotent ?? false,
    };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to request MSP SSO domain claim',
    };
  }
});

export const refreshMspSsoDomainClaimChallenge = withAuth(async (
  user,
  { tenant },
  input: { claimId: string }
): Promise<RefreshMspSsoDomainClaimChallengeResult> => {
  try {
    if (!(await canManageDomains(user))) {
      return { success: false, error: 'Forbidden' };
    }

    const claimId = String(input?.claimId ?? '').trim();
    if (!claimId) {
      return { success: false, error: 'Claim id is required.' };
    }

    const { knex } = await createTenantKnex();

    const result = await knex.transaction(async (trx: Knex.Transaction) => {
      const now = trx.fn.now();
      const actorId = (user as { user_id?: string })?.user_id ?? null;

      const claimRow = await trx(MSP_SSO_LOGIN_DOMAIN_TABLE)
        .select('id', 'domain')
        .where({ tenant, id: claimId, is_active: true })
        .first();

      if (!claimRow) {
        return { claim: null, challenge: null };
      }

      const domain = normalizeDomain(String((claimRow as { domain?: string }).domain ?? ''));
      if (!domain) {
        return { claim: null, challenge: null };
      }

      await trx(MSP_SSO_LOGIN_DOMAIN_TABLE)
        .where({ tenant, id: claimId })
        .update({
          claim_status: 'pending',
          claim_status_updated_at: now,
          claim_status_updated_by: actorId,
          claimed_at: now,
          rejected_at: null,
          revoked_at: null,
          updated_by: actorId,
          updated_at: now,
        });

      await trx(MSP_SSO_DOMAIN_VERIFICATION_CHALLENGE_TABLE)
        .where({ tenant, claim_id: claimId, is_active: true })
        .update({
          is_active: false,
          invalidated_at: now,
          updated_by: actorId,
          updated_at: now,
        });

      const challenge = buildDnsTxtChallenge(domain);
      await trx(MSP_SSO_DOMAIN_VERIFICATION_CHALLENGE_TABLE).insert({
        tenant,
        id: uuidv4(),
        claim_id: claimId,
        challenge_type: challenge.challengeType,
        challenge_label: challenge.challengeLabel,
        challenge_value: challenge.challengeValue,
        challenge_token_hash: hashChallengeValue(challenge.challengeValue),
        is_active: true,
        created_by: actorId,
        updated_by: actorId,
        created_at: now,
        updated_at: now,
      });

      const [claim, activeChallenge] = await Promise.all([
        toDomainClaim(trx, tenant, claimId),
        toVerificationChallenge(trx, tenant, claimId),
      ]);
      return { claim, challenge: activeChallenge };
    });

    if (!result.claim || !result.challenge) {
      return { success: false, error: 'Unable to refresh challenge for that claim.' };
    }

    return {
      success: true,
      claim: result.claim,
      challenge: result.challenge,
    };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to refresh MSP SSO claim challenge',
    };
  }
});

export const verifyMspSsoDomainClaimOwnership = withAuth(async (
  user,
  { tenant },
  input: { claimId: string }
): Promise<VerifyMspSsoDomainClaimResult> => {
  try {
    if (!(await canManageDomains(user))) {
      return { success: false, error: 'Forbidden' };
    }

    const claimId = String(input?.claimId ?? '').trim();
    if (!claimId) {
      return { success: false, error: 'Claim id is required.' };
    }

    const { knex } = await createTenantKnex();
    const actorId = (user as { user_id?: string })?.user_id ?? null;

    const result = await knex.transaction(async (trx: Knex.Transaction) => {
      const claim = await toDomainClaim(trx, tenant, claimId);
      if (!claim || !claim.is_active) {
        return { claim: null, verified: false, reason: 'missing_claim' as const };
      }

      const challenge = await toVerificationChallenge(trx, tenant, claimId);
      if (!challenge || !challenge.is_active || challenge.challenge_type !== 'dns_txt') {
        return { claim, verified: false, reason: 'missing_challenge' as const };
      }

      const txtValues = await lookupDnsTxtValues(challenge.challenge_label);
      const challengeMatched = txtValues.some((value) => value === challenge.challenge_value);
      if (!challengeMatched) {
        return { claim, verified: false, reason: 'dns_mismatch' as const };
      }

      // Serialize cross-tenant verified-owner decisions for the same domain when running on
      // distributed tables where a global unique index on lower(domain) may be unavailable.
      await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [
        `msp_sso_verified_domain_owner:${claim.domain}`,
      ]);

      const conflictingOwner = await trx(MSP_SSO_LOGIN_DOMAIN_TABLE)
        .select('tenant')
        .whereNot({ tenant })
        .where({ is_active: true })
        .whereIn('claim_status', ['verified', 'verified_legacy'])
        .whereRaw('lower(domain) = ?', [claim.domain])
        .first();
      if (conflictingOwner) {
        return { claim, verified: false, reason: 'verified_conflict' as const };
      }

      const now = trx.fn.now();
      await trx(MSP_SSO_LOGIN_DOMAIN_TABLE)
        .where({ tenant, id: claimId })
        .update({
          claim_status: 'verified',
          claim_status_updated_at: now,
          claim_status_updated_by: actorId,
          verified_at: now,
          rejected_at: null,
          revoked_at: null,
          updated_by: actorId,
          updated_at: now,
        });

      await trx(MSP_SSO_DOMAIN_VERIFICATION_CHALLENGE_TABLE)
        .where({ tenant, id: challenge.id })
        .update({
          verified_at: now,
          is_active: false,
          invalidated_at: now,
          updated_by: actorId,
          updated_at: now,
        });

      const verifiedClaim = await toDomainClaim(trx, tenant, claimId);
      return { claim: verifiedClaim, verified: true, reason: null };
    });

    if (result.verified && result.claim) {
      return { success: true, claim: result.claim };
    }

    if (result.reason === 'verified_conflict') {
      return {
        success: false,
        error:
          'Unable to verify domain ownership because another tenant already has an active verified claim for this domain.',
        claim: result.claim ?? undefined,
      };
    }

    const missing = result.reason === 'missing_claim' || result.reason === 'missing_challenge';
    return {
      success: false,
      error: missing
        ? 'Unable to find an active claim/challenge for verification.'
        : 'Unable to verify domain ownership. Confirm DNS TXT challenge record and retry.',
      claim: result.claim ?? undefined,
    };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to verify MSP SSO domain claim',
    };
  }
});

export const revokeMspSsoDomainClaim = withAuth(async (
  user,
  { tenant },
  input: { claimId: string }
): Promise<RevokeMspSsoDomainClaimResult> => {
  try {
    if (!(await canManageDomains(user))) {
      return { success: false, error: 'Forbidden' };
    }

    const claimId = String(input?.claimId ?? '').trim();
    if (!claimId) {
      return { success: false, error: 'Claim id is required.' };
    }

    const { knex } = await createTenantKnex();
    const actorId = (user as { user_id?: string })?.user_id ?? null;

    const result = await knex.transaction(async (trx: Knex.Transaction) => {
      const existingClaim = await toDomainClaim(trx, tenant, claimId);
      if (!existingClaim || !existingClaim.is_active) {
        return null;
      }

      const now = trx.fn.now();
      await trx(MSP_SSO_LOGIN_DOMAIN_TABLE)
        .where({ tenant, id: claimId })
        .update({
          claim_status: 'revoked',
          claim_status_updated_at: now,
          claim_status_updated_by: actorId,
          revoked_at: now,
          updated_by: actorId,
          updated_at: now,
        });

      await trx(MSP_SSO_DOMAIN_VERIFICATION_CHALLENGE_TABLE)
        .where({ tenant, claim_id: claimId, is_active: true })
        .update({
          is_active: false,
          invalidated_at: now,
          updated_by: actorId,
          updated_at: now,
        });

      return toDomainClaim(trx, tenant, claimId);
    });

    if (!result) {
      return { success: false, error: 'Unable to find an active claim to revoke.' };
    }

    return {
      success: true,
      claim: result,
    };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to revoke MSP SSO domain claim',
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
        .whereIn(knex.raw('lower(domain)') as unknown as string, desiredDomains);

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
          .whereNotIn(trx.raw('lower(domain)') as unknown as string, desiredDomains)
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
              claim_status: 'advisory',
              claim_status_updated_at: trx.fn.now(),
              claim_status_updated_by: (user as { user_id?: string })?.user_id ?? null,
              rejected_at: null,
              revoked_at: null,
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
          claim_status: 'advisory',
          claim_status_updated_at: trx.fn.now(),
          claim_status_updated_by: (user as { user_id?: string })?.user_id ?? null,
          claimed_at: trx.fn.now(),
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
