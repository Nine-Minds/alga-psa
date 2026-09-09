'use server';

import logger from '@alga-psa/core/logger';
import {
  auditLog,
  ACCOUNTING_EXPORT_INVOICE_CANCELLED,
  ACCOUNTING_EXPORT_INVOICE_NOT_FOUND,
  createTenantKnex,
  lockInvoiceForExternalSync,
  lockInvoicesForExternalSync,
  tenantDb,
  withTransaction,
  writeAccountingAudit,
} from '@alga-psa/db';
import type { AccountingAuditProvider } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { Knex } from 'knex';
import { hasPermission } from '@alga-psa/auth/rbac';
import type { IUserWithRoles } from '@alga-psa/types';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import {
  buildExternalMappingChangedPublishParams,
  type TenantExternalEntityMappingRow,
} from '../lib/externalMappingWorkflowEvents';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { getStoredQboCredentialsMap, QboClientService } from '../lib/qbo/qboClientService';
import { getStoredXeroConnections, XeroClientService } from '../lib/xero/xeroClientService';
import {
  readXeroServiceTargetKind,
  XERO_SALES_ACCOUNT_TYPES,
} from '../lib/xero/xeroServiceMappingTarget';

const MAPPING_CACHE_TTL_MS = 30_000;

type ExternalMappingActionError = ActionMessageError | ActionPermissionError;

class ExpectedExternalMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpectedExternalMappingError';
  }
}

type MappingCacheEntry = {
  value: ExternalEntityMapping[];
  expiresAt: number;
};

const mappingCache = new Map<string, MappingCacheEntry>();

