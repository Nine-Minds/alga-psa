'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';
import { hasPermissionAsync } from '../lib/authHelpers';
import { v4 as uuidv4 } from 'uuid';

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
  const row = await trx('client_inbound_email_domains as d')
    .leftJoin('clients as c', function () {
      this.on('d.client_id', '=', 'c.client_id').andOn('d.tenant', '=', 'c.tenant');
    })
    .select('d.client_id', 'c.client_name')
    .where('d.tenant', tenant)
    .andWhereRaw('lower(d.domain) = ?', [domain.toLowerCase()])
    .first();

  const clientId = (row as any)?.client_id;
  const clientName = (row as any)?.client_name;
  if (typeof clientId !== 'string' || !clientId) return null;
  return { client_id: clientId, client_name: typeof clientName === 'string' && clientName ? clientName : clientId };
}

export const listClientInboundEmailDomains = withAuth(async (user, { tenant }, clientId: string): Promise<ClientInboundEmailDomain[]> => {
  if (!await hasPermissionAsync(user, 'client', 'read')) {
    throw new Error('Permission denied: Cannot read clients');
  }

  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const rows = await trx('client_inbound_email_domains')
      .select('id', 'client_id', 'domain', 'created_at')
      .where({ tenant, client_id: clientId })
      .orderBy('domain', 'asc');
    return rows as any;
  });
});

export const addClientInboundEmailDomain = withAuth(async (
  user,
  { tenant },
  clientId: string,
  rawDomain: string
): Promise<ClientInboundEmailDomain> => {
  if (!await hasPermissionAsync(user, 'client', 'update')) {
    throw new Error('Permission denied: Cannot update clients');
  }

  const domain = normalizeDomain(rawDomain);
  const error = validateDomain(domain);
  if (error) {
    throw new Error(error);
  }

  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx: Knex.Transaction) => {
    try {
      const id = uuidv4();
      const now = new Date().toISOString();
      const [row] = await trx('client_inbound_email_domains')
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
          throw new Error(`Domain "${domain}" is already assigned to client "${owner.client_name}".`);
        }
        throw new Error(`Domain "${domain}" is already assigned to a client.`);
      }
      throw e;
    }
  });
});

export const removeClientInboundEmailDomain = withAuth(async (
  user,
  { tenant },
  clientId: string,
  domainId: string
): Promise<{ success: true }> => {
  if (!await hasPermissionAsync(user, 'client', 'update')) {
    throw new Error('Permission denied: Cannot update clients');
  }

  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx: Knex.Transaction) => {
    await trx('client_inbound_email_domains')
      .where({ tenant, client_id: clientId, id: domainId })
      .delete();
    return { success: true as const };
  });
});

