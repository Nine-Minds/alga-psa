/**
 * Quote scope: the one layer that checks a *candidate* quote record's scope before it is written.
 *
 * Quote writes and reads used to judge only the stored row, so a write that moved a quote to another
 * client, pinned a line to another client's location or pointed it at another client's contact was
 * never looked at. Server actions, the REST service and the item model all route through here.
 */
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IQuote } from '@alga-psa/types';
import {
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
  RequestLocalAuthorizationCache,
  createAuthorizationKernel,
  type AuthorizationRecord,
  type AuthorizationSubject,
} from '@alga-psa/authorization/kernel';
import { resolveBundleNarrowingRulesForEvaluation } from '@alga-psa/authorization/bundles/service';

/** A quote write refers to a row outside the quote's own client (location, contact, opportunity). */
export class QuoteScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuoteScopeError';
  }
}

export function isQuoteScopeError(error: unknown): error is QuoteScopeError {
  return error instanceof Error && error.name === 'QuoteScopeError';
}

/** The authorization record of a (stored or candidate) quote. */
export function toQuoteAuthorizationRecord(quote: Partial<IQuote>): AuthorizationRecord {
  return {
    id: quote.quote_id ?? null,
    ownerUserId: quote.created_by ?? null,
    clientId: quote.client_id ?? null,
  };
}

type QuoteKernel = ReturnType<typeof createAuthorizationKernel>;

/** The kernel that decides quote visibility: bundle narrowing rules, no extra mutation guards. */
export function createQuoteScopeKernel(knex: Knex | Knex.Transaction): QuoteKernel {
  return createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider({ mutationGuards: [] }),
    bundleProvider: new BundleAuthorizationKernelProvider({
      resolveRules: async (input) => {
        try {
          return await resolveBundleNarrowingRulesForEvaluation(knex, input);
        } catch {
          return [];
        }
      },
    }),
    rbacEvaluator: async () => true,
  });
}

/**
 * Whether the subject may write the CANDIDATE quote — the record as it will be stored (the stored row merged
 * with the patch) — not only the row as it is stored today. Judged by the existing quote authorization kernel
 * with the same `billing` resource and rules that decide who may see the quote, so a subject fenced to client A
 * cannot move a quote to client B (or any client outside their scope).
 */
export async function authorizeQuoteWrite(
  knex: Knex | Knex.Transaction,
  input: {
    subject: AuthorizationSubject;
    candidate: Partial<IQuote>;
    authorizationKernel?: QuoteKernel;
    requestCache?: RequestLocalAuthorizationCache;
  }
) {
  const kernel = input.authorizationKernel ?? createQuoteScopeKernel(knex);
  return kernel.authorizeResource({
    subject: input.subject,
    resource: { type: 'billing', action: 'read', id: input.candidate.quote_id ?? null },
    record: toQuoteAuthorizationRecord(input.candidate),
    requestCache: input.requestCache ?? new RequestLocalAuthorizationCache(),
    knex,
  });
}

/**
 * Every non-null location must be one of the owning client's own locations (tenant-scoped). Shared by the
 * item model (so actions, REST, copy and update paths all pass through it) and the reparent check.
 */
export async function assertQuoteLocationsOwnedByClient(
  trx: Knex | Knex.Transaction,
  tenant: string,
  clientId: string | null | undefined,
  locationIds: ReadonlyArray<string | null | undefined>
): Promise<void> {
  const ids = [...new Set(
    locationIds.filter((locationId): locationId is string => typeof locationId === 'string' && locationId.length > 0)
  )];

  if (ids.length === 0) {
    return;
  }

  if (!clientId) {
    throw new QuoteScopeError('location_id requires the quote to be linked to a client');
  }

  const found = await tenantDb(trx, tenant).table('client_locations')
    .whereIn('location_id', ids)
    .andWhere('client_id', clientId)
    .pluck<string[]>('location_id');

  const missing = ids.filter((locationId) => !found.includes(locationId));
  if (missing.length > 0) {
    throw new QuoteScopeError(`location_id does not belong to this quote's client: ${missing.join(', ')}`);
  }
}

/**
 * The contact and opportunity a quote points at must belong to the quote's own client. A plain tenant-scoped
 * read, run for every caller — it does not depend on the caller being governed by a scope resolver.
 */
export async function assertQuoteReferencesOwnedByClient(
  trx: Knex | Knex.Transaction,
  tenant: string,
  clientId: string | null | undefined,
  references: { contact_id?: string | null; opportunity_id?: string | null }
): Promise<void> {
  const db = tenantDb(trx, tenant);
  const checks = [
    { field: 'contact_id', id: references.contact_id, table: 'contacts', idColumn: 'contact_name_id' },
    { field: 'opportunity_id', id: references.opportunity_id, table: 'opportunities', idColumn: 'opportunity_id' },
  ];

  for (const { field, id, table, idColumn } of checks) {
    if (!id) continue;
    if (!clientId) {
      throw new QuoteScopeError(`${field} requires the quote to be linked to a client`);
    }
    const row = await db.table(table).where(idColumn, id).first<{ client_id: string | null } | undefined>('client_id');
    if (!row || row.client_id !== clientId) {
      throw new QuoteScopeError(`${field} does not belong to this quote's client`);
    }
  }
}

/**
 * Reparenting a quote (client_id changes) re-validates everything that hangs off the old client: the contact,
 * the opportunity and every item location are checked against the DESTINATION client. Rejects; never repairs.
 * When the client is unchanged only a contact/opportunity the patch itself changes is checked.
 */
export async function assertQuotePatchReferencesInScope(
  trx: Knex | Knex.Transaction,
  tenant: string,
  existing: Pick<IQuote, 'quote_id' | 'client_id' | 'contact_id' | 'opportunity_id'>,
  patch: Partial<IQuote>
): Promise<{ reparented: boolean }> {
  const reparented = patch.client_id !== undefined && (patch.client_id ?? null) !== (existing.client_id ?? null);
  const clientId = patch.client_id !== undefined ? patch.client_id : existing.client_id;
  const contactId = patch.contact_id !== undefined ? patch.contact_id : existing.contact_id;
  const opportunityId = patch.opportunity_id !== undefined ? patch.opportunity_id : existing.opportunity_id;

  await assertQuoteReferencesOwnedByClient(trx, tenant, clientId, {
    contact_id: reparented || patch.contact_id !== undefined ? contactId : null,
    opportunity_id: reparented || patch.opportunity_id !== undefined ? opportunityId : null,
  });

  if (reparented) {
    const itemLocations = await tenantDb(trx, tenant).table('quote_items')
      .where({ quote_id: existing.quote_id })
      .whereNotNull('location_id')
      .pluck<string[]>('location_id');
    await assertQuoteLocationsOwnedByClient(trx, tenant, clientId, itemLocations);
  }

  return { reparented };
}
