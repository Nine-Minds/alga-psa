import { promises as dns } from 'dns';
import { setTimeout as delay } from 'timers/promises';
import type { Knex } from 'knex';

import { getAdminConnection } from '@alga-psa/shared/db/admin.js';

import type {
  PortalDomainActivityRecord,
  VerifyCnameInput,
  VerifyCnameResult,
  MarkStatusInput,
  ReconcileResult,
} from '../workflows/portal-domains/types.js';

const TABLE_NAME = 'portal_domains';

async function getConnection(): Promise<Knex> {
  return getAdminConnection();
}

export async function loadPortalDomain(args: { portalDomainId: string }): Promise<PortalDomainActivityRecord | null> {
  const knex = await getConnection();
  const record = await knex<PortalDomainActivityRecord>(TABLE_NAME)
    .where({ id: args.portalDomainId })
    .first();

  return record || null;
}

export async function markPortalDomainStatus(args: MarkStatusInput): Promise<void> {
  const knex = await getConnection();
  const updates: Record<string, unknown> = {
    status: args.status,
    updated_at: knex.fn.now(),
    last_checked_at: knex.fn.now(),
  };

  if (args.statusMessage !== undefined) {
    updates.status_message = args.statusMessage;
  }

  if (args.verificationDetails !== undefined) {
    updates.verification_details = args.verificationDetails;
  }

  await knex(TABLE_NAME)
    .where({ id: args.portalDomainId })
    .update(updates);
}

export async function verifyCnameRecord(input: VerifyCnameInput): Promise<VerifyCnameResult> {
  const attempts = input.attempts ?? 6;
  const intervalSeconds = input.intervalSeconds ?? 10;
  const expected = normalizeHostname(input.expectedCname);
  let lastError: unknown = null;
  let observed: string[] = [];

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      observed = await lookupCname(input.domain);
      const matched = observed.some((candidate) => candidate === expected || candidate.endsWith(`.${expected}`));
      if (matched) {
        return {
          matched: true,
          observed,
          message: attempt === 0 ? 'CNAME record verified.' : `CNAME verified after ${attempt + 1} attempts.`,
        };
      }
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts - 1) {
      await delay(intervalSeconds * 1000);
    }
  }

  const errorMessage = lastError instanceof Error ? lastError.message : 'CNAME lookup did not match expected target.';

  return {
    matched: false,
    observed,
    message: errorMessage,
  };
}

export async function reconcilePortalDomains(args: { tenantId: string; portalDomainId: string }): Promise<ReconcileResult> {
  // Placeholder implementation: fetch active domains to inform logs.
  try {
    const knex = await getConnection();
    const rows = await knex<PortalDomainActivityRecord>(TABLE_NAME)
      .where({ tenant: args.tenantId })
      .andWhereNot({ status: 'disabled' });

    console.info('[portal-domains] reconcile snapshot', {
      tenantId: args.tenantId,
      count: rows.length,
      domains: rows.map((row) => row.domain),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load portal domains during reconciliation.';
    return {
      success: false,
      appliedCount: 0,
      errors: [message],
    };
  }

  // TODO: Implement Kubernetes manifest rendering and application.
  return {
    success: true,
    appliedCount: 0,
  };
}

async function lookupCname(domain: string): Promise<string[]> {
  const normalized = normalizeHostname(domain);
  const results = await dns.resolveCname(normalized).catch(async (error) => {
    // Some providers return CNAME via resolveAny
    if ((error as any)?.code === 'ENODATA' || (error as any)?.code === 'ENOTFOUND') {
      try {
        const anyRecords = await dns.resolveAny(normalized);
        const aliases = anyRecords
          .filter((record) => 'value' in record)
          .map((record: any) => String(record.value));
        if (aliases.length > 0) {
          return aliases;
        }
      } catch (innerError) {
        throw innerError;
      }
    }
    throw error;
  });

  return results.map(normalizeHostname);
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().replace(/\.$/, '').toLowerCase();
}