export interface ExternalEntityMapping {
  id: string;
  tenant: string;
  integration_type: string;
  alga_entity_type: string;
  alga_entity_id: string;
  external_entity_id: string;
  external_realm_id?: string | null;
  sync_status?: 'synced' | 'pending' | 'error' | 'manual_link' | 'unlinked' | null;
  last_synced_at?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

interface GetMappingsParams {
  /** Required: the integration (e.g. 'quickbooks_online', 'xero') to read. */
  integrationType?: string;
  /** Required: the local entity type (e.g. 'service', 'tax_region') to read. */
  algaEntityType?: string;
  /**
   * Required key: the realm / Xero tenant scope. Pass null for mappings that
   * are not realm-bound (CSV-style integrations). Leaving it undefined is a
   * scope error — a read may never span realms.
   */
  externalRealmId?: string | null;
  algaEntityId?: string;
  externalEntityId?: string;
}

/** Columns returned to callers — the full ExternalEntityMapping DTO, named so
 * the read never widens silently with the table. */
const MAPPING_COLUMNS = [
  'id',
  'tenant',
  'integration_type',
  'alga_entity_type',
  'alga_entity_id',
  'external_entity_id',
  'external_realm_id',
  'sync_status',
  'last_synced_at',
  'metadata',
  'created_at',
  'updated_at'
] as const;

/**
 * Browser-facing create contract. Notably does NOT carry `sync_status`: the
 * persisted state is derived server-side (`manual_link`) so a caller cannot
 * mint a mapping that downstream consumers read as synced by an automated
 * workflow that never ran.
 */
export interface CreateMappingData {
  integration_type: string;
  alga_entity_type: string;
  alga_entity_id: string;
  external_entity_id: string;
  external_realm_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface UpdateMappingData {
  alga_entity_id?: string;
  external_entity_id?: string;
  metadata?: Record<string, unknown> | null;
}

/** Entity types exposed by the generic catalog-mapping UI. */
const CATALOG_ENTITY_TYPES = new Set([
  'service',
  'service_category',
  'tax_code',
  'payment_term',
  'client',
]);

/**
 * Entity types accepted by the mutation actions. Invoice mappings are also
 * written by onboarding/reconciliation callers through this shared action, so
 * they remain supported here under the invoice-row lock. The catalog UI does
 * not expose them, and payment/credit mappings remain rejected.
 */
const MUTABLE_MAPPING_ENTITY_TYPES = new Set([...CATALOG_ENTITY_TYPES, 'invoice']);

/** Realms are meaningful for these providers and must name a connected realm. */
const REALM_BASED_INTEGRATION_TYPES = new Set(['quickbooks_online', 'xero']);

/** CSV providers export to a file, not a connected realm. */
const CSV_INTEGRATION_TYPES = new Set(['quickbooks_csv', 'xero_csv']);

const KNOWN_INTEGRATION_TYPES = new Set([
  ...REALM_BASED_INTEGRATION_TYPES,
  ...CSV_INTEGRATION_TYPES,
]);

const PAYMENT_TERM_IDS = new Set(['net_30', 'net_15', 'due_on_receipt']);

function cloneMapping(mapping: ExternalEntityMapping): ExternalEntityMapping {
  return {
    ...mapping,
    metadata:
      mapping.metadata && typeof mapping.metadata === 'object'
        ? { ...mapping.metadata }
        : mapping.metadata ?? null,
  };
}

function buildCacheKey(tenantId: string, params: GetMappingsParams): string {
  const realmSegment =
    params.externalRealmId === undefined
      ? '~'
      : params.externalRealmId === null || params.externalRealmId === ''
        ? 'null'
        : params.externalRealmId;

  return [
    tenantId,
    params.integrationType ?? '*',
    params.algaEntityType ?? '*',
    realmSegment,
    params.algaEntityId ?? '*',
    params.externalEntityId ?? '*',
  ].join('|');
}

function getCachedMappings(cacheKey: string): ExternalEntityMapping[] | null {
  const entry = mappingCache.get(cacheKey);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    mappingCache.delete(cacheKey);
    return null;
  }
  return entry.value.map(cloneMapping);
}

function setCachedMappings(cacheKey: string, mappings: ExternalEntityMapping[]): void {
  mappingCache.set(cacheKey, {
    value: mappings.map(cloneMapping),
    expiresAt: Date.now() + MAPPING_CACHE_TTL_MS,
  });
}

function invalidateTenantMappingCache(tenantId: string): void {
  const prefix = `${tenantId}|`;
  for (const key of mappingCache.keys()) {
    if (key.startsWith(prefix)) {
      mappingCache.delete(key);
    }
  }
}

// ─── Server-side validation ──────────────────────────────────────────────────

/** Local entity must exist and belong to the current tenant. */
async function assertLocalEntityOwnership(
  trx: Knex.Transaction,
  tenant: string,
  entityType: string,
  entityId: string
): Promise<void> {
  const db = tenantDb(trx, tenant);

  switch (entityType) {
    case 'service': {
      const row = await db.table('service_catalog').where({ service_id: entityId }).first('service_id');
      if (!row) {
        throw new ExpectedExternalMappingError(
          `Cannot map service ${entityId}: it does not exist for this tenant.`
        );
      }
      return;
    }
    case 'service_category': {
      const row = await db.table('service_categories').where({ category_id: entityId }).first('category_id');
      if (!row) {
        throw new ExpectedExternalMappingError(
          `Cannot map service category ${entityId}: it does not exist for this tenant.`
        );
      }
      return;
    }
    case 'tax_code': {
      const row = await db.table('tax_regions').where({ region_code: entityId }).first('region_code');
      if (!row) {
        throw new ExpectedExternalMappingError(
          `Cannot map tax region ${entityId}: it does not exist for this tenant.`
        );
      }
      return;
    }
    case 'payment_term': {
      if (!PAYMENT_TERM_IDS.has(entityId)) {
        throw new ExpectedExternalMappingError(
          `Cannot map payment term ${entityId}: unknown payment term.`
        );
      }
      return;
    }
    case 'client': {
      const row = await db.table('clients').where({ client_id: entityId }).first('client_id');
      if (!row) {
        throw new ExpectedExternalMappingError(
          `Cannot map client ${entityId}: it does not exist for this tenant.`
        );
      }
      return;
    }
    case 'invoice': {
      const row = await db.table('invoices').where({ invoice_id: entityId }).first('invoice_id');
      if (!row) {
        throw new ExpectedExternalMappingError(
          `Cannot map invoice ${entityId}: it does not exist for this tenant.`
        );
      }
      return;
    }
    default:
      throw new ExpectedExternalMappingError(
        `Mapping entity type ${entityType} is not managed by the mapping screen.`
      );
  }
}

/**
 * The realm is server-validated rather than accepted verbatim: a realm-based
 * provider may only write against a connected realm, and CSV providers only
 * write realm-less rows.
 */
async function assertRealmAllowed(
  tenant: string,
  integrationType: string,
  realm: string | null | undefined
): Promise<void> {
  const normalizedRealm = realm && realm.trim() !== '' ? realm.trim() : null;

  if (CSV_INTEGRATION_TYPES.has(integrationType)) {
    if (normalizedRealm !== null) {
      throw new ExpectedExternalMappingError(
        `Provider ${integrationType} exports to a file, not a connected realm; a realm cannot be set.`
      );
    }
    return;
  }

  if (!REALM_BASED_INTEGRATION_TYPES.has(integrationType)) {
    throw new ExpectedExternalMappingError(
      `Unknown accounting provider ${integrationType}.`
    );
  }

  if (!normalizedRealm) {
    throw new ExpectedExternalMappingError(
      `Provider ${integrationType} requires a connected realm; none was provided.`
    );
  }

  if (integrationType === 'quickbooks_online') {
    const credentialsMap = await getStoredQboCredentialsMap(tenant);
    if (!(normalizedRealm in credentialsMap)) {
      throw new ExpectedExternalMappingError(
        `Realm ${normalizedRealm} is not a connected QuickBooks Online company for this tenant.`
      );
    }
    return;
  }

  if (integrationType === 'xero') {
    const connections = await getStoredXeroConnections(tenant);
    const isConnectionKey = Object.prototype.hasOwnProperty.call(connections, normalizedRealm);
    const isXeroTenant = Object.values(connections).some(
      (connection) => connection.xeroTenantId === normalizedRealm
    );
    if (!isConnectionKey && !isXeroTenant) {
      throw new ExpectedExternalMappingError(
        `Realm ${normalizedRealm} is not a connected Xero organisation for this tenant.`
      );
    }
    return;
  }
}

function assertCatalogEntityType(entityType: string): void {
  if (!CATALOG_ENTITY_TYPES.has(entityType)) {
    throw new ExpectedExternalMappingError(
      `Mapping entity type ${entityType} is managed by the accounting sync workflow and cannot be edited here.`
    );
  }
}

function assertMutableMappingEntityType(entityType: string): void {
  if (!MUTABLE_MAPPING_ENTITY_TYPES.has(entityType)) {
    throw new ExpectedExternalMappingError(
      `Mapping entity type ${entityType} is managed by the accounting sync workflow and cannot be edited here.`
    );
  }
}

function assertKnownIntegrationType(integrationType: string): void {
  if (!KNOWN_INTEGRATION_TYPES.has(integrationType)) {
    throw new ExpectedExternalMappingError(`Unknown accounting provider ${integrationType}.`);
  }
}

/** QBO entity type an external mapping of the given local entity type must name. */
const QBO_REMOTE_ENTITY_TYPE: Record<string, string> = {
  service: 'Item',
  service_category: 'Item',
  tax_code: 'TaxCode',
  payment_term: 'Term',
  client: 'Customer',
  invoice: 'Invoice',
};

/**
 * Xero record kind a catalog mapping of the given local entity type must name.
 * Only the entity types the live Xero mapping screen can produce are listed;
 * the stored external id is the human-facing code the exporter consumes
 * (`service` → Xero Item Code / `itemCode`, `tax_code` → Xero `TaxType`), which
 * is why validation matches on code rather than record id. Anything not listed
 * has no Xero counterpart on this surface and is rejected fail-closed.
 *
 * A `service` mapping resolves to two possible catalogs: the default is a Xero
 * Item, but a mapping whose metadata carries `xeroTargetKind: 'account'` names
 * a revenue account for account-code-only invoice lines instead. The kind is
 * explicit metadata, never inferred — an Item Code and an Account Code can
 * hold identical strings.
 */
type XeroCatalogKind = 'item' | 'taxRate' | 'account';
const XERO_CATALOG_KIND: Record<string, XeroCatalogKind> = {
  service: 'item',
  tax_code: 'taxRate',
};

/** A Xero catalog record in DELETED/ARCHIVED state is treated as non-existent. */
function isXeroRecordUsable(status: string | undefined): boolean {
  if (!status) return true;
  const normalized = status.toUpperCase();
  return normalized !== 'DELETED' && normalized !== 'ARCHIVED';
}

/**
 * Fail-closed remote check for a manually-linked QuickBooks mapping: the
 * external id must resolve to a live entity of the expected type in the
 * connected company, or the link is rejected.
 */
async function assertQboRemoteEntityExists(
  tenant: string,
  algaEntityType: string,
  externalEntityId: string,
  realm: string
): Promise<void> {
  const remoteType = QBO_REMOTE_ENTITY_TYPE[algaEntityType];
  if (!remoteType) {
    throw new ExpectedExternalMappingError(
      `Mapping entity type ${algaEntityType} is not managed by the mapping screen.`
    );
  }

  const qboClient = await QboClientService.create(tenant, realm);
  const entity = await qboClient.read<unknown>(remoteType, externalEntityId);
  if (!entity) {
    throw new ExpectedExternalMappingError(
      `QuickBooks ${remoteType} ${externalEntityId} does not exist in the connected company.`
    );
  }
}

/**
 * Fail-closed remote check for a Xero catalog mapping. Xero exposes no
 * GET-by-code endpoint for Items or Tax Rates, so existence is proven by
 * listing the connected organisation's catalog and matching the stored code
 * (or, for callers that stored the raw record id, the record id) against a
 * usable — not DELETED/ARCHIVED — record. An unknown, stale, or archived id is
 * rejected before the mapping is persisted.
 */
async function assertXeroRemoteEntityExists(
  tenant: string,
  algaEntityType: string,
  externalEntityId: string,
  realm: string,
  metadata?: Record<string, unknown> | null
): Promise<void> {
  let kind = XERO_CATALOG_KIND[algaEntityType];
  if (!kind) {
    throw new ExpectedExternalMappingError(
      `Mapping entity type ${algaEntityType} is not managed by the Xero mapping screen.`
    );
  }

  if (algaEntityType === 'service') {
    // The declared target kind decides which catalog proves existence. It is
    // read from explicit metadata only — a present-but-unrecognised value is
    // rejected rather than defaulted, so garbage can never save as item mode.
    const targetKind = readXeroServiceTargetKind(metadata);
    if (targetKind === null) {
      throw new ExpectedExternalMappingError(
        'Xero service mappings must declare xeroTargetKind as "item" or "account".'
      );
    }
    kind = targetKind === 'account' ? 'account' : 'item';
  }

  const wanted = externalEntityId.trim();
  const client = await XeroClientService.create(tenant, realm);

  if (kind === 'item') {
    const items = await client.listItems();
    const match = items.find(
      (item) => (item.code ?? '').trim() === wanted || (item.itemId ?? '').trim() === wanted
    );
    if (!match || !isXeroRecordUsable(match.status)) {
      throw new ExpectedExternalMappingError(
        `Xero item ${externalEntityId} does not exist in the connected organisation.`
      );
    }
    return;
  }

  if (kind === 'account') {
    // Account mode sends the stored value as the invoice line AccountCode, so
    // existence is proven by account Code only — an AccountID or display name
    // would export verbatim and be rejected by Xero on every line.
    if (!wanted) {
      throw new ExpectedExternalMappingError('Xero account mappings require an account code.');
    }
    const accounts = await client.listAccounts();
    const match = accounts.find((account) => (account.code ?? '').trim() === wanted);
    if (!match) {
      throw new ExpectedExternalMappingError(
        `Xero account code ${externalEntityId} does not exist in the connected organisation. ` +
          'Select the account by its code, not its display name.'
      );
    }
    if (!isXeroRecordUsable(match.status)) {
      throw new ExpectedExternalMappingError(
        `Xero account ${externalEntityId} is archived or deleted in the connected organisation.`
      );
    }
    const accountType = (match.type ?? '').toUpperCase();
    if (!XERO_SALES_ACCOUNT_TYPES.has(accountType)) {
      throw new ExpectedExternalMappingError(
        `Xero account ${externalEntityId} (type ${match.type ?? 'unknown'}) is not a revenue account ` +
          'Xero accepts on sales invoice lines.'
      );
    }
    return;
  }

  const rates = await client.listTaxRates();
  const match = rates.find(
    (rate) => (rate.taxType ?? '').trim() === wanted || (rate.taxRateId ?? '').trim() === wanted
  );
  if (!match || !isXeroRecordUsable(match.status)) {
    throw new ExpectedExternalMappingError(
      `Xero tax rate ${externalEntityId} does not exist in the connected organisation.`
    );
  }
}

/**
 * Fail-closed remote check for a manually-linked catalog mapping. The external
 * id must resolve to a live entity of the expected type in the connected realm,
 * or the link is rejected before it can become a confused-deputy pointer for a
 * later sync. Provider-specific because the remote catalogs and their id
 * semantics differ (QBO reads a record by id; Xero matches a code against the
 * connected organisation's catalog).
 */
async function assertRemoteEntityExists(
  tenant: string,
  integrationType: string,
  algaEntityType: string,
  externalEntityId: string,
  realm: string,
  metadata?: Record<string, unknown> | null
): Promise<void> {
  if (integrationType === 'quickbooks_online') {
    await assertQboRemoteEntityExists(tenant, algaEntityType, externalEntityId, realm);
    return;
  }
  if (integrationType === 'xero') {
    await assertXeroRemoteEntityExists(tenant, algaEntityType, externalEntityId, realm, metadata);
    return;
  }
}

// ─── Audit ───────────────────────────────────────────────────────────────────

interface MappingAuditParams {
  tenant: string;
  userId?: string;
  operation: 'CREATE' | 'UPDATE' | 'UNLINK';
  mapping: ExternalEntityMapping;
  before?: ExternalEntityMapping | null;
  details?: Record<string, unknown>;
}

/**
 * Audit event for mapping create / retarget / unlink. Routes through the
 * codebase's shared auditLog helper (packages/db/src/lib/auditLog.ts) and never
 * carries OAuth tokens or raw provider payloads.
 */
async function writeMappingAudit(
  trx: Knex.Transaction,
  { tenant, userId, operation, mapping, before, details }: MappingAuditParams
): Promise<void> {
  // The auditLog helper reads app.current_tenant to stamp the row; make it
  // resolvable for the duration of this transaction.
  await trx.raw("SELECT set_config('app.current_tenant', ?, true)", [tenant]);
  const realm = mapping.external_realm_id ?? null;
  const changedData: Record<string, unknown> = {
    integration_type: mapping.integration_type,
    alga_entity_type: mapping.alga_entity_type,
    alga_entity_id: mapping.alga_entity_id,
    external_entity_id: mapping.external_entity_id,
    external_realm_id: realm,
    sync_status: mapping.sync_status ?? null,
  };

  if (operation === 'UPDATE' && before) {
    if (before.alga_entity_id !== mapping.alga_entity_id) {
      changedData.alga_entity_id = {
        from: before.alga_entity_id,
        to: mapping.alga_entity_id,
      };
    }
    if (before.external_entity_id !== mapping.external_entity_id) {
      changedData.external_entity_id = {
        from: before.external_entity_id,
        to: mapping.external_entity_id,
      };
    }
  }

  const auditDetails: Record<string, unknown> = {
    actor_type: userId ? 'USER' : 'SYSTEM',
    provider: mapping.integration_type,
    entity_type: mapping.alga_entity_type,
    alga_entity_id: mapping.alga_entity_id,
    external_entity_id: mapping.external_entity_id,
    realm,
    ...(before ? { previous_external_entity_id: before.external_entity_id } : {}),
    ...(before ? { previous_alga_entity_id: before.alga_entity_id } : {}),
    ...(details ?? {}),
  };

  await auditLog(trx, {
    userId,
    operation,
    tableName: 'tenant_external_entity_mappings',
    recordId: mapping.id,
    changedData,
    details: auditDetails,
  });
}

// ─── Read ────────────────────────────────────────────────────────────────────

export const getExternalEntityMappings = withAuth(async (
  user,
  { tenant },
  params: GetMappingsParams
): Promise<ExternalEntityMapping[] | ExternalMappingActionError> => {
  const { knex } = await createTenantKnex();
  const allowed = await hasPermission(user, 'accounting_integrations', 'catalog_read', knex);
  if (!allowed) {
    return permissionError(
      'Permission denied: You do not have permission to view accounting mappings.',
      'msp/integrations:errors.mappings.viewPermission'
    );
  }

  // A mapping read is always scoped to one integration, one local entity type,
  // and one realm (null realm meaning the integration is not realm-bound).
  // Anything broader would let one screen enumerate every mapping the tenant
  // has, across integrations and companies.
  if (!params.integrationType || !params.algaEntityType || params.externalRealmId === undefined) {
    return actionError(
      'Mapping lookups require an integration, an entity type, and a realm scope.',
      'msp/integrations:errors.mappings.scopeRequired',
    );
  }

  // Validate the complete scope before consulting the cache or opening the
  // mapping query. A syntactically complete but unknown provider/entity pair,
  // or a realm owned by a different connection, is not a narrower lookup.
  // Treat it as invalid rather than allowing an empty/fallback query.
  try {
    assertKnownIntegrationType(params.integrationType);
    assertCatalogEntityType(params.algaEntityType);
    await assertRealmAllowed(tenant, params.integrationType, params.externalRealmId);
  } catch (error: unknown) {
    if (error instanceof ExpectedExternalMappingError) {
      return actionError(error.message, 'msp/integrations:errors.mappings.scopeRequired');
    }
    logger.error('Failed to validate external mapping read scope', {
      tenantId: tenant,
      integrationType: params.integrationType,
      algaEntityType: params.algaEntityType,
      externalRealmId: params.externalRealmId,
      error,
    });
    return actionError(
      'Unable to validate mapping scope. Please try again.',
      'msp/integrations:errors.mappings.loadFailed'
    );
  }

  const cacheKey = buildCacheKey(tenant, params);
  const cached = getCachedMappings(cacheKey);
  if (cached) {
    logger.debug('External mapping cache hit', { tenantId: tenant, params });
    return cached;
  }

  const { integrationType, algaEntityType, externalRealmId, algaEntityId, externalEntityId } = params;

  logger.debug('External mapping lookup requested', {
    tenantId: tenant,
    integrationType,
    algaEntityType,
    externalRealmId,
    algaEntityId,
    externalEntityId,
  });

  try {
    const mappings = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const query = tenantDb(trx, tenant).table<ExternalEntityMapping>(
        'tenant_external_entity_mappings'
      );

      query.whereNull('deleted_at');

      if (integrationType) {
        query.andWhere({ integration_type: integrationType });
      }
      if (algaEntityType) {
        query.andWhere({ alga_entity_type: algaEntityType });
      }
      if (algaEntityId) {
        query.andWhere({ alga_entity_id: algaEntityId });
      }
      if (externalEntityId) {
        query.andWhere({ external_entity_id: externalEntityId });
      }

      if (externalRealmId !== undefined) {
        if (externalRealmId === null || externalRealmId === '') {
          query.andWhere(function () {
            this.whereNull('external_realm_id').orWhere('external_realm_id', '');
          });
        } else {
          query.andWhere({ external_realm_id: externalRealmId });
        }
      }

      return await query.select(...MAPPING_COLUMNS).orderBy('updated_at', 'desc');
    });

    logger.debug('External mapping lookup completed', {
      tenantId: tenant,
      results: mappings.length,
    });

    setCachedMappings(cacheKey, mappings);
    return mappings.map(cloneMapping);
  } catch (error: unknown) {
    logger.error('Failed to retrieve external entity mappings', {
      tenantId: tenant,
      error,
    });
    return actionError(
      'Unable to load mapping data. Please try again.',
      'msp/integrations:errors.mappings.loadFailed'
    );
  }
});

