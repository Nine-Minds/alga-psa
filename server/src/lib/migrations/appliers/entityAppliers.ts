import type { Knex } from 'knex';
import { silentTicketCreation } from '@alga-psa/shared/lib/tickets/ticketLifecycleEvents';
import {
  AMP_CONTACT_CLIENT_NAME_EXTENSION_KEY,
  type AmpAssetRecord,
  type AmpContactRecord,
  type AmpEntityType,
  type AmpLocationRecord,
  type AmpOrganizationRecord,
  type AmpProductRecord,
  type AmpVendorProductRecord,
  AMP_ASSUMED_CURRENCY_EXTENSION_KEY,
  type AmpTicketCommentRecord,
  type AmpTicketRecord,
} from '@alga-psa/migration-spec';
import { registerAfterCommit, tenantDb } from '@alga-psa/db';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { buildClientCreatedPayload } from '@alga-psa/workflow-streams';
import { createLocation } from '@alga-psa/clients/models';
import { queueContactCreated } from '@alga-psa/clients/lib/contactEvents';
import { ClientModel } from '@alga-psa/shared/models/clientModel';
import { ContactModel } from '@alga-psa/shared/models/contactModel';
import { TicketModel } from '@alga-psa/shared/models/ticketModel';
import { createAssetInTransaction } from '@alga-psa/assets/actions';
// LEVERAGE: pattern asset-attribute-coercion — same coercion used by planner validation.
import { coerceAttributeValue } from '@alga-psa/assets/lib/assetTypeAttributes';
import {
  createProductCore,
  findProductBySkuCore,
  normalizeProductSku,
} from '@alga-psa/billing/lib/catalog/productCatalogCore';
import { resolveConfiguredTenantCurrency } from '@alga-psa/inventory/lib/tenantCurrency';
import { createOrMatchVendorCore } from '@alga-psa/inventory/lib/vendors';
import { upsertVendorProductCore } from '@alga-psa/inventory/lib/vendorProducts';
import { isSupportedCurrency } from '@alga-psa/core/formatters';
import type { ApplierContext } from './context';
import { SKU_MATCH_WARNING_PREFIX } from '../types';

export interface AppliedTarget {
  targetEntityType: string;
  targetEntityId: string;
  warnings?: string[];
  /**
   * The record matched an existing tenant row instead of creating one. The
   * identity mapping is still written (so references and re-runs resolve), but
   * the outcome is recorded as `skipped`, never `created`.
   */
  matchedExisting?: boolean;
}

/**
 * FR-B2: an imported asset keeps its source lifecycle state when the tenant
 * already has a status with that slug or label (case-insensitive, so "Retired"
 * lands on `retired`); anything else falls back to `active` rather than
 * creating statuses behind the operator's back.
 */
async function resolveImportedAssetStatus(
  trx: Knex.Transaction,
  tenant: string,
  sourceStatus?: string | null
): Promise<string> {
  const raw = String(sourceStatus ?? '').trim();
  if (!raw) return 'active';

  const slugCandidate = raw.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const match = await tenantDb(trx, tenant).table('asset_statuses')
    .where({ is_active: true })
    .where((builder: Knex.QueryBuilder) => {
      builder.whereRaw('lower(slug) = ?', [slugCandidate]).orWhereRaw('lower(label) = ?', [raw.toLowerCase()]);
    })
    .first<{ slug: string }>('slug');

  return match?.slug ?? 'active';
}

export interface EntityApplier {
  readonly entityType: AmpEntityType;
  readonly targetEntityType: string;
  apply(
    trx: Knex.Transaction,
    context: ApplierContext,
    payload: Record<string, unknown>,
    staged?: { customFieldValues: Record<string, unknown> }
  ): Promise<AppliedTarget>;
}

/** Leading calendar date of an AMP timestamp, or undefined if it has none. */
function sourceCreatedDate(value?: string | null): string | undefined {
  const match = typeof value === 'string' ? /^\d{4}-\d{2}-\d{2}/.exec(value.trim()) : null;
  return match ? match[0] : undefined;
}

