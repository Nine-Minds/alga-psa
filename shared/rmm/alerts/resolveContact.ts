import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

interface ResolveRmmTicketContactArgs {
  clientId?: string | null;
  mappingDefaultContactId?: string | null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function getPrimaryContactId(properties: unknown): string | null {
  const parsed =
    typeof properties === 'string'
      ? (() => {
          try {
            return JSON.parse(properties);
          } catch {
            return null;
          }
        })()
      : properties;

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const primaryContactId = (parsed as { primary_contact_id?: unknown }).primary_contact_id;
  return nonEmptyString(primaryContactId) ? primaryContactId : null;
}

async function findValidContactId(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  contactId: string,
): Promise<string | null> {
  const db = tenantDb(trx, tenant);
  const contactRow = await db.table('contacts')
    .select('contact_name_id')
    .where({
      client_id: clientId,
      contact_name_id: contactId,
      is_inactive: false,
    })
    .first();

  const validatedId = (contactRow as { contact_name_id?: unknown } | undefined)?.contact_name_id;
  return nonEmptyString(validatedId) ? validatedId : null;
}

export async function resolveRmmTicketContactId(
  trx: Knex.Transaction,
  tenant: string,
  args: ResolveRmmTicketContactArgs,
): Promise<string | null> {
  const { clientId, mappingDefaultContactId } = args;
  if (!nonEmptyString(clientId)) {
    return null;
  }

  if (nonEmptyString(mappingDefaultContactId)) {
    const mappingContactId = await findValidContactId(trx, tenant, clientId, mappingDefaultContactId);
    if (mappingContactId) {
      return mappingContactId;
    }
  }

  const db = tenantDb(trx, tenant);
  const clientRow = await db.table('clients')
    .select('properties')
    .where({ client_id: clientId })
    .first();
  const primaryContactId = getPrimaryContactId(
    (clientRow as { properties?: unknown } | undefined)?.properties,
  );

  if (!primaryContactId) {
    return null;
  }

  return findValidContactId(trx, tenant, clientId, primaryContactId);
}