// ─── Create ──────────────────────────────────────────────────────────────────

export const createExternalEntityMapping = withAuth(async (
  user,
  { tenant },
  mappingData: CreateMappingData
): Promise<ExternalEntityMapping | ExternalMappingActionError> => {
  const { knex } = await createTenantKnex();
  const allowed = await hasPermission(user, 'accounting_integrations', 'mappings_manage', knex);
  if (!allowed) {
    return permissionError(
      'Permission denied: You do not have permission to manage accounting mappings.',
      'msp/integrations:errors.mappings.managePermission'
    );
  }

  const {
    integration_type,
    alga_entity_type,
    alga_entity_id,
    external_entity_id,
    external_realm_id,
    metadata,
  } = mappingData;

  if (!external_entity_id || !alga_entity_id) {
    return actionError('Alga entity and external entity ids are required to create a mapping.');
  }

  logger.info('Creating external mapping record', {
    tenantId: tenant,
    integration_type,
    alga_entity_type,
    alga_entity_id,
    external_entity_id,
    external_realm_id,
  });

  try {
    // Provider, entity type, realm and sync state are validated server-side.
    // Invoice mappings additionally take the shared invoice-row lock below;
    // other money-moving entity types remain unsupported by this action.
    assertKnownIntegrationType(integration_type);
    assertMutableMappingEntityType(alga_entity_type);

    const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Keep invoice-typed writes serialized with invoice void. The persisted
      // mapping cannot land after a void commits because this guard re-checks
      // the invoice status while holding the same row lock as the void path.
      if (alga_entity_type === 'invoice') {
        await lockInvoiceForExternalSync(trx, tenant, alga_entity_id);
      }

      await assertRealmAllowed(tenant, integration_type, external_realm_id);
      await assertLocalEntityOwnership(trx, tenant, alga_entity_type, alga_entity_id);

      const normalizedRealm =
        external_realm_id && external_realm_id.trim() !== ''
          ? external_realm_id.trim()
          : null;

      if (normalizedRealm) {
        await assertRemoteEntityExists(
          tenant,
          integration_type,
          alga_entity_type,
          external_entity_id,
          normalizedRealm,
          metadata ?? null
        );
      }

      // Relink: an earlier unlink tombstones the row; creating the same mapping
      // again is the explicit relink choice, so restore the row in place.
      const tombstoned = await tenantDb(trx, tenant)
        .table<ExternalEntityMapping>('tenant_external_entity_mappings')
        .where({
          tenant,
          integration_type,
          alga_entity_type,
          alga_entity_id,
        })
        .whereNotNull('deleted_at')
        .first();

      if (tombstoned) {
        const patch: Partial<ExternalEntityMapping> = {
          external_entity_id,
          external_realm_id: normalizedRealm,
          // A manual link is always manual_link — even a hostile caller cannot
          // relink a tombstone into a fabricated 'synced' state.
          sync_status: 'manual_link',
          metadata: metadata ?? null,
          deleted_at: null,
          updated_at: new Date().toISOString(),
        };
        const [relinked] = await tenantDb(trx, tenant)
          .table<ExternalEntityMapping>('tenant_external_entity_mappings')
          .where({ id: tombstoned.id })
          .update(patch)
          .returning('*');
        if (!relinked) {
          throw new ExpectedExternalMappingError('Unable to relink mapping. Please try again.');
        }

        // Re-creating the same mapping after an unlink is the explicit relink
        // choice, so it is audited as a CREATE with the tombstone as the
        // before-state.
        await writeMappingAudit(trx, {
          tenant,
          userId: user?.user_id,
          operation: 'CREATE',
          mapping: relinked,
          before: tombstoned,
          details: { relinked: true },
        });

        return { newMapping: relinked, relinkedFrom: tombstoned };
      }

      const [newMapping] = await tenantDb(trx, tenant)
        .table<ExternalEntityMapping>('tenant_external_entity_mappings')
        .insert({
          id: trx.raw('gen_random_uuid()'),
          tenant,
          integration_type,
          alga_entity_type,
          alga_entity_id,
          external_entity_id,
          external_realm_id: normalizedRealm,
          // Sync state is server-derived; caller-supplied state is ignored.
          sync_status: 'manual_link',
          metadata: metadata ?? null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .returning('*');

      if (!newMapping) {
        throw new ExpectedExternalMappingError('Unable to save mapping. Please try again.');
      }

      await writeMappingAudit(trx, {
        tenant,
        userId: user?.user_id,
        operation: 'CREATE',
        mapping: newMapping,
      });

      return { newMapping, relinkedFrom: null };
    });

    const { newMapping, relinkedFrom } = result;

    logger.info('External mapping created', {
      tenantId: tenant,
      mappingId: newMapping.id,
      relinked: Boolean(relinkedFrom),
    });

    const actor = user?.user_id
      ? ({ actorType: 'USER', actorUserId: user.user_id } as const)
      : ({ actorType: 'SYSTEM' } as const);

    const changedAt = newMapping.updated_at ?? new Date().toISOString();
    const { payload, idempotencyKey } = buildExternalMappingChangedPublishParams({
      after: newMapping as unknown as TenantExternalEntityMappingRow,
      changedAt,
    });

    await publishWorkflowEvent({
      eventType: 'EXTERNAL_MAPPING_CHANGED',
      payload,
      ctx: { tenantId: tenant, occurredAt: changedAt, actor },
      idempotencyKey,
    });

    invalidateTenantMappingCache(tenant);

    await writeAccountingAudit(knex, tenant, 'accounting_mapping_created', {
      userId: user.user_id,
      provider: newMapping.integration_type as AccountingAuditProvider,
      recordId: newMapping.id,
      details: {
        alga_entity_type: newMapping.alga_entity_type,
        alga_entity_id: newMapping.alga_entity_id,
        external_entity_id: newMapping.external_entity_id,
        external_realm_id: newMapping.external_realm_id ?? null,
        relinked: Boolean(relinkedFrom),
      },
    }).catch((auditError) => {
      logger.warn('Failed to write mapping-created audit entry', { tenantId: tenant, error: auditError });
    });

    return cloneMapping(newMapping);
  } catch (error: any) {
    logger.error('Failed to create external entity mapping', {
      tenantId: tenant,
      integration_type,
      alga_entity_type,
      alga_entity_id,
      external_entity_id,
      external_realm_id,
      error,
    });

    if (error?.code === '23505') {
      return actionError(
        'A mapping already exists for this entity. Edit the existing mapping instead.',
        'msp/integrations:errors.mappings.duplicate'
      );
    }

    if (error?.code === ACCOUNTING_EXPORT_INVOICE_CANCELLED) {
      return actionError(
        'The invoice has been voided and cannot be mapped to the accounting integration.',
        'msp/integrations:errors.mappings.invoiceCancelled'
      );
    }
    if (error?.code === ACCOUNTING_EXPORT_INVOICE_NOT_FOUND) {
      return actionError(
        'The invoice no longer exists and cannot be mapped to the accounting integration.',
        'msp/integrations:errors.mappings.invoiceNotFound'
      );
    }

    if (error instanceof ExpectedExternalMappingError) {
      return actionError(error.message);
    }

    return actionError(
      'Unable to save mapping. Please try again.',
      'msp/integrations:errors.mappings.saveFailed'
    );
  }
});