/**
 * Organizations → clients through the transaction-scoped shared model. This
 * keeps the target mutation in the same transaction as the AMP identity and
 * outcome ledger rows.
 */
export class OrganizationMigrationApplier implements EntityApplier {
  readonly entityType = 'organizations' as const;
  readonly targetEntityType = 'client';

  async apply(
    trx: Knex.Transaction,
    context: ApplierContext,
    payload: Record<string, unknown>
  ): Promise<AppliedTarget> {
    const record = payload as unknown as AmpOrganizationRecord;
    const client = await ClientModel.createClient({
      client_name: record.name,
      url: record.website ?? undefined,
      phone_no: record.phone ?? undefined,
      // Tenure carried over from the source PSA: when the organization was
      // created there, not when this row lands here. An unreadable timestamp
      // falls back to created_at rather than failing the whole organization.
      client_since: sourceCreatedDate(record.created_at),
      properties: {
        ...(record.website ? { website: record.website } : {}),
        ...(record.phone ? { phone: record.phone } : {}),
      },
    }, context.tenant, trx);

    // A migrated organization is a real new client; publish client.created once the batch commits.
    const occurredAt = new Date().toISOString();
    registerAfterCommit(trx, () => publishWorkflowEvent({
      eventType: 'CLIENT_CREATED',
      payload: buildClientCreatedPayload({
        clientId: client.client_id,
        clientName: client.client_name,
        createdAt: occurredAt,
        status: client.is_inactive ? 'inactive' : 'active',
      }),
      ctx: { tenantId: context.tenant, occurredAt },
      idempotencyKey: `client_created:${client.client_id}`,
    }), `CLIENT_CREATED client=${client.client_id}`);

    return { targetEntityType: this.targetEntityType, targetEntityId: client.client_id };
  }
}

/** Locations → client_locations via the transaction-scoped model API. */
export class LocationMigrationApplier implements EntityApplier {
  readonly entityType = 'locations' as const;
  readonly targetEntityType = 'client_location';

  async apply(
    trx: Knex.Transaction,
    context: ApplierContext,
    payload: Record<string, unknown>
  ): Promise<AppliedTarget> {
    const record = payload as unknown as AmpLocationRecord;
    const clientId = await context.resolveReference(
      trx,
      'organizations',
      record.organization_package_record_id
    );
    if (!clientId) {
      throw new Error(
        `Owning organization ${record.organization_package_record_id} has not been applied; the location cannot be placed.`
      );
    }

    const countryCode = record.country_code?.trim().toUpperCase() ?? '';
    const countryName = countryNameForCode(countryCode);
    if (!record.address_line1?.trim() || !record.city?.trim() || !countryCode || !countryName) {
      // This should have been caught by preflight. Keep the domain invariant
      // explicit here too so a manually altered staging row cannot create an
      // invalid location mid-apply.
      throw new Error('Location requires address line 1, city, country code, and country name.');
    }
    const location = await createLocation(trx, context.tenant, clientId, {
      location_name: record.name,
      address_line1: record.address_line1,
      address_line2: record.address_line2 ?? undefined,
      city: record.city,
      state_province: record.region ?? undefined,
      postal_code: record.postal_code ?? undefined,
      country_code: countryCode,
      country_name: countryName,
      phone: record.phone ?? undefined,
      is_active: true,
    });

    return { targetEntityType: this.targetEntityType, targetEntityId: location.location_id };
  }
}

function countryNameForCode(countryCode: string): string | null {
  if (!/^[A-Z]{2}$/.test(countryCode)) return null;
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(countryCode) ?? null;
  } catch {
    return null;
  }
}

/** Contacts via ContactModel.createContact (transaction-scoped). */
export class ContactMigrationApplier implements EntityApplier {
  readonly entityType = 'contacts' as const;
  readonly targetEntityType = 'contact';

