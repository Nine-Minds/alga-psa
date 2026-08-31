'use server';

/* eslint-disable custom-rules/no-feature-to-feature-imports -- onboarding actions consult QBO customers and connection state */
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { lockInvoiceForExternalSync } from '../lib/invoiceExternalSyncLock';
import type { IUserWithRoles } from '@alga-psa/types';
import { getDefaultQboRealmId } from '@alga-psa/integrations/lib/qbo/qboClientService';
import { QboClientService } from '@alga-psa/integrations/lib/qbo/qboClientService';
import { getQboCustomers } from '@alga-psa/integrations/actions/qboActions';
import logger from '@alga-psa/core/logger';
import type { AccountingExternalChange } from '@alga-psa/types';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

import { SyncMappingLedger } from '../services/accountingSync/syncMappingLedger';
import {
  BILLING_PROFILE_ENTITY_TYPE,
  listSubCustomerProfiles,
  subCustomerDisplayName,
} from '@alga-psa/shared/billingClients/billingProfileExternalMapping';
import { getAccountingSyncSettings, updateAccountingSyncSettings } from '../services/accountingSync/accountingSyncSettings';
import { matchCustomers } from '../services/accountingSync/onboarding/nameMatcher';
import {
  matchHistoricalInvoices,
  type QboInvoiceRow,
} from '../services/accountingSync/onboarding/historicalInvoiceMatcher';
import { CompanyAccountingSyncService } from '../services/companySync/companySyncService';
import { KnexCompanyMappingRepository } from '../services/companySync/companyMappingRepository';
import { QuickBooksOnlineCompanyAdapter } from '../services/companySync/adapters/quickBooksCompanyAdapter';
import { applyExternalPaymentChange } from '../services/accountingSync/paymentApplier';
import { emptyCycleStats } from '../services/accountingSync/accountingSync.types';

const SYNC_ADAPTER_TYPE = 'quickbooks_online';

// ─── EE + permission guards ───────────────────────────────────────────────────