// ─── Update ──────────────────────────────────────────────────────────────────

export const updateExternalEntityMapping = withAuth(async (
  user,
  { tenant },
  mappingId: string,
  updates: UpdateMappingData
): Promise<ExternalEntityMapping | ExternalMappingActionError> => {
  const { knex } = await createTenantKnex();
  const allowed = await hasPermission(user, 'accounting_integrations', 'mappings_manage', knex);
  if (!allowed) {
    return permissionError(
      'Permission denied: You do not have permission to manage accounting mappings.',
      'msp/integrations:errors.mappings.managePermission'
    );
  }

  if (!mappingId) {
    return actionError('Mapping ID is required for update.', 'msp/integrations:errors.mappings.idRequiredForUpdate');
  }

  // Pick only the declared editable fields. A direct server-action caller can
  // send extra JSON keys despite the TypeScript signature; those keys must
  // never reach the database or turn a catalog mapping into an invoice mapping.
  const updatePayload: Partial<ExternalEntityMapping> = {};
  if (updates.alga_entity_id !== undefined) updatePayload.alga_entity_id = updates.alga_entity_id;
  if (updates.external_entity_id !== undefined) updatePayload.external_entity_id = updates.external_entity_id;
  if (updates.metadata !== undefined) updatePayload.metadata = updates.metadata ?? null;

  if (Object.keys(updatePayload).length === 0) {
    return actionError('No update data provided.', 'msp/integrations:errors.mappings.noUpdateData');
  }

  logger.info('Updating external mapping', {
    tenantId: tenant,
    mappingId,
    hasMetadata: updates.metadata !== undefined,
    hasExternalEntityIdUpdate: updates.external_entity_id !== undefined,
  });

  try {
    const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const db = tenantDb(trx, tenant);
      const before = await db
        .table<ExternalEntityMapping>('tenant_external_entity_mappings')
        .where({ id: mappingId })
        .first();

      if (!before) {
        throw new ExpectedExternalMappingError('Mapping not found. Refresh mappings and try again.');
      }
      if (before.deleted_at) {
        throw new ExpectedExternalMappingError(
          'Mapping is unlinked. Create it again to relink the entity.'
        );
      }

      // Realm, provider and entity-type fields are not editable here. The
      // persisted entity type determines whether the invoice lock is required.
      assertMutableMappingEntityType(before.alga_entity_type);
      assertKnownIntegrationType(before.integration_type);

      // Invoice mapping writes share the same invoice-row lock as exports and
      // voids. The persisted type controls this decision; caller-supplied type
      // fields were discarded when updatePayload was built above. Lock both
      // invoice rows in stable order when retargeting the local invoice.
      if (before.alga_entity_type === 'invoice') {
        const targetInvoiceId = updatePayload.alga_entity_id ?? before.alga_entity_id;
        await lockInvoicesForExternalSync(trx, tenant, [before.alga_entity_id, targetInvoiceId]);
      }

      if (updatePayload.external_entity_id !== undefined && !updatePayload.external_entity_id) {
        throw new ExpectedExternalMappingError('External entity id is required.');
      }
      // Re-prove the remote target when the external id changes — and, for
      // Xero, when metadata changes too: metadata carries the explicit
      // item-vs-account target kind, and a kind flip re-points the same code
      // at a different catalog. The effective (id, metadata) pair after this
      // update is what must exist remotely.
      const externalIdChanged = updatePayload.external_entity_id !== undefined;
      const metadataChanged = updatePayload.metadata !== undefined;
      if (
        before.external_realm_id &&
        (externalIdChanged || (metadataChanged && before.integration_type === 'xero'))
      ) {
        await assertRemoteEntityExists(
          tenant,
          before.integration_type,
          before.alga_entity_type,
          updatePayload.external_entity_id ?? before.external_entity_id,
          before.external_realm_id,
          (metadataChanged ? updatePayload.metadata : before.metadata) as
            | Record<string, unknown>
            | null
        );
      }
      if (updatePayload.alga_entity_id !== undefined) {
        if (!updatePayload.alga_entity_id) {
          throw new ExpectedExternalMappingError('Alga entity id is required.');
        }
        await assertLocalEntityOwnership(trx, tenant, before.alga_entity_type, updatePayload.alga_entity_id);
      }
      updatePayload.updated_at = new Date().toISOString();

      const [after] = await db
        .table<ExternalEntityMapping>('tenant_external_entity_mappings')
        .where({ id: mappingId })
        .update(updatePayload)
        .returning('*');

      if (!after) {
        throw new ExpectedExternalMappingError('Unable to update mapping. Please try again.');
      }

      await writeMappingAudit(trx, {
        tenant,
        userId: user?.user_id,
        operation: 'UPDATE',
        mapping: after,
        before,
      });

      return { before, after };
    });

    const { before, after } = result;

    logger.info('External mapping updated', {
      tenantId: tenant,
      mappingId: after.id,
    });

    const actor = user?.user_id
      ? ({ actorType: 'USER', actorUserId: user.user_id } as const)
      : ({ actorType: 'SYSTEM' } as const);

    const changedAt = after.updated_at ?? new Date().toISOString();
    const { payload, idempotencyKey } = buildExternalMappingChangedPublishParams({
      before: before as unknown as TenantExternalEntityMappingRow,
      after: after as unknown as TenantExternalEntityMappingRow,
      changedAt,
    });

    await publishWorkflowEvent({
      eventType: 'EXTERNAL_MAPPING_CHANGED',
      payload,
      ctx: { tenantId: tenant, occurredAt: changedAt, actor },
      idempotencyKey,
    });

    invalidateTenantMappingCache(tenant);

    await writeAccountingAudit(knex, tenant, 'accounting_mapping_updated', {
      userId: user.user_id,
      provider: after.integration_type as AccountingAuditProvider,
      recordId: after.id,
      details: {
        before: {
          alga_entity_id: before?.alga_entity_id ?? null,
          external_entity_id: before?.external_entity_id ?? null,
          sync_status: before?.sync_status ?? null,
          external_realm_id: before?.external_realm_id ?? null,
        },
        after: {
          alga_entity_id: after.alga_entity_id,
          external_entity_id: after.external_entity_id,
          sync_status: after.sync_status ?? null,
          external_realm_id: after.external_realm_id ?? null,
        },
      },
    }).catch((auditError) => {
      logger.warn('Failed to write mapping-updated audit entry', { tenantId: tenant, error: auditError });
    });

    return cloneMapping(after);
  } catch (error: unknown) {
    logger.error('Failed to update external mapping', {
      tenantId: tenant,
      mappingId,
      error,
    });
    if (error instanceof ExpectedExternalMappingError) {
      return actionError(error.message);
    }
    const updateError = error as { code?: string } | null;
    if (updateError?.code === '23505') {
      return actionError(
        'A mapping already exists for this entity. Edit the existing mapping instead.',
        'msp/integrations:errors.mappings.duplicate'
      );
    }
    if (updateError?.code === ACCOUNTING_EXPORT_INVOICE_CANCELLED) {
      return actionError(
        'The invoice has been voided and cannot be mapped to the accounting integration.',
        'msp/integrations:errors.mappings.invoiceCancelled'
      );
    }
    if (updateError?.code === ACCOUNTING_EXPORT_INVOICE_NOT_FOUND) {
      return actionError(
        'The invoice no longer exists and cannot be mapped to the accounting integration.',
        'msp/integrations:errors.mappings.invoiceNotFound'
      );
    }
    return actionError(
      'Unable to update mapping. Please try again.',
      'msp/integrations:errors.mappings.updateFailed'
    );
  }
});