  async apply(
    trx: Knex.Transaction,
    context: ApplierContext,
    payload: Record<string, unknown>
  ): Promise<AppliedTarget> {
    const record = payload as unknown as AmpContactRecord;
    const warnings: string[] = [];
    const carriedClientName = readCarriedClientName(record);

    let clientId: string | null = null;
    if (record.organization_package_record_id) {
      clientId = await context.resolveReference(
        trx,
        'organizations',
        record.organization_package_record_id
      );
      if (!clientId) {
        throw new Error(
          `Owning organization ${record.organization_package_record_id} has not been applied; the contact cannot be placed.`
        );
      }
    } else if (carriedClientName) {
      // A single-sheet contacts import has no organizations table to resolve
      // against, so the carried name is matched against existing tenant clients
      // and the configured default is the fallback. An unmatched name is a
      // diagnostic, never a rejection.
      clientId = await context.resolveClientByName(trx, carriedClientName);
      if (!clientId) {
        const fallback = context.configuration.defaultClientId ?? null;
        if (fallback) {
          clientId = fallback;
          warnings.push(
            `Client "${carriedClientName}" was not matched to an existing client; the configured default client was used.`
          );
        } else {
          warnings.push(
            `Client "${carriedClientName}" was not matched to an existing client and no default client is configured; the contact was created without a client.`
          );
        }
      }
    } else {
      clientId = context.configuration.defaultClientId ?? null;
      if (!clientId) {
        throw new Error('Contact has no organization and no default client is configured.');
      }
    }

    const fullName = [record.first_name, record.last_name]
      .filter((part) => typeof part === 'string' && part.trim().length > 0)
      .join(' ')
      .trim();
    if (!fullName) {
      throw new Error('Contact has no first or last name; a full name is required.');
    }
    if (!record.email) {
      throw new Error('Contact has no email address; the contact model requires one.');
    }

    const contact = await ContactModel.createContact(
      {
        full_name: fullName,
        email: record.email,
        client_id: clientId ?? undefined,
        role: record.title ?? undefined,
        phone_numbers: record.phone
          ? [{ phone_number: record.phone, is_default: true }]
          : undefined,
      },
      context.tenant,
      trx
    );
    queueContactCreated(trx, context.tenant, contact as any);

    return {
      targetEntityType: this.targetEntityType,
      targetEntityId: contact.contact_name_id,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }
}

/** Read the carried client name stashed by the CSV converter, if any. */
function readCarriedClientName(record: AmpContactRecord): string | null {
  const extensionJson = record.extension_json;
  if (typeof extensionJson !== 'string' || extensionJson.length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(extensionJson) as Record<string, unknown>;
    const value = parsed[AMP_CONTACT_CLIENT_NAME_EXTENSION_KEY];
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  } catch {
    return null;
  }
}

/** Tickets via TicketModel.createTicket with preflight-resolved references. */
export class TicketMigrationApplier implements EntityApplier {
  readonly entityType = 'tickets' as const;
  readonly targetEntityType = 'ticket';

