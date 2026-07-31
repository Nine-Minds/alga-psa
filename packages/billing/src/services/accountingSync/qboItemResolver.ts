/* eslint-disable custom-rules/no-feature-to-feature-imports -- QBO item import resolves QBO Items (integrations) against the billing catalog */
import type { QboItem } from '@alga-psa/integrations/lib/qbo/types';

/**
 * Pure matching/diffing for the QBO Products & Services import. No I/O:
 * the import service fetches QBO items, existing catalog rows, ledger
 * mappings, and the tax-code map, then asks this module what to do with
 * each item. The same resolutions later feed Item CDC one change at a time.
 */

/** Fields the import (and future Item CDC) is allowed to overwrite. */
export const QBO_AUTHORITATIVE_FIELDS = [
  'service_name',
  'default_rate',
  'sku',
  'description',
  'cost',
  'is_active'
] as const;

/** Fields owned by Alga — never touched by import or CDC once set. */
export const ALGA_AUTHORITATIVE_FIELDS = [
  'billing_method',
  'unit_of_measure',
  'custom_service_type_id',
  'category_id'
] as const;

export type QboAuthoritativeField = (typeof QBO_AUTHORITATIVE_FIELDS)[number];

export interface QboItemImportDefaults {
  /** Applied to every created row; existing rows keep theirs. */
  serviceTypeId: string;
  serviceBillingMethod: 'fixed' | 'hourly' | 'usage';
  productBillingMethod: 'fixed' | 'hourly' | 'usage';
  unitOfMeasure: string;
  /** Tenant home currency (from QBO Preferences), for cost_currency. */
  currencyCode: string;
}

/** The slice of a service_catalog row the resolver needs. */
export interface ExistingServiceRow {
  service_id: string;
  service_name: string;
  item_kind: 'service' | 'product' | null;
  sku: string | null;
  description: string | null;
  default_rate: number | string | null;
  cost: number | string | null;
  is_active: boolean | null;
}

/** The slice of a ledger row the resolver needs. */
export interface ExistingItemMappingRow {
  id: string;
  alga_entity_id: string;
  external_entity_id: string;
}

export type ItemResolutionFlag =
  | 'inactive'
  | 'unmapped_tax'
  | 'sku_conflict'
  | 'name_collision'
  | 'category_skipped';

export interface ItemFieldChange {
  field: QboAuthoritativeField;
  from: unknown;
  to: unknown;
}

export interface ResolvedItemFields {
  service_name: string;
  item_kind: 'service' | 'product';
  sku: string | null;
  description: string | null;
  /** Minor units (cents). */
  default_rate: number;
  /** Minor units (cents), null when QBO has no PurchaseCost. */
  cost: number | null;
  is_active: boolean;
  tax_rate_id: string | null;
}

export interface ItemResolution {
  qboItem: QboItem;
  action: 'create' | 'update' | 'link' | 'skip';
  /** Set for update/link, and for create when re-creating a mapped-but-deleted row. */
  matchedServiceId?: string;
  /** Existing ledger row id, when one already points at this QBO item. */
  existingMappingId?: string;
  /** Desired QBO-authoritative values (absent for skips). */
  fields?: ResolvedItemFields;
  /** Per-field diff backing an 'update' (QBO-authoritative fields only). */
  fieldChanges?: ItemFieldChange[];
  flags: ItemResolutionFlag[];
  reason?: string;
}

/** QBO's US pseudo tax codes — "NON" is an explicit "not taxable", not a gap. */
const NON_TAXABLE_TAX_CODES = new Set(['NON']);

function toCents(amount: number | undefined | null): number | null {
  if (amount === undefined || amount === null || Number.isNaN(Number(amount))) return null;
  return Math.round(Number(amount) * 100);
}

function normalizedName(name: string): string {
  return name.trim().toLowerCase();
}

function normalizedSku(sku: string | null | undefined): string | null {
  const trimmed = (sku ?? '').trim();
  return trimmed.length > 0 ? trimmed.toLowerCase() : null;
}

function itemKindFor(item: QboItem): 'service' | 'product' {
  return item.Type === 'Service' ? 'service' : 'product';
}

function desiredFields(
  item: QboItem,
  taxRateByQboTaxCodeId: Map<string, string>
): { fields: ResolvedItemFields; flags: ItemResolutionFlag[] } {
  const flags: ItemResolutionFlag[] = [];

  const taxCodeId = item.SalesTaxCodeRef?.value?.trim();
  let taxRateId: string | null = null;
  if (taxCodeId && !NON_TAXABLE_TAX_CODES.has(taxCodeId.toUpperCase())) {
    taxRateId = taxRateByQboTaxCodeId.get(taxCodeId) ?? null;
    if (!taxRateId) flags.push('unmapped_tax');
  }

  const isActive = item.Active ?? true;
  if (!isActive) flags.push('inactive');

  const sku = (item.Sku ?? '').trim();

  return {
    fields: {
      // QBO's Name is the leaf; FullyQualifiedName ("Parent:Child") goes to
      // mapping metadata only — no category tree is built.
      service_name: item.Name.trim(),
      item_kind: itemKindFor(item),
      sku: sku.length > 0 ? sku : null,
      description: item.Description?.trim() || null,
      default_rate: toCents(item.UnitPrice) ?? 0,
      cost: toCents(item.PurchaseCost),
      is_active: isActive,
      tax_rate_id: taxRateId
    },
    flags
  };
}