// ─── Unlink (tombstone) ──────────────────────────────────────────────────────

export const deleteExternalEntityMapping = withAuth(async (
  user,
  { tenant },
  mappingId: string
): Promise<{ success: true } | ExternalMappingActionError> => {
  const { knex } = await createTenantKnex();
  const allowed = await hasPermission(user, 'accounting_integrations', 'mappings_manage', knex);
  if (!allowed) {
    return permissionError(
      'Permission denied: You do not have permission to manage accounting mappings.',
      'msp/integrations:errors.mappings.managePermission'
    );
  }

  if (!mappingId) {
    return actionError('Mapping ID is required for deletion.', 'msp/integrations:errors.mappings.idRequiredForDelete');
  }

  logger.info('Unlinking external mapping', { tenantId: tenant, mappingId });

  try {
    const tombstoned = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const db = tenantDb(trx, tenant);
      const before = await db
        .table<ExternalEntityMapping>('tenant_external_entity_mappings')
        .where({ id: mappingId })
        .first();

      if (!before) {
        throw new ExpectedExternalMappingError('Mapping not found. Refresh mappings and try again.');
      }

      assertMutableMappingEntityType(before.alga_entity_type);

      if (before.deleted_at) {
        return { before, after: before };
      }

      const now = new Date().toISOString();
      const [after] = await db
        .table<ExternalEntityMapping>('tenant_external_entity_mappings')
        .where({ id: mappingId })
        .update({
          deleted_at: now,
          sync_status: 'unlinked',
          updated_at: now,
        })
        .returning('*');

      if (!after) {
        throw new ExpectedExternalMappingError('Unable to unlink mapping. Please try again.');
      }

      await writeMappingAudit(trx, {
        tenant,
        userId: user?.user_id,
        operation: 'UNLINK',
        mapping: after,
        before,
        details: { tombstoned: true },
      });

      return { before, after };
    });

    logger.info('External mapping unlinked', { tenantId: tenant, mappingId });

    const actor = user?.user_id
      ? ({ actorType: 'USER', actorUserId: user.user_id } as const)
      : ({ actorType: 'SYSTEM' } as const);

    const changedAt = tombstoned.after.updated_at ?? new Date().toISOString();
    const { payload, idempotencyKey } = buildExternalMappingChangedPublishParams({
      before: tombstoned.before as unknown as TenantExternalEntityMappingRow,
      after: null,
      changedAt,
    });

    await publishWorkflowEvent({
      eventType: 'EXTERNAL_MAPPING_CHANGED',
      payload,
      ctx: { tenantId: tenant, occurredAt: changedAt, actor },
      idempotencyKey,
    });

    invalidateTenantMappingCache(tenant);

    await writeAccountingAudit(knex, tenant, 'accounting_mapping_deleted', {
      userId: user.user_id,
      provider: tombstoned.before.integration_type as AccountingAuditProvider,
      recordId: tombstoned.before.id,
      details: {
        alga_entity_type: tombstoned.before.alga_entity_type,
        alga_entity_id: tombstoned.before.alga_entity_id,
        external_entity_id: tombstoned.before.external_entity_id,
        external_realm_id: tombstoned.before.external_realm_id ?? null,
      },
    }).catch((auditError) => {
      logger.warn('Failed to write mapping-deleted audit entry', { tenantId: tenant, error: auditError });
    });

    return { success: true };
  } catch (error: unknown) {
    logger.error('Failed to unlink external entity mapping', {
      tenantId: tenant,
      mappingId,
      error,
    });
    if (error instanceof ExpectedExternalMappingError) {
      return actionError(error.message);
    }
    return actionError(
      'Unable to delete mapping. Please try again.',
      'msp/integrations:errors.mappings.deleteFailed'
    );
  }
});