  async apply(
    trx: Knex.Transaction,
    context: ApplierContext,
    payload: Record<string, unknown>
  ): Promise<AppliedTarget> {
    const record = payload as unknown as AmpTicketRecord;
    const ticketConfig = context.configuration.tickets;
    if (!ticketConfig) {
      throw new Error('Ticket configuration is missing; preflight must pass before applying.');
    }

    let clientId: string | null = null;
    if (record.organization_package_record_id) {
      clientId = await context.resolveReference(
        trx,
        'organizations',
        record.organization_package_record_id
      );
    }
    if (!clientId) {
      clientId = ticketConfig.defaultRequesterClientId;
    }

    let contactId: string | undefined;
    if (record.requester_package_record_id) {
      const resolved = await context.resolveReference(
        trx,
        'contacts',
        record.requester_package_record_id
      );
      contactId = resolved ?? undefined;
    }

    let locationId: string | undefined;
    if (record.location_package_record_id) {
      const resolved = await context.resolveReference(
        trx,
        'locations',
        record.location_package_record_id
      );
      locationId = resolved ?? undefined;
    }

    const statusId = record.status_name ? ticketConfig.statusMapping[record.status_name] : undefined;
    if (record.status_name && !statusId) {
      throw new Error(`Source status "${record.status_name}" is not mapped.`);
    }
    const priorityId = record.priority_name
      ? ticketConfig.priorityMapping[record.priority_name]
      : undefined;
    if (record.priority_name && !priorityId) {
      throw new Error(`Source priority "${record.priority_name}" is not mapped.`);
    }

    const created = await TicketModel.createTicket(
      {
        title: record.title,
        description: record.description ?? undefined,
        board_id: ticketConfig.boardId,
        status_id: statusId,
        priority_id: priorityId,
        client_id: clientId,
        contact_id: contactId,
        location_id: locationId,
        assigned_to: ticketConfig.defaultAssigneeId ?? undefined,
        entered_by: context.actorUserId,
        source: 'migration',
        closed_at: record.closed_at ?? undefined,
        is_closed: Boolean(record.closed_at),
        attributes: record.category_name ? { source_category: record.category_name } : undefined,
      },
      context.tenant,
      trx,
      {},
      silentTicketCreation('data migration'),
      undefined,
      context.actorUserId
    );

    return { targetEntityType: this.targetEntityType, targetEntityId: created.ticket_id };
  }
}

/** Ticket comments via TicketModel.createComment. */
export class TicketCommentMigrationApplier implements EntityApplier {
  readonly entityType = 'ticket_comments' as const;
  readonly targetEntityType = 'comment';

  async apply(
    trx: Knex.Transaction,
    context: ApplierContext,
    payload: Record<string, unknown>
  ): Promise<AppliedTarget> {
    const record = payload as unknown as AmpTicketCommentRecord;

    const ticketId = await context.resolveReference(
      trx,
      'tickets',
      record.ticket_package_record_id
    );
    if (!ticketId) {
      throw new Error(
        `Owning ticket ${record.ticket_package_record_id} has not been applied; the comment cannot be placed.`
      );
    }

    let contactId: string | null = null;
    if (record.author_package_record_id) {
      contactId = await context.resolveReference(trx, 'contacts', record.author_package_record_id);
    }

    const created = await TicketModel.createComment(
      {
        ticket_id: ticketId,
        content: record.body,
        is_internal: record.is_internal === 1,
        author_type: contactId ? 'contact' : 'system',
        contact_id: contactId ?? undefined,
      },
      context.tenant,
      trx,
      undefined,
      undefined,
      context.actorUserId
    );

    return { targetEntityType: this.targetEntityType, targetEntityId: created.comment_id };
  }
}

/**
 * Assets use the transaction-scoped core; the legacy createAssetRecord owns a
 * transaction and must never be used by an AMP applier.
 */
export class AssetMigrationApplier implements EntityApplier {
  readonly entityType = 'assets' as const;
  readonly targetEntityType = 'asset';