function diffAgainstExisting(
  fields: ResolvedItemFields,
  existing: ExistingServiceRow
): ItemFieldChange[] {
  const current: Record<QboAuthoritativeField, unknown> = {
    service_name: existing.service_name,
    default_rate: existing.default_rate === null ? 0 : Math.round(Number(existing.default_rate)),
    sku: existing.sku ?? null,
    description: existing.description ?? null,
    cost: existing.cost === null || existing.cost === undefined ? null : Math.round(Number(existing.cost)),
    is_active: existing.is_active ?? true
  };

  const changes: ItemFieldChange[] = [];
  for (const field of QBO_AUTHORITATIVE_FIELDS) {
    const to = fields[field];
    const from = current[field];
    if (from !== to) {
      changes.push({ field, from, to });
    }
  }
  return changes;
}

export function resolveQboItems(
  qboItems: QboItem[],
  existingServices: ExistingServiceRow[],
  existingMappings: ExistingItemMappingRow[],
  taxRateByQboTaxCodeId: Map<string, string>
): ItemResolution[] {
  const mappingByExternalId = new Map(existingMappings.map((m) => [m.external_entity_id, m]));
  const mappedServiceToExternal = new Map(existingMappings.map((m) => [m.alga_entity_id, m.external_entity_id]));
  const serviceById = new Map(existingServices.map((s) => [s.service_id, s]));
  const serviceByName = new Map(existingServices.map((s) => [normalizedName(s.service_name), s]));
  const productBySku = new Map(
    existingServices
      .filter((s) => s.item_kind === 'product' && normalizedSku(s.sku))
      .map((s) => [normalizedSku(s.sku) as string, s])
  );

  // SKUs/names claimed by earlier resolutions this run, so two QBO items
  // can't both create/update their way into the same unique SKU.
  const claimedSkus = new Set<string>();

  const resolutions: ItemResolution[] = [];

  for (const item of qboItems) {
    if (item.Type === 'Category') {
      resolutions.push({
        qboItem: item,
        action: 'skip',
        flags: ['category_skipped'],
        reason: 'QBO categories are not imported; item names are flattened to their leaf name.'
      });
      continue;
    }

    const { fields, flags } = desiredFields(item, taxRateByQboTaxCodeId);
    const skuKey = normalizedSku(fields.sku);

    // 1. Existing ledger mapping wins.
    const mapping = mappingByExternalId.get(item.Id);
    if (mapping) {
      const existing = serviceById.get(mapping.alga_entity_id);
      if (!existing) {
        // Mapped catalog row no longer exists — recreate and re-point the ledger.
        resolutions.push({
          qboItem: item, action: 'create', existingMappingId: mapping.id, fields, flags,
          reason: 'Previously mapped catalog item no longer exists; it will be recreated.'
        });
      } else {
        const fieldChanges = diffAgainstExisting(fields, existing);
        resolutions.push({
          qboItem: item,
          action: fieldChanges.length > 0 ? 'update' : 'link',
          matchedServiceId: existing.service_id,
          existingMappingId: mapping.id,
          fields,
          fieldChanges,
          flags
        });
      }
      if (skuKey) claimedSkus.add(skuKey);
      continue;
    }

    // 2. SKU match (products, exact).
    let matched: ExistingServiceRow | undefined;
    if (fields.item_kind === 'product' && skuKey) {
      const bySku = productBySku.get(skuKey);
      if (bySku) {
        const mappedTo = mappedServiceToExternal.get(bySku.service_id);
        if (mappedTo && mappedTo !== item.Id) {
          resolutions.push({
            qboItem: item, action: 'skip', flags: [...flags, 'sku_conflict'],
            reason: `SKU "${fields.sku}" belongs to "${bySku.service_name}", which is already mapped to a different QBO item. Resolve in the mapping manager.`
          });
          continue;
        }
        matched = bySku;
      }
      if (!matched && claimedSkus.has(skuKey)) {
        resolutions.push({
          qboItem: item, action: 'skip', flags: [...flags, 'sku_conflict'],
          reason: `SKU "${fields.sku}" is claimed by another QBO item in this import.`
        });
        continue;
      }
    }

    // 3. Exact name match.
    if (!matched) {
      const byName = serviceByName.get(normalizedName(fields.service_name));
      if (byName) {
        const mappedTo = mappedServiceToExternal.get(byName.service_id);
        if (mappedTo && mappedTo !== item.Id) {
          resolutions.push({
            qboItem: item, action: 'skip', flags: [...flags, 'name_collision'],
            reason: `"${byName.service_name}" is already mapped to a different QBO item. Resolve in the mapping manager.`
          });
          continue;
        }
        matched = byName;
      }
    }

    if (matched) {
      const fieldChanges = diffAgainstExisting(fields, matched);
      resolutions.push({
        qboItem: item,
        action: fieldChanges.length > 0 ? 'update' : 'link',
        matchedServiceId: matched.service_id,
        fields,
        fieldChanges,
        flags
      });
    } else {
      resolutions.push({ qboItem: item, action: 'create', fields, flags });
    }
    if (skuKey) claimedSkus.add(skuKey);
  }

  return resolutions;
}
