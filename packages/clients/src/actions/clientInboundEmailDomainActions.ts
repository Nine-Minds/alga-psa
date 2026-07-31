'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';
import { hasMspPermission } from '../lib/authHelpers';
import { v4 as uuidv4 } from 'uuid';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

type ClientInboundEmailDomainActionError = ActionMessageError | ActionPermissionError;

class ExpectedClientInboundEmailDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpectedClientInboundEmailDomainError';
  }
}

export interface ClientInboundEmailDomain {
  id: string;
  client_id: string;
  domain: string;
  created_at?: string;
}

function normalizeDomain(raw: string): string {
  const trimmed = String(raw ?? '').trim().toLowerCase();
  const withoutAt = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  return withoutAt;
}

function validateDomain(domain: string): string | null {
  if (!domain) return 'Domain is required';
  if (domain.includes('@')) return 'Enter a domain only (no "@")';
  if (domain.length > 255) return 'Domain is too long';
  if (domain.startsWith('.') || domain.endsWith('.')) return 'Please enter a valid email domain';
  if (domain.includes('..')) return 'Please enter a valid email domain';
  if (!domain.includes('.')) return 'Please enter a valid email domain';
  if (!/^[a-z0-9.-]+$/.test(domain)) return 'Please enter a valid email domain';
  return null;
}

async function findDomainOwner(
  trx: Knex.Transaction,
  tenant: string,
  domain: string
): Promise<{ client_id: string; client_name: string } | null> {
  const scopedDb = tenantDb(trx, tenant);
  const query = scopedDb.table('client_inbound_email_domains as d');
  scopedDb.tenantJoin(query, 'clients as c', 'd.client_id', 'c.client_id', { type: 'left' });

  const row = await query
    .select('d.client_id', 'c.client_name')
    .andWhereRaw('lower(d.domain) = ?', [domain.toLowerCase()])
    .first();

  const clientId = (row as any)?.client_id;
  const clientName = (row as any)?.client_name;
  if (typeof clientId !== 'string' || !clientId) return null;
  return { client_id: clientId, client_name: typeof clientName === 'string' && clientName ? clientName : clientId };
}

export const listClientInboundEmailDomains = withAuth(async (
  user,
  { tenant },
  clientId: string,
): Promise<ClientInboundEmailDomain[] | ClientInboundEmailDomainActionError> => {
  if (!await hasMspPermission(user, 'client', 'read')) {
    return permissionError('Permission denied: Cannot read clients');
  }

  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const rows = await tenantDb(trx, tenant).table('client_inbound_email_domains')
      .select('id', 'client_id', 'domain', 'created_at')
      .where({ client_id: clientId })
      .orderBy('domain', 'asc');
    return rows as any;
  });
});

export const addClientInboundEmailDomain = withAuth(async (
  user,
  { tenant },
  clientId: string,
  rawDomain: string
): Promise<ClientInboundEmailDomain | ClientInboundEmailDomainActionError> => {
  if (!await hasMspPermission(user, 'client', 'update')) {
    return permissionError('Permission denied: Cannot update clients');
  }

  const domain = normalizeDomain(rawDomain);
  const error = validateDomain(domain);
  if (error) {
    return actionError(error);
  }

  const { knex } = await createTenantKnex();
  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      try {
        const id = uuidv4();
        const now = new Date().toISOString();
        const [row] = await tenantDb(trx, tenant).table('client_inbound_email_domains')
          .insert({
            tenant,
            id,
            client_id: clientId,
            domain,
            created_at: now,
            updated_at: now,
          })
          .returning(['id', 'client_id', 'domain', 'created_at']);
        return row as any;
      } catch (e: any) {
        // Uniqueness (tenant, lower(domain))
        if (String(e?.code ?? '') === '23505') {
          const owner = await findDomainOwner(trx, tenant, domain);
          if (owner && owner.client_id !== clientId) {
            throw new ExpectedClientInboundEmailDomainError(`Domain "${domain}" is already assigned to client "${owner.client_name}".`);
          }
          throw new ExpectedClientInboundEmailDomainError(`Domain "${domain}" is already assigned to a client.`);
        }
        throw e;
      }
    });
  } catch (e) {
    if (e instanceof ExpectedClientInboundEmailDomainError) {
      return actionError(e.message);
    }
    console.error('Unexpected failure while adding client inbound email domain:', e);
    return actionError('Failed to add inbound email domain. Please try again.');
  }
});

export const removeClientInboundEmailDomain = withAuth(async (
  user,
  { tenant },
  clientId: string,
  domainId: string
): Promise<{ success: true } | ClientInboundEmailDomainActionError> => {
  if (!await hasMspPermission(user, 'client', 'update')) {
    return permissionError('Permission denied: Cannot update clients');
  }

  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const deleted = await tenantDb(trx, tenant).table('client_inbound_email_domains')
      .where({ client_id: clientId, id: domainId })
      .delete();
    if (deleted === 0) {
      return actionError('Inbound email domain not found.');
    }
    return { success: true as const };
  });
});