  async apply(
    trx: Knex.Transaction,
    context: ApplierContext,
    payload: Record<string, unknown>,
    staged?: { customFieldValues: Record<string, unknown> }
  ): Promise<AppliedTarget> {
    const record = payload as unknown as AmpAssetRecord;
    const assetConfig = context.configuration.assets;
    if (!assetConfig) {
      throw new Error('Asset configuration is missing; preflight must pass before applying.');
    }
    if (!record.asset_type_name) {
      throw new Error('Asset has no asset_type_name; AMP assets must carry a source type to map.');
    }
    const assetTypeSlug = Object.prototype.hasOwnProperty.call(assetConfig.assetTypeMapping, record.asset_type_name)
      ? assetConfig.assetTypeMapping[record.asset_type_name]
      : undefined;
    if (!assetTypeSlug) {
      throw new Error(`Source asset type "${record.asset_type_name}" is not mapped.`);
    }

    let clientId: string | null = null;
    if (record.organization_package_record_id) {
      clientId = await context.resolveReference(
        trx,
        'organizations',
        record.organization_package_record_id
      );
      if (!clientId) {
        throw new Error(
          `Owning organization ${record.organization_package_record_id} has not been applied; the asset cannot be placed.`
        );
      }
    } else {
      clientId = context.configuration.defaultClientId ?? null;
      if (!clientId) {
        throw new Error('Asset has no organization and no default client is configured.');
      }
    }

    let locationId: string | null = null;
    if (record.location_package_record_id) {
      locationId = await context.resolveReference(
        trx,
        'locations',
        record.location_package_record_id
      );
    }

    const fields = await context.assetTypeFields(trx, assetTypeSlug);
    const customFieldMappings = assetConfig.customFieldMapping;
    const sourceMapping = customFieldMappings && Object.prototype.hasOwnProperty.call(customFieldMappings, assetTypeSlug)
      ? customFieldMappings[assetTypeSlug]
      : {};
    const customAttributes: Record<string, unknown> = {};
    for (const [sourceName, targetKey] of Object.entries(sourceMapping)) {
      const values = staged?.customFieldValues;
      const sourceValue = values && Object.prototype.hasOwnProperty.call(values, sourceName) ? values[sourceName] : undefined;
      if (sourceValue === undefined || sourceValue === null || (typeof sourceValue === 'string' && sourceValue.trim() === '')) continue;
      const field = fields.find((candidate) => candidate.key === targetKey);
      if (!field) throw new Error(`Mapped custom asset field "${targetKey}" no longer exists; preflight must pass before applying.`);
      const coerced = coerceAttributeValue(field, sourceValue);
      if (coerced.ok === false) {
        const valueDescription = typeof sourceValue === 'string' ? sourceValue : JSON.stringify(sourceValue) ?? '[value]';
        throw new Error(`Custom asset field "${sourceName}" value "${valueDescription}" ${coerced.reason}.`);
      }
      customAttributes[targetKey] = coerced.value;
    }

    // FR-C3: an imported assignee is recorded with source `import` by
    // createAssetInTransaction, which routes it through setAssetAssignee.
    //
    // The contact is checked against the asset's client here rather than
    // letting the helper throw: a source assignee who belongs to another
    // client would otherwise fail the whole asset import. The device comes in
    // unassigned, and the row says so.
    const assigneeWarnings: string[] = [];
    let assigneeContactId: string | null = null;
    if (record.assignee_external_identifier) {
      assigneeContactId = await context.resolveReference(
        trx,
        'contacts',
        record.assignee_external_identifier
      );

      if (assigneeContactId) {
        const contact = await tenantDb(trx, context.tenant).table('contacts')
          .where({ contact_name_id: assigneeContactId, client_id: clientId })
          .whereNot({ contact_kind: 'shared_mailbox' })
          .first('contact_name_id');
        if (!contact) {
          assigneeWarnings.push(
            `Assignee "${record.assignee_external_identifier}" is not a contact of this client; the asset was imported unassigned.`
          );
          assigneeContactId = null;
        }
      }
    }

    const assetInput = {
      asset_type: assetTypeSlug,
      client_id: clientId,
      asset_tag: record.serial_number ?? record.source_record_id,
      name: record.name,
      // FR-B2: keep the source lifecycle state when the tenant has a status
      // with that slug or label; otherwise fall back to `active`.
      status: await resolveImportedAssetStatus(trx, context.tenant, record.status),
      location_id: locationId,
      contact_name_id: assigneeContactId,
      serial_number: record.serial_number ?? undefined,
      purchase_date: record.purchase_date ?? undefined,
      // Manufacturer and model are first-class columns (FR-A4), not attributes.
      manufacturer: record.manufacturer ?? null,
      model: record.model ?? null,
      attributes: customAttributes,
    };

    const asset = await createAssetInTransaction(
      trx,
      context.tenant,
      context.actorUserId,
      assetInput,
      { requireCustomAttributes: false, assignmentSource: 'import' }
    );

    return {
      targetEntityType: this.targetEntityType,
      targetEntityId: asset.asset_id,
      ...(assigneeWarnings.length > 0 ? { warnings: assigneeWarnings } : {}),
    };
  }
}

function readAssumedCurrency(extensionJson: string | null | undefined): string | null {
  if (!extensionJson) return null;
  try {
    const parsed = JSON.parse(extensionJson) as Record<string, unknown>;
    const value = parsed?.[AMP_ASSUMED_CURRENCY_EXTENSION_KEY];
    return typeof value === 'string' && value ? value : null;
  } catch {
    return null;
  }
}

/**
 * The tenant billing currency, strictly: a tenant with none configured fails
 * the row rather than silently inheriting a hardcoded default.
 */
async function requireTenantCurrency(trx: Knex.Transaction, tenant: string): Promise<string> {
  const currency = await resolveConfiguredTenantCurrency(trx, tenant);
  if (!currency) {
    throw new Error(
      'Money amount has no currency and this tenant has no default billing currency configured; set one in billing settings or add a currency column.'
    );
  }
  return currency;
}

/**
 * Resolve the currency of a minor-unit amount. An explicit code must be a
 * supported ISO 4217 code. A blank code means the tenant currency at apply
 * time; if the producer parsed the amount against an assumed currency, that
 * assumption must still equal the tenant currency, because the minor-unit
 * scale (exponent) is currency-specific and the stored integer would be wrong.
 */
async function resolveMoneyCurrency(
  trx: Knex.Transaction,
  tenant: string,
  explicit: string | null | undefined,
  assumedCurrency: string | null,
  label: string
): Promise<string> {
  if (explicit) {
    if (!isSupportedCurrency(explicit)) throw new Error(`${label} currency "${explicit}" is not a supported ISO 4217 code.`);
    return explicit;
  }
  const tenantCurrency = await requireTenantCurrency(trx, tenant);
  if (assumedCurrency && assumedCurrency !== tenantCurrency) {
    throw new Error(
      `${label} was converted assuming ${assumedCurrency} but the tenant currency is now ${tenantCurrency}; re-import the sheet with a currency column.`
    );
  }
  return tenantCurrency;
}

/**
 * Products go through the transaction-scoped catalog core (never the REST
 * service or a withAuth action). The SKU is the natural duplicate key: a
 * product whose trimmed SKU already exists is MATCHED, left unchanged, and
 * mapped, so a distributor price list can be re-imported safely.
 */
export class ProductMigrationApplier implements EntityApplier {
  readonly entityType = 'products' as const;
  readonly targetEntityType = 'product';