function isEnterpriseEdition(): boolean {
  return (
    (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
    (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise'
  );
}

function assertEnterpriseEdition(): void {
  if (!isEnterpriseEdition()) {
    throw new Error('QuickBooks Online onboarding is only available in Enterprise Edition.');
  }
}

async function checkCatalogReadAccess(user: IUserWithRoles): Promise<void> {
  const allowed = await hasPermission(user, 'accounting_integrations', 'catalog_read');
  if (!allowed) throw new Error('Forbidden');
}

async function checkMappingsManageAccess(user: IUserWithRoles): Promise<void> {
  const allowed = await hasPermission(user, 'accounting_integrations', 'mappings_manage');
  if (!allowed) throw new Error('Forbidden');
}

async function checkExportsExecuteAccess(user: IUserWithRoles): Promise<void> {
  const allowed = await hasPermission(user, 'accounting_integrations', 'exports_execute');
  if (!allowed) throw new Error('Forbidden');
}

async function requireDefaultRealm(tenantId: string): Promise<string> {
  const realm = await getDefaultQboRealmId(tenantId);
  if (!realm) throw new Error('No QuickBooks company is connected.');
  return realm;
}

// ─── Shared HistMatch type (contract with UI agent) ───────────────────────────

export type HistMatch = {
  invoiceId: string;
  invoiceNumber: string;
  invoiceTotal: number;
  externalId: string;
  externalDocNumber: string;
  externalTotal: number;
  externalSyncToken?: string;
  /** null when the invoice has no associated client */
  clientId: string | null;
};

// ─── 1. getCustomerMatchCandidates ───────────────────────────────────────────

export const getCustomerMatchCandidates = withAuth(async (
  user,
  { tenant }
): Promise<{
  rows: Array<{
    clientId: string;
    clientName: string;
    mappedExternalId: string | null;
    mappedExternalName: string | null;
    suggestion: { externalId: string; externalName: string; exact: boolean } | null;
    /**
     * Set on rows that address a separately-billing profile rather than the
     * client itself (F122). These map to QuickBooks *sub-customers* under the
     * client's own customer. Absent on every row for an unsegmented client, so
     * the screen looks exactly as it always has.
     */
    billingProfileId?: string;
    billingProfileName?: string;
  }>;
  error?: string;
}> => {
  assertEnterpriseEdition();
  await checkCatalogReadAccess(user);

  const { knex } = await createTenantKnex();
  const realm = await requireDefaultRealm(tenant);

  // All non-inactive clients for this tenant
  const db = tenantDb(knex, tenant);

  const clientRows: Array<{ client_id: string; client_name: string }> = await db.table('clients')
    .where(function () {
      this.whereNull('is_inactive').orWhere('is_inactive', false);
    })
    .select('client_id', 'client_name');

  // Existing 'client' mappings from the ledger (for this realm)
  const existingMappings: Array<{ alga_entity_id: string; external_entity_id: string; metadata: Record<string, any> | null }> =
    await db.table('tenant_external_entity_mappings')
      .where({
        tenant: tenant,
        integration_type: SYNC_ADAPTER_TYPE,
        alga_entity_type: 'client',
        external_realm_id: realm
      })
      .select('alga_entity_id', 'external_entity_id', 'metadata');

  const mappingByClientId = new Map<string, { externalId: string; displayName: string | null }>();
  for (const row of existingMappings) {
    mappingByClientId.set(row.alga_entity_id, {
      externalId: row.external_entity_id,
      displayName: (row.metadata?.display_name as string | undefined) ?? null
    });
  }

  // QBO customers (via integrations action — cached, realm-prioritised)
  const qboCustomersResult = await getQboCustomers({ realmId: realm });
  const qboCustomers = isActionMessageError(qboCustomersResult) || isActionPermissionError(qboCustomersResult)
    ? []
    : qboCustomersResult;
  const catalogError = isActionMessageError(qboCustomersResult) || isActionPermissionError(qboCustomersResult)
    ? getErrorMessage(qboCustomersResult)
    : undefined;

  // Build match candidates only for unmapped clients
  const unmappedClients = clientRows
    .filter((c) => !mappingByClientId.has(c.client_id))
    .map((c) => ({ id: c.client_id, name: c.client_name }));

  const { exact, suggestions } = matchCustomers(
    unmappedClients,
    qboCustomers.map((q) => ({ id: q.id, name: q.name, active: q.active }))
  );

  const exactByClientId = new Map(exact.map((e) => [e.clientId, e]));
  // Best suggestion per client (suggestions array is score-sorted desc)
  const bestSuggestionByClientId = new Map<string, (typeof suggestions)[0]>();
  for (const s of suggestions) {
    if (!bestSuggestionByClientId.has(s.clientId)) {
      bestSuggestionByClientId.set(s.clientId, s);
    }
  }

  const rows = clientRows.map((c) => {
    const mapped = mappingByClientId.get(c.client_id) ?? null;

    let suggestion: { externalId: string; externalName: string; exact: boolean } | null = null;
    if (!mapped) {
      const exactMatch = exactByClientId.get(c.client_id);
      if (exactMatch) {
        suggestion = { externalId: exactMatch.externalId, externalName: exactMatch.externalName, exact: true };
      } else {
        const fuzzy = bestSuggestionByClientId.get(c.client_id);
        if (fuzzy) {
          suggestion = { externalId: fuzzy.externalId, externalName: fuzzy.externalName, exact: false };
        }
      }
    }

    return {
      clientId: c.client_id,
      clientName: c.client_name,
      mappedExternalId: mapped?.externalId ?? null,
      mappedExternalName: mapped?.displayName ?? null,
      suggestion
    };
  });

  // Sub-customer rows for separately-billing profiles (F122). They are listed
  // beside their client rather than in a separate screen: the person linking
  // customers is reconciling one list against QuickBooks, and a site whose
  // mapping lives elsewhere is a site whose invoices fail to export with no
  // obvious cause.
  const profileMappings: Array<{ alga_entity_id: string; external_entity_id: string; metadata: Record<string, any> | null }> =
    await db.table('tenant_external_entity_mappings')
      .where({
        tenant: tenant,
        integration_type: SYNC_ADAPTER_TYPE,
        alga_entity_type: BILLING_PROFILE_ENTITY_TYPE,
        external_realm_id: realm
      })
      .select('alga_entity_id', 'external_entity_id', 'metadata');
  const mappingByProfileId = new Map(
    profileMappings.map((row) => [
      row.alga_entity_id,
      {
        externalId: row.external_entity_id,
        displayName: (row.metadata?.display_name as string | undefined) ?? null
      }
    ])
  );

  const profileRows: typeof rows = [];
  for (const client of clientRows) {
    const subCustomers = await listSubCustomerProfiles(knex, tenant, client.client_id);
    for (const profile of subCustomers) {
      const mapped = mappingByProfileId.get(profile.billing_profile_id) ?? null;
      profileRows.push({
        clientId: client.client_id,
        clientName: subCustomerDisplayName(client.client_name, profile.name),
        mappedExternalId: mapped?.externalId ?? null,
        mappedExternalName: mapped?.displayName ?? null,
        // No auto-suggestion: a sub-customer's name is derived from its parent,
        // so fuzzy-matching it against the flat customer list would propose
        // links a person has no way to sanity-check.
        suggestion: null,
        billingProfileId: profile.billing_profile_id,
        billingProfileName: profile.name
      } as (typeof rows)[number]);
    }
  }

  return { rows: [...rows, ...profileRows], ...(catalogError ? { error: catalogError } : {}) };
});

// ─── 2. linkClientToQboCustomer ───────────────────────────────────────────────

export const linkClientToQboCustomer = withAuth(async (
  user,
  { tenant },
  input: { clientId: string; externalId: string; externalName: string; billingProfileId?: string }
): Promise<{ linked: boolean; error?: string }> => {
  assertEnterpriseEdition();
  await checkMappingsManageAccess(user);

  const { knex } = await createTenantKnex();
  const realm = await requireDefaultRealm(tenant);

  // A profile link addresses the profile itself, so one QuickBooks customer can
  // be a client's parent and another can be its site's sub-customer without the
  // two colliding (F116).
  const algaEntityType = input.billingProfileId ? BILLING_PROFILE_ENTITY_TYPE : 'client';
  const algaEntityId = input.billingProfileId ?? input.clientId;

  // Reject if external id already linked to a different entity
  const existing = await tenantDb(knex, tenant).table('tenant_external_entity_mappings')
    .where({
      tenant: tenant,
      integration_type: SYNC_ADAPTER_TYPE,
      alga_entity_type: algaEntityType,
      external_entity_id: input.externalId,
      external_realm_id: realm
    })
    .first();

  if (existing && existing.alga_entity_id !== algaEntityId) {
    return {
      linked: false,
      error: `QBO customer ${input.externalId} is already linked to another client.`
    };
  }

  if (existing) {
    // Update existing row
    await tenantDb(knex, tenant).table('tenant_external_entity_mappings')
      .where({ id: existing.id })
      .update({
        alga_entity_id: algaEntityId,
        sync_status: 'synced',
        last_synced_at: knex.fn.now(),
        metadata: {
          ...(existing.metadata ?? {}),
          display_name: input.externalName,
          linked_via: 'onboarding'
        },
        updated_at: knex.fn.now()
      });
  } else {
    const ledger = new SyncMappingLedger(knex, tenant, SYNC_ADAPTER_TYPE);
    await ledger.insert({
      algaEntityType,
      algaEntityId,
      externalEntityId: input.externalId,
      targetRealm: realm,
      syncStatus: 'synced',
      metadata: { display_name: input.externalName, linked_via: 'onboarding' }
    });
  }

  return { linked: true };
});

// ─── 3. bulkLinkExactCustomerMatches ─────────────────────────────────────────

export const bulkLinkExactCustomerMatches = withAuth(async (
  user,
  _ctx
): Promise<{ linked: number }> => {
  assertEnterpriseEdition();
  await checkMappingsManageAccess(user);

  const { rows } = await getCustomerMatchCandidates();
  const exactRows = rows.filter((r) => r.suggestion?.exact && !r.mappedExternalId);

  let linked = 0;
  for (const row of exactRows) {
    if (!row.suggestion) continue;
    const result = await linkClientToQboCustomer({
      clientId: row.clientId,
      externalId: row.suggestion.externalId,
      externalName: row.suggestion.externalName
    });
    if (result.linked) linked++;
  }

  return { linked };
});

// ─── 4. createQboCustomerForClient ───────────────────────────────────────────

export const createQboCustomerForClient = withAuth(async (
  user,
  { tenant },
  clientId: string
): Promise<{ created: boolean; externalId?: string; error?: string }> => {
  assertEnterpriseEdition();
  await checkExportsExecuteAccess(user);

  try {
    const { knex } = await createTenantKnex();
    const realm = await requireDefaultRealm(tenant);

    const clientRow = await tenantDb(knex, tenant).table('clients')
      .where({ client_id: clientId })
      .select('client_name')
      .first();

    if (!clientRow) {
      return { created: false, error: 'Client not found.' };
    }

    const mappingRepo = new KnexCompanyMappingRepository(knex);
    const adapter = new QuickBooksOnlineCompanyAdapter();
    const companySyncService = CompanyAccountingSyncService.create({
      mappingRepository: mappingRepo,
      adapterFactory: (type) => type === 'quickbooks_online' ? adapter : null
    });

    const result = await companySyncService.ensureCompanyMapping({
      tenantId: tenant,
      adapterType: 'quickbooks_online',
      companyId: clientId,
      payload: { companyId: clientId, name: clientRow.client_name },
      targetRealm: realm
    });

    return { created: true, externalId: result.externalCompanyId };
  } catch (error) {
    logger.error('[qboOnboarding] createQboCustomerForClient failed', { tenant, clientId, error });
    return { created: false, error: 'Failed to create QBO customer. Please check the QuickBooks connection and try again.' };
  }
});

/**
 * Create the QuickBooks **sub-customer** for a separately-billing profile
 * (F118, F120).
 *
 * Distinct from `createQboCustomerForClient` because a sub-customer cannot
 * exist without its parent: the client's own customer is ensured first and its
 * id passed as the parent reference. Creating the profile as a top-level
 * customer instead would leave a QuickBooks file where a franchise site's
 * balance never rolls up to the franchise — which is the whole reason the
 * sub-customer relationship exists.
 */
export const createQboSubCustomerForProfile = withAuth(async (
  user,
  { tenant },
  input: { clientId: string; billingProfileId: string }
): Promise<{ created: boolean; externalId?: string; error?: string }> => {
  assertEnterpriseEdition();
  await checkExportsExecuteAccess(user);

  try {
    const { knex } = await createTenantKnex();
    const realm = await requireDefaultRealm(tenant);

    const clientRow = await tenantDb(knex, tenant).table('clients')
      .where({ client_id: input.clientId })
      .select('client_name')
      .first();
    if (!clientRow) {
      return { created: false, error: 'Client not found.' };
    }

    const subCustomers = await listSubCustomerProfiles(knex, tenant, input.clientId);
    const profile = subCustomers.find((row) => row.billing_profile_id === input.billingProfileId);
    if (!profile) {
      return {
        created: false,
        error: 'That billing profile does not bill separately, so it has no sub-customer.'
      };
    }

    const mappingRepo = new KnexCompanyMappingRepository(knex);
    const adapter = new QuickBooksOnlineCompanyAdapter();
    const companySyncService = CompanyAccountingSyncService.create({
      mappingRepository: mappingRepo,
      adapterFactory: (type) => type === 'quickbooks_online' ? adapter : null
    });

    const parent = await companySyncService.ensureCompanyMapping({
      tenantId: tenant,
      adapterType: 'quickbooks_online',
      companyId: input.clientId,
      payload: { companyId: input.clientId, name: clientRow.client_name },
      targetRealm: realm
    });

    const result = await companySyncService.ensureCompanyMapping({
      tenantId: tenant,
      adapterType: 'quickbooks_online',
      algaEntityType: BILLING_PROFILE_ENTITY_TYPE,
      companyId: input.billingProfileId,
      payload: {
        companyId: input.billingProfileId,
        name: subCustomerDisplayName(clientRow.client_name, profile.name),
        parentExternalId: parent.externalCompanyId
      },
      targetRealm: realm
    });

    return { created: true, externalId: result.externalCompanyId };
  } catch (error) {
    logger.error('[qboOnboarding] createQboSubCustomerForProfile failed', {
      tenant,
      clientId: input.clientId,
      billingProfileId: input.billingProfileId,
      error
    });
    return {
      created: false,
      error: 'Failed to create QBO sub-customer. Please check the QuickBooks connection and try again.'
    };
  }
});

// ─── 5. getHistoricalInvoiceMatches ──────────────────────────────────────────

async function fetchQboInvoicesPaged(
  qboClient: QboClientService,
  options?: { windowStart?: string }
): Promise<QboInvoiceRow[]> {
  const PAGE_SIZE = 1000;
  const results: QboInvoiceRow[] = [];
  let startPosition = 1;

  while (true) {
    const dateFilter = options?.windowStart
      ? ` WHERE TxnDate >= '${options.windowStart}'`
      : '';
    const query = `SELECT Id, DocNumber, TotalAmt, SyncToken, CustomerRef FROM Invoice${dateFilter} STARTPOSITION ${startPosition} MAXRESULTS ${PAGE_SIZE}`;

    const page = await qboClient.query<QboInvoiceRow>(query);
    results.push(...page);
    if (page.length < PAGE_SIZE) break;
    startPosition += PAGE_SIZE;
  }

  return results;
}

export const getHistoricalInvoiceMatches = withAuth(async (
  user,
  { tenant },
  input?: { windowStart?: string }
): Promise<{ confident: HistMatch[]; review: Array<HistMatch & { reason: string }> }> => {
  assertEnterpriseEdition();
  await checkCatalogReadAccess(user);

  const { knex } = await createTenantKnex();
  const realm = await requireDefaultRealm(tenant);

  // Fetch QBO invoices (paged)
  const qboClient = await QboClientService.create(tenant, realm);
  const qboInvoices = await fetchQboInvoicesPaged(qboClient, input);

  // Fetch invoice ids already mapped in QBO for this realm
  const db = tenantDb(knex, tenant);

  const mappedIds: string[] = await db.table('tenant_external_entity_mappings')
    .where({
      tenant: tenant,
      integration_type: SYNC_ADAPTER_TYPE,
      alga_entity_type: 'invoice',
      external_realm_id: realm
    })
    .pluck('alga_entity_id');

  // Finalized Alga invoices not already mapped: status 'sent' or 'paid'
  const candidateQuery = (status: string) => {
    const query = db.table('invoices')
      .where({ status })
      .select('invoice_id', 'invoice_number', 'total_amount', 'client_id');
    if (mappedIds.length > 0) {
      query.whereNotIn('invoice_id', mappedIds);
    }
    return query;
  };
  const [sentRows, paidRows]: [any[], any[]] = await Promise.all([
    candidateQuery('sent'),
    candidateQuery('paid')
  ]);
  // pg returns bigint columns as strings — coerce before numeric comparison
  const allAlgaInvoices = [...sentRows, ...paidRows].map((row) => ({
    ...row,
    total_amount: Number(row.total_amount)
  }));

  // Client→external customer mappings for consistency check
  const clientMappingRows: Array<{ external_entity_id: string; alga_entity_id: string }> =
    await db.table('tenant_external_entity_mappings')
      .where({
        tenant: tenant,
        integration_type: SYNC_ADAPTER_TYPE,
        alga_entity_type: 'client',
        external_realm_id: realm
      })
      .select('external_entity_id', 'alga_entity_id');

  const clientMappings = new Map<string, string>(
    clientMappingRows.map((r) => [r.external_entity_id, r.alga_entity_id])
  );

  return matchHistoricalInvoices(allAlgaInvoices, qboInvoices, clientMappings);
});

// ─── 6. bulkLinkHistoricalInvoices ───────────────────────────────────────────

export const bulkLinkHistoricalInvoices = withAuth(async (
  user,
  { tenant },
  matches: Array<{
    invoiceId: string;
    externalId: string;
    externalTotal: number;
    externalDocNumber: string;
    externalSyncToken?: string;
  }>
): Promise<{ linked: number; skipped: number }> => {
  assertEnterpriseEdition();
  await checkMappingsManageAccess(user);

  const { knex } = await createTenantKnex();
  const realm = await requireDefaultRealm(tenant);
  const ledger = new SyncMappingLedger(knex, tenant, SYNC_ADAPTER_TYPE);

  if (matches.length === 0) {
    return { linked: 0, skipped: 0 };
  }

  // Caller-supplied matches must be proven on both sides before persisting.
  // Local side: the invoice exists in this tenant and is not a prepayment
  // (prepayments never sync to QuickBooks).
  const invoiceRows: Array<{ invoice_id: string; is_prepayment: boolean | null }> =
    await tenantDb(knex, tenant).table('invoices')
      .whereIn('invoice_id', matches.map((m) => m.invoiceId))
      .select('invoice_id', 'is_prepayment');

  const localById = new Map<string, { is_prepayment: boolean | null }>(
    invoiceRows.map((row) => [row.invoice_id, row])
  );

  // Remote side: the QBO document exists in the connected company and is an
  // Invoice, not some other entity type wearing the same id.
  const qboClient = await QboClientService.create(tenant, realm);

  let linked = 0;
  let skipped = 0;
  for (const match of matches) {
    // Idempotent: skip if already mapped in this realm.
    const existing = await ledger.findByAlgaId('invoice', match.invoiceId, realm);
    if (existing) {
      skipped++;
      continue;
    }

    const local = localById.get(match.invoiceId);
    if (!local) {
      logger.warn('[bulkLinkHistoricalInvoices] Skipping match for unknown or foreign invoice', {
        tenant,
        invoiceId: match.invoiceId,
        externalId: match.externalId
      });
      skipped++;
      continue;
    }
    if (local.is_prepayment) {
      logger.warn('[bulkLinkHistoricalInvoices] Skipping match for prepayment invoice', {
        tenant,
        invoiceId: match.invoiceId
      });
      skipped++;
      continue;
    }

    const remoteInvoice = await qboClient.read<any>('Invoice', match.externalId).catch(() => null);
    if (!remoteInvoice) {
      logger.warn('[bulkLinkHistoricalInvoices] Skipping match — QuickBooks invoice does not exist', {
        tenant,
        invoiceId: match.invoiceId,
        externalId: match.externalId,
        realm
      });
      skipped++;
      continue;
    }

    // The mapping insert serializes against invoice void on the shared invoice
    // row lock (invoiceExternalSyncLock.ts). A voided invoice must never gain
    // a mapping after the void decided no remote void is needed — the remote
    // copy would outlive the cancelled local document with nothing enqueued to
    // void it. The remote SyncToken (proven to exist just above) is snapshotted
    // as a fallback so a later remote void carries a usable token.
    await withTransaction(knex, async (trx) => {
      await lockInvoiceForExternalSync(trx, tenant, match.invoiceId);
      const trxLedger = new SyncMappingLedger(trx, tenant, SYNC_ADAPTER_TYPE);
      await trxLedger.insert({
        algaEntityType: 'invoice',
        algaEntityId: match.invoiceId,
        externalEntityId: match.externalId,
        targetRealm: realm,
        syncStatus: 'synced',
        metadata: {
          sync_token: match.externalSyncToken ?? remoteInvoice.SyncToken ?? null,
          // Snapshot convention is QBO dollars (adapter stores response.TotalAmt);
          // the matcher carries cents internally.
          exported_total: match.externalTotal / 100,
          doc_number: match.externalDocNumber,
          linked_via: 'onboarding'
        }
      });
    });
    linked++;
  }

  return { linked, skipped };
});

// ─── 7. backfillPaymentsForLinkedInvoices ────────────────────────────────────

function makeNoopExceptions() {
  return {
    createOrUpdate: async (_params: unknown) => ({ created: false }),
    resolve: async (_type: string, _entityType: string, _entityId: string) => undefined
  };
}

export const backfillPaymentsForLinkedInvoices = withAuth(async (
  user,
  { tenant },
  invoiceIds: string[]
): Promise<{ processed: number; paymentsApplied: number; skippedPaid: number; errors: number }> => {
  assertEnterpriseEdition();
  await checkExportsExecuteAccess(user);

  const { knex } = await createTenantKnex();
  const realm = await requireDefaultRealm(tenant);

  let processed = 0;
  let paymentsApplied = 0;
  let skippedPaid = 0;
  let errors = 0;

  if (invoiceIds.length === 0) {
    return { processed, paymentsApplied, skippedPaid, errors };
  }

  // Fetch invoice status + client_id
  const invoiceRows: Array<{ invoice_id: string; status: string; client_id: string | null }> =
    await tenantDb(knex, tenant).table('invoices')
      .whereIn('invoice_id', invoiceIds)
      .select('invoice_id', 'status', 'client_id');

  // Fetch external invoice mappings
  const mappingRows: Array<{ alga_entity_id: string; external_entity_id: string }> =
    await tenantDb(knex, tenant).table('tenant_external_entity_mappings')
      .where({
        tenant: tenant,
        integration_type: SYNC_ADAPTER_TYPE,
        alga_entity_type: 'invoice',
        external_realm_id: realm
      })
      .whereIn('alga_entity_id', invoiceIds)
      .select('alga_entity_id', 'external_entity_id');

  const externalIdByInvoice = new Map<string, string>(
    mappingRows.map((r) => [r.alga_entity_id, r.external_entity_id])
  );

  // Client→external customer mappings
  const clientMappingRows: Array<{ alga_entity_id: string; external_entity_id: string }> =
    await tenantDb(knex, tenant).table('tenant_external_entity_mappings')
      .where({
        tenant: tenant,
        integration_type: SYNC_ADAPTER_TYPE,
        alga_entity_type: 'client',
        external_realm_id: realm
      })
      .select('alga_entity_id', 'external_entity_id');

  const externalCustomerByClientId = new Map<string, string>(
    clientMappingRows.map((r) => [r.alga_entity_id, r.external_entity_id])
  );

  // Group invoices by QBO customer id (to batch payment queries per customer)
  const invoicesByCustomer = new Map<string, Array<{ invoiceId: string; externalInvoiceId: string }>>();

  for (const inv of invoiceRows) {
    if (inv.status === 'paid') {
      skippedPaid++;
      continue;
    }

    const externalInvoiceId = externalIdByInvoice.get(inv.invoice_id);
    if (!externalInvoiceId) continue;

    const externalCustomerId = inv.client_id
      ? (externalCustomerByClientId.get(inv.client_id) ?? null)
      : null;

    if (!externalCustomerId) {
      logger.warn('[backfillPayments] No QBO customer mapping for client', {
        tenant,
        clientId: inv.client_id
      });
      continue;
    }

    const arr = invoicesByCustomer.get(externalCustomerId) ?? [];
    arr.push({ invoiceId: inv.invoice_id, externalInvoiceId });
    invoicesByCustomer.set(externalCustomerId, arr);
    processed++;
  }

  if (invoicesByCustomer.size === 0) {
    return { processed, paymentsApplied, skippedPaid, errors };
  }

  const qboClient = await QboClientService.create(tenant, realm);
  const ledger = new SyncMappingLedger(knex, tenant, SYNC_ADAPTER_TYPE);
  const exceptions = makeNoopExceptions();

  // Sequential per customer — polite rate limiting
  for (const [externalCustomerId, invoicePairs] of invoicesByCustomer.entries()) {
    try {
      const payments: any[] = [];
      const PAGE_SIZE = 1000;
      let startPosition = 1;

      while (true) {
        const page = await qboClient.query<any>(
          `SELECT * FROM Payment WHERE CustomerRef = '${externalCustomerId}' STARTPOSITION ${startPosition} MAXRESULTS ${PAGE_SIZE}`
        );
        payments.push(...page);
        if (page.length < PAGE_SIZE) break;
        startPosition += PAGE_SIZE;
      }

      const externalInvoiceIdSet = new Set(invoicePairs.map((p) => p.externalInvoiceId));

      for (const payment of payments) {
        const lines: any[] = Array.isArray(payment.Line) ? payment.Line : [];
        const relevantLines = lines.filter((line) => {
          const linkedTxns: any[] = Array.isArray(line?.LinkedTxn) ? line.LinkedTxn : [];
          return linkedTxns.some(
            (txn) => txn?.TxnType === 'Invoice' && externalInvoiceIdSet.has(String(txn?.TxnId))
          );
        });

        if (relevantLines.length === 0) continue;

        const change: AccountingExternalChange = {
          entityType: 'Payment',
          externalId: String(payment.Id),
          syncToken: payment.SyncToken ?? null,
          deleted: false,
          payload: { ...payment, Line: relevantLines }
        };

        const stats = emptyCycleStats();
        try {
          await applyExternalPaymentChange(
            {
              knex,
              tenantId: tenant,
              adapterType: SYNC_ADAPTER_TYPE,
              targetRealm: realm,
              ledger,
              exceptions: exceptions as any,
              stats
            },
            change
          );
          paymentsApplied += stats.paymentsApplied;
        } catch (paymentError) {
          logger.warn('[backfillPayments] Failed to apply payment', {
            tenant,
            externalPaymentId: payment.Id,
            error: paymentError instanceof Error ? paymentError.message : paymentError
          });
          errors++;
        }
      }
    } catch (customerError) {
      logger.warn('[backfillPayments] Failed to fetch payments for customer', {
        tenant,
        externalCustomerId,
        error: customerError instanceof Error ? customerError.message : customerError
      });
      errors++;
    }
  }

  return { processed, paymentsApplied, skippedPaid, errors };
});

// ─── 8. Wizard state ──────────────────────────────────────────────────────────

const ONBOARDING_KEY = 'onboarding';

export const getOnboardingWizardState = withAuth(async (
  user,
  { tenant }
): Promise<{ completedAt: string | null; lastRunAt: string | null; connected: boolean }> => {
  assertEnterpriseEdition();
  await checkCatalogReadAccess(user);

  const { knex } = await createTenantKnex();
  const realm = await getDefaultQboRealmId(tenant);
  const connected = Boolean(realm);

  if (!realm) {
    return { completedAt: null, lastRunAt: null, connected: false };
  }

  const row = await tenantDb(knex, tenant).table('tenant_settings').select('settings').first();
  const onboarding = (row?.settings?.accountingSync?.[ONBOARDING_KEY]?.[realm] ?? {}) as Record<string, string | null>;

  return {
    completedAt: onboarding.completedAt ?? null,
    lastRunAt: onboarding.lastRunAt ?? null,
    connected
  };
});

export const completeOnboardingWizard = withAuth(async (
  user,
  { tenant },
  input: { autoSyncStartDate: string; enableAutoSync: boolean }
): Promise<{ done: boolean }> => {
  assertEnterpriseEdition();
  await checkExportsExecuteAccess(user);

  const { knex } = await createTenantKnex();
  const realm = await requireDefaultRealm(tenant);
  const now = new Date().toISOString();

  // Write autoSyncStartDate + autoSyncEnabled via updateAccountingSyncSettings
  await updateAccountingSyncSettings(knex as any, tenant, {
    autoSyncStartDate: input.autoSyncStartDate,
    autoSyncEnabled: input.enableAutoSync
  });

  // Store wizard completion state keyed by realm
  const row = await tenantDb(knex, tenant).table('tenant_settings').select('settings').first();
  const existing = row?.settings ?? {};
  const accountingSync = existing.accountingSync ?? {};
  const onboardingMap = accountingSync[ONBOARDING_KEY] ?? {};

  const next = {
    ...existing,
    accountingSync: {
      ...accountingSync,
      [ONBOARDING_KEY]: {
        ...onboardingMap,
        [realm]: {
          ...(onboardingMap[realm] ?? {}),
          completedAt: now,
          lastRunAt: now
        }
      }
    }
  };

  if (row) {
    await tenantDb(knex, tenant).table('tenant_settings')
      .update({ settings: next, updated_at: knex.fn.now() });
  } else {
    await tenantDb(knex, tenant).table('tenant_settings').insert({ tenant: tenant, settings: next });
  }

  return { done: true };
});
