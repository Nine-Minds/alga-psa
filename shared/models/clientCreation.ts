/**
 * The one seam that writes a `clients` row.
 *
 * Client creation has a fixed list of prerequisites — a default billing profile
 * (the terminal step of charge attribution), a system-managed default contract
 * when the client is billing-configured, default tax settings, and the tenant's
 * configured default currency. Every caller used to repeat that list by hand and
 * each one forgot a different member of it. Route new creation paths through
 * here instead of inserting directly; `clientCreationSeam.contract.test.ts`
 * fails CI on a direct insert.
 *
 * Deliberately not here: authentication/permissions, request validation,
 * locations, tags, external-entity mappings, and the post-commit CLIENT_CREATED
 * publish — all of those belong to the caller, which owns the transaction.
 */
import type { Knex } from 'knex';
// Subpath import, not the package barrel: the barrel re-exports the Knex
// turbopack shim (`import.meta.url`-based CJS patch), which blows up with
// "exports is not defined in ES module scope" under loaders that don't
// transpile that file as CommonJS (e.g. Playwright's ts-node-less TS loader).
import { tenantDb } from '@alga-psa/db/tenantDb';
import { resolveProductCode, type IClient } from '@alga-psa/types';
// The shared-internal shape is the permissive one (nullable url, open index
// signature), which is what an insert payload needs.
import type { IClient as IClientInsertShape } from '../interfaces/client.interfaces';
import { ensureClientDefaultBillingProfile } from '../billingClients/billingProfiles';
import { ensureDefaultContractForClientIfBillingConfigured } from '../billingClients/defaultContract';
import { initializeClientDefaultTax } from '../billingClients/defaultTaxRate';

export interface CreateClientWithDefaultsOptions {
  /**
   * Whether to skip default tax initialization. Authoritative when supplied —
   * for callers that already resolved the tenant's product code once for a
   * batch, or that intentionally own tax setup. Omit to resolve it here.
   */
  skipTaxSettings?: boolean;
  /**
   * Pre-resolved tenant default currency, so a batch caller pays for the
   * `default_billing_settings` lookup once instead of once per row.
   */
  defaultCurrencyCode?: string;
}

/**
 * Column values for the new row. Only real `clients` columns belong here: the
 * payload is spread into the insert, so a stray key (`email`, `source`) is a
 * database error, not a silently dropped field.
 */
export type CreateClientWithDefaultsData = Partial<IClientInsertShape> & { client_name: string };

export async function createClientWithDefaults(
  trx: Knex.Transaction,
  tenant: string,
  data: CreateClientWithDefaultsData,
  options: CreateClientWithDefaultsOptions = {}
): Promise<IClient> {
  const db = tenantDb(trx, tenant);
  const clientData: Record<string, unknown> = { ...data };

  // url and properties.website are two views of one value; whichever side the
  // caller filled in populates the other.
  const properties = clientData.properties as Record<string, unknown> | null | undefined;
  if (properties?.website && !clientData.url) {
    clientData.url = properties.website;
  }
  if (clientData.url && !properties?.website) {
    clientData.properties = { ...(properties ?? {}), website: clientData.url };
  }

  // Adopt the tenant's configured default currency rather than letting the
  // column's own 'USD' default stand in for a tenant that bills in something
  // else. 'USD' remains the final fallback.
  if (!clientData.default_currency_code) {
    const configured = options.defaultCurrencyCode
      ?? (
        await db.table('default_billing_settings')
          .select('default_currency_code')
          .first()
      )?.default_currency_code;
    clientData.default_currency_code = configured || 'USD';
  }

  if (clientData.is_inactive === undefined || clientData.is_inactive === null) {
    clientData.is_inactive = false;
  }

  const now = new Date().toISOString();
  const [created] = await db.table('clients')
    .insert({
      ...clientData,
      tenant,
      created_at: now,
      updated_at: now,
    })
    .returning('*');

  if (!created?.client_id) {
    throw new Error('Client insert completed without returning the created record.');
  }

  // Every client must have exactly one default billing profile. Provisioned
  // here so it carries the client's name from the start.
  await ensureClientDefaultBillingProfile(trx, tenant, created.client_id, {
    clientName: created.client_name,
  });

  await ensureDefaultContractForClientIfBillingConfigured(trx, {
    tenant,
    clientId: created.client_id,
  });

  // Tax initialization shares the client transaction: a configured-but-invalid
  // default must roll the client back rather than commit a client with no
  // usable tax configuration. A tenant that has not configured tax at all is
  // tolerated by the initializer. AlgaDesk has no billing tax setup and keeps
  // its existing exemption; a batch caller that already resolved the product
  // code passes the answer in, so this does not re-read `tenants` per row.
  const skipTax = options.skipTaxSettings
    ?? (resolveProductCode(
      (await db.table('tenants').first('product_code'))?.product_code
    ).productCode === 'algadesk');

  if (!skipTax) {
    await initializeClientDefaultTax(trx, tenant, created.client_id);
  }

  return created as IClient;
}