  async apply(trx: Knex.Transaction, context: ApplierContext, payload: Record<string, unknown>): Promise<AppliedTarget> {
    const record = payload as unknown as AmpProductRecord;
    const name = record.name?.trim();
    if (!name) throw new Error('Product has no name.');

    const sku = normalizeProductSku(record.sku);
    if (sku) {
      const existing = await findProductBySkuCore(trx, context.tenant, sku);
      if (existing) {
        return {
          targetEntityType: this.targetEntityType,
          targetEntityId: existing.service_id,
          matchedExisting: true,
          warnings: [`${SKU_MATCH_WARNING_PREFIX}Matched existing product "${existing.service_name}" by SKU ${sku}; it was left unchanged.`],
        };
      }
    }

    const serviceTypeId = context.configuration.products?.serviceTypeId;
    if (!serviceTypeId) {
      throw new Error('Product service type is not configured; preflight must pass before applying.');
    }

    const assumed = readAssumedCurrency(record.extension_json);
    const hasPrice = record.price_minor !== null && record.price_minor !== undefined;
    const hasCost = record.cost_minor !== null && record.cost_minor !== undefined;
    const priceCurrency = hasPrice
      ? await resolveMoneyCurrency(trx, context.tenant, record.price_currency, assumed, 'Price')
      : null;
    // cost_currency is NOT NULL on the catalog row; with no cost it still needs a value.
    const costCurrency = hasCost
      ? await resolveMoneyCurrency(trx, context.tenant, record.cost_currency, assumed, 'Cost')
      : record.cost_currency || (await requireTenantCurrency(trx, context.tenant));

    const created = await createProductCore(trx, context.tenant, {
      service_name: name,
      custom_service_type_id: serviceTypeId,
      sku,
      description: record.description ?? null,
      // LEVERAGE: friction product-category-free-text — service_catalog.category_id points at a
      // service category taxonomy the import must not mutate, so the source category lands in the
      // free-text product_category column instead of a category row.
      product_category: record.category_name?.trim() || null,
      unit_of_measure: record.unit_of_measure?.trim() || undefined,
      is_active: record.is_active === 0 ? false : true,
      cost: hasCost ? record.cost_minor : null,
      cost_currency: costCurrency,
      ...(hasPrice ? { prices: [{ currency_code: priceCurrency, rate: record.price_minor }] } : {}),
    });

    return { targetEntityType: this.targetEntityType, targetEntityId: created.serviceId };
  }
}

/**
 * Vendor price-list offers. The vendor is created or matched by trimmed,
 * case-insensitive name here (there is deliberately no vendors AMP table), and
 * the offer upsert is keyed by (vendor, product) in the shared inventory core.
 */
export class VendorProductMigrationApplier implements EntityApplier {
  readonly entityType = 'vendor_products' as const;
  // LEVERAGE: friction vendor-offer-no-surrogate-id — vendor_products is keyed by (vendor, product) with no
  // uuid, but identity mappings and outcomes need a uuid target. The mapping targets the vendor; the
  // product side is recoverable through the products mapping.
  readonly targetEntityType = 'vendor';

  async apply(trx: Knex.Transaction, context: ApplierContext, payload: Record<string, unknown>): Promise<AppliedTarget> {
    const record = payload as unknown as AmpVendorProductRecord;

    let serviceId: string | null = null;
    if (record.product_package_record_id) {
      serviceId = await context.resolveReference(trx, 'products', record.product_package_record_id);
      if (!serviceId) {
        throw new Error(`Product ${record.product_package_record_id} has not been applied; the vendor offer cannot be placed.`);
      }
    } else if (normalizeProductSku(record.product_sku)) {
      const match = await findProductBySkuCore(trx, context.tenant, record.product_sku as string);
      if (!match) throw new Error(`No product with SKU ${normalizeProductSku(record.product_sku)} exists in this tenant.`);
      serviceId = match.service_id;
    } else {
      throw new Error('Vendor offer has neither a product reference nor a product SKU.');
    }

    const assumed = readAssumedCurrency(record.extension_json);
    const hasCost = record.unit_cost_minor !== null && record.unit_cost_minor !== undefined;
    const currency = await resolveMoneyCurrency(trx, context.tenant, record.cost_currency, hasCost ? assumed : null, 'Unit cost');

    const { vendor, created: vendorCreated } = await createOrMatchVendorCore(trx, context.tenant, record.vendor_name);
    const offer = await upsertVendorProductCore(trx, context.tenant, {
      vendor_id: vendor.vendor_id,
      service_id: serviceId,
      vendor_sku: record.vendor_sku ?? null,
      unit_cost: hasCost ? record.unit_cost_minor : null,
      cost_currency: currency,
      lead_time_days: record.lead_time_days ?? null,
      is_preferred: record.is_preferred === 1,
    });

    return {
      targetEntityType: this.targetEntityType,
      targetEntityId: offer.vendor_id,
      warnings: vendorCreated ? [`Created vendor "${vendor.vendor_name}".`] : undefined,
    };
  }
}

export const ENTITY_APPLIERS: Record<AmpEntityType, EntityApplier> = {
  organizations: new OrganizationMigrationApplier(),
  locations: new LocationMigrationApplier(),
  contacts: new ContactMigrationApplier(),
  tickets: new TicketMigrationApplier(),
  ticket_comments: new TicketCommentMigrationApplier(),
  assets: new AssetMigrationApplier(),
  products: new ProductMigrationApplier(),
  vendor_products: new VendorProductMigrationApplier(),
};
