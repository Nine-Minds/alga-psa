import type { Knex } from 'knex';
import type { IQuoteItem } from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';
import { recalculateQuoteFinancials } from '../services/quoteCalculationService';

function ensureIntegerField(value: unknown, fieldName: string): void {
  if (value !== undefined && value !== null && !Number.isInteger(Number(value))) {
    throw new Error(`${fieldName} must be an integer`);
  }
}

function normalizeQuoteItem(row: Record<string, any>): IQuoteItem {
  return {
    ...row,
    quantity: Number(row.quantity),
    unit_price: Number(row.unit_price),
    total_price: Number(row.total_price),
    tax_amount: Number(row.tax_amount),
    net_amount: Number(row.net_amount),
    discount_percentage: row.discount_percentage == null ? row.discount_percentage : Number(row.discount_percentage),
    display_order: Number(row.display_order),
    tax_rate: row.tax_rate == null ? row.tax_rate : Number(row.tax_rate),
    cost: row.cost == null ? null : Number(row.cost),
    cost_currency: row.cost_currency ?? null,
    catalog_description: row.catalog_description ?? null,
  } as IQuoteItem;
}

function quoteTable<Row extends object = Record<string, unknown>>(
  conn: Knex | Knex.Transaction,
  tenant: string,
  tableExpression: string
): Knex.QueryBuilder<Row, Row[]> {
  return tenantDb(conn, tenant).table<Row>(tableExpression);
}

type QuoteItemServiceLookupRow = {
  tenant?: string;
  service_id?: string;
  service_name: string;
  description?: string | null;
  sku?: string | null;
  default_rate?: number | string | null;
  unit_of_measure?: string | null;
  billing_method?: IQuoteItem['billing_method'];
  item_kind?: IQuoteItem['service_item_kind'];
  cost?: number | string | null;
  cost_currency?: string | null;
};

type QuoteCurrencyLookupRow = {
  tenant?: string;
  quote_id?: string;
  currency_code?: string | null;
};

type ServicePriceLookupRow = {
  tenant?: string;
  service_id?: string;
  currency_code?: string;
  rate?: number | string | null;
};

async function getNextDisplayOrder(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  quoteId: string
): Promise<number> {
  const result = await quoteTable(knexOrTrx, tenant, 'quote_items')
    .where({ quote_id: quoteId })
    .max<{ max?: number | string }>('display_order as max')
    .first();

  return Number(result?.max ?? -1) + 1;
}

/** Empty or whitespace-only catalog text snapshots as `null`. */
function normalizeCatalogDescription(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Internal-only channel for the catalog-description snapshot. Only trusted,
 * server-internal copy flows (duplicate / save-as-template /
 * create-from-template) supply this so the stored snapshot survives the copy
 * verbatim — including `null` for lines whose catalog entry was deleted.
 * Caller-facing payloads never carry a snapshot: fresh catalog-backed lines
 * capture it from the tenant-scoped catalog row instead, and custom/discount
 * lines store `null`.
 */
export type QuoteItemCreateOptions = {
  catalogDescriptionSnapshot?: string | null;
};

/** Payload accepted by `QuoteItem.create`. `catalog_description` is excluded:
 *  the snapshot is never part of the caller-facing item shape. */
type CreateQuoteItemPayload = Omit<
  IQuoteItem,
  | 'quote_item_id'
  | 'tenant'
  | 'total_price'
  | 'net_amount'
  | 'tax_amount'
  | 'display_order'
  | 'catalog_description'
  | 'created_at'
  | 'updated_at'
> & Partial<Pick<IQuoteItem, 'display_order'>>;

const QuoteItem = {
  async listByQuoteId(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    quoteId: string
  ): Promise<IQuoteItem[]> {
    if (!tenant) {
      throw new Error('Tenant context is required for listing quote items');
    }

    const items = await quoteTable(knexOrTrx, tenant, 'quote_items')
      .where({ quote_id: quoteId })
      .orderBy('display_order', 'asc')
      .orderBy('created_at', 'asc');

    return items.map((item) => normalizeQuoteItem(item));
  },

  async create(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    item: CreateQuoteItemPayload,
    options: QuoteItemCreateOptions = {}
  ): Promise<IQuoteItem> {
    if (!tenant) {
      throw new Error('Tenant context is required for creating quote item');
    }

    ensureIntegerField(item.quantity, 'Quantity');
    ensureIntegerField(item.unit_price, 'Unit price');

    // The catalog-description snapshot is never read from the item payload.
    // It is not part of any caller-facing input shape, and a value smuggled
    // past schema validation (defense in depth) is dropped before insert so it
    // can never persist. Verbatim snapshots arrive only through the internal
    // `options.catalogDescriptionSnapshot` channel.
    const itemPayload: CreateQuoteItemPayload = { ...item };
    delete (itemPayload as Partial<IQuoteItem>).catalog_description;
    let resolvedItem: Partial<IQuoteItem> = { ...itemPayload };

    const snapshotFromOptions =
      options.catalogDescriptionSnapshot !== undefined
        ? normalizeCatalogDescription(options.catalogDescriptionSnapshot)
        : undefined;

    if (item.service_id) {
      const service = await quoteTable<QuoteItemServiceLookupRow>(knexOrTrx, tenant, 'service_catalog')
        .where({ service_id: item.service_id })
        .select(
          'service_name',
          'description',
          'sku',
          'default_rate',
          'unit_of_measure',
          'billing_method',
          'item_kind',
          'cost',
          'cost_currency'
        )
        .first();

      if (!service) {
        throw new Error(`Service ${item.service_id} not found in tenant ${tenant}`);
      }

      // Look up currency-specific price from service_prices when unit_price not explicitly provided
      let resolvedUnitPrice = resolvedItem.unit_price;
      if (resolvedUnitPrice == null) {
        const quote = await quoteTable<QuoteCurrencyLookupRow>(knexOrTrx, tenant, 'quotes')
          .where({ quote_id: item.quote_id })
          .select('currency_code')
          .first();
        const currencyCode = quote?.currency_code ?? 'USD';

        const priceRow = await quoteTable<ServicePriceLookupRow>(knexOrTrx, tenant, 'service_prices')
          .where({ service_id: item.service_id, currency_code: currencyCode })
          .select('rate')
          .first();

        resolvedUnitPrice = priceRow ? Number(priceRow.rate) : Number(service.default_rate ?? 0);
      }

      const resolvedItemKind = resolvedItem.service_item_kind ?? service.item_kind ?? 'service';

      // Catalog-description snapshot policy: a trusted server-internal copy
      // flow that supplies `options.catalogDescriptionSnapshot` keeps that
      // value verbatim (including null). Otherwise — a freshly selected
      // catalog-backed line — the authoritative, tenant-scoped catalog text is
      // captured here. Persistence never trusts picker or caller data.
      const resolvedCatalogDescription =
        snapshotFromOptions !== undefined
          ? snapshotFromOptions
          : normalizeCatalogDescription(service.description);

      resolvedItem = {
        ...resolvedItem,
        service_name: resolvedItem.service_name ?? service.service_name,
        service_sku: resolvedItem.service_sku ?? service.sku ?? null,
        unit_price: resolvedUnitPrice,
        unit_of_measure: resolvedItem.unit_of_measure ?? service.unit_of_measure ?? null,
        billing_method: resolvedItem.billing_method ?? service.billing_method ?? null,
        service_item_kind: resolvedItemKind,
        description: resolvedItem.description || service.service_name,
        catalog_description: resolvedCatalogDescription,
        // Snapshot cost for product items so markup can be calculated on the quote
        cost: resolvedItemKind === 'product' && service.cost != null ? Number(service.cost) : (resolvedItem as any).cost ?? null,
        cost_currency: resolvedItemKind === 'product' && service.cost_currency ? service.cost_currency : (resolvedItem as any).cost_currency ?? null,
      };
    } else {
      // Custom and discount lines have no catalog identity, so there is no
      // snapshot to capture. When a trusted copy flow passes a verbatim
      // snapshot (a copy of a line whose catalog entry was deleted and whose
      // FK was SET NULL), keep it so duplication/template flows preserve
      // historical output; otherwise store null.
      resolvedItem = {
        ...resolvedItem,
        catalog_description: snapshotFromOptions !== undefined ? snapshotFromOptions : null,
      };
    }

    const quantity = Number(resolvedItem.quantity ?? 1);
    const unitPrice = Number(resolvedItem.unit_price ?? 0);
    const totalPrice = quantity * unitPrice;
    const displayOrder = resolvedItem.display_order ?? await getNextDisplayOrder(knexOrTrx, tenant, item.quote_id);

    const [createdItem] = await quoteTable<IQuoteItem>(knexOrTrx, tenant, 'quote_items')
      .insert({
        tenant,
        ...resolvedItem,
        quantity,
        unit_price: unitPrice,
        total_price: totalPrice,
        net_amount: totalPrice,
        tax_amount: 0,
        display_order: displayOrder,
      })
      .returning('*');

    await recalculateQuoteFinancials(knexOrTrx, tenant, item.quote_id);

    const refreshedItem = await quoteTable<IQuoteItem>(knexOrTrx, tenant, 'quote_items')
      .where({ quote_item_id: createdItem.quote_item_id })
      .first();

    return normalizeQuoteItem(refreshedItem ?? createdItem);
  },

  async update(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    quoteItemId: string,
    updateData: Omit<Partial<IQuoteItem>, 'catalog_description'>
  ): Promise<IQuoteItem> {
    if (!tenant) {
      throw new Error('Tenant context is required for updating quote item');
    }

    const existingItem = await quoteTable<IQuoteItem>(knexOrTrx, tenant, 'quote_items')
      .where({ quote_item_id: quoteItemId })
      .first();

    if (!existingItem) {
      throw new Error(`Quote item ${quoteItemId} not found in tenant ${tenant}`);
    }

    const quantity = Number(updateData.quantity ?? existingItem.quantity);
    const unitPrice = Number(updateData.unit_price ?? existingItem.unit_price);

    ensureIntegerField(quantity, 'Quantity');
    ensureIntegerField(unitPrice, 'Unit price');

    const totalPrice = Number(quantity) * Number(unitPrice);

    // `catalog_description` is not caller-writable. Drop it from the update
    // payload unconditionally — even if a value smuggles past schema
    // validation — so ordinary edits can never overwrite the stored snapshot.
    let resolvedUpdate: Partial<IQuoteItem> = { ...updateData };
    delete (resolvedUpdate as Partial<IQuoteItem> & { catalog_description?: string | null }).catalog_description;

    // Catalog selection change: recapture name/SKU/kind/catalog description
    // together from the fresh, tenant-scoped catalog row. Ordinary edits
    // (quantity, price, line description) leave service_id unchanged and never
    // touch the snapshot. No caller may override the recaptured value.
    const serviceSelectionChanged =
      updateData.service_id !== undefined && updateData.service_id !== existingItem.service_id;

    if (serviceSelectionChanged) {
      if (updateData.service_id) {
        const service = await quoteTable<QuoteItemServiceLookupRow>(knexOrTrx, tenant, 'service_catalog')
          .where({ service_id: updateData.service_id })
          .select('service_name', 'description', 'sku', 'unit_of_measure', 'billing_method', 'item_kind')
          .first();

        if (!service) {
          throw new Error(`Service ${updateData.service_id} not found in tenant ${tenant}`);
        }

        resolvedUpdate = {
          ...resolvedUpdate,
          service_name: service.service_name,
          service_sku: service.sku ?? null,
          unit_of_measure: service.unit_of_measure ?? null,
          billing_method: service.billing_method ?? null,
          service_item_kind: service.item_kind ?? 'service',
          catalog_description: normalizeCatalogDescription(service.description),
        };
      } else {
        resolvedUpdate = {
          ...resolvedUpdate,
          service_name: null,
          service_sku: null,
          service_item_kind: null,
          catalog_description: null,
        };
      }
    }

    const [updatedItem] = await quoteTable<IQuoteItem>(knexOrTrx, tenant, 'quote_items')
      .where({ quote_item_id: quoteItemId })
      .update({
        ...resolvedUpdate,
        quantity,
        unit_price: unitPrice,
        total_price: totalPrice,
        net_amount: totalPrice,
      })
      .returning('*');

    await recalculateQuoteFinancials(knexOrTrx, tenant, existingItem.quote_id);

    const refreshedItem = await quoteTable<IQuoteItem>(knexOrTrx, tenant, 'quote_items')
      .where({ quote_item_id: quoteItemId })
      .first();

    return normalizeQuoteItem(refreshedItem ?? updatedItem);
  },

  async delete(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    quoteItemId: string
  ): Promise<boolean> {
    if (!tenant) {
      throw new Error('Tenant context is required for deleting quote item');
    }

    const existingItem = await quoteTable<IQuoteItem>(knexOrTrx, tenant, 'quote_items')
      .where({ quote_item_id: quoteItemId })
      .select('quote_id')
      .first();

    if (!existingItem) {
      throw new Error(`Quote item ${quoteItemId} not found in tenant ${tenant}`);
    }

    await quoteTable(knexOrTrx, tenant, 'quote_items')
      .where({ quote_item_id: quoteItemId })
      .del();

    const remainingItems = await quoteTable<IQuoteItem>(knexOrTrx, tenant, 'quote_items')
      .where({ quote_id: existingItem.quote_id })
      .orderBy('display_order', 'asc')
      .orderBy('created_at', 'asc');

    for (const [index, item] of remainingItems.entries()) {
      if (item.display_order !== index) {
        await quoteTable(knexOrTrx, tenant, 'quote_items')
          .where({ quote_item_id: item.quote_item_id })
          .update({ display_order: index });
      }
    }

    await recalculateQuoteFinancials(knexOrTrx, tenant, existingItem.quote_id);

    return true;
  },

  async reorder(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    quoteId: string,
    orderedQuoteItemIds: string[]
  ): Promise<IQuoteItem[]> {
    if (!tenant) {
      throw new Error('Tenant context is required for reordering quote items');
    }

    const actualItemIds = await quoteTable(knexOrTrx, tenant, 'quote_items')
      .where({ quote_id: quoteId })
      .pluck('quote_item_id') as string[];

    if (orderedQuoteItemIds.length !== actualItemIds.length) {
      throw new Error(`Reorder list length (${orderedQuoteItemIds.length}) does not match actual item count (${actualItemIds.length})`);
    }

    const actualIdSet = new Set(actualItemIds);
    const invalidIds = orderedQuoteItemIds.filter((id) => !actualIdSet.has(id));
    if (invalidIds.length > 0) {
      throw new Error(`Reorder list contains item IDs not belonging to this quote: ${invalidIds.join(', ')}`);
    }

    for (const [index, quoteItemId] of orderedQuoteItemIds.entries()) {
      await quoteTable(knexOrTrx, tenant, 'quote_items')
        .where({ quote_id: quoteId, quote_item_id: quoteItemId })
        .update({ display_order: index });
    }

    await recalculateQuoteFinancials(knexOrTrx, tenant, quoteId);

    return QuoteItem.listByQuoteId(knexOrTrx, tenant, quoteId);
  }
};

export default QuoteItem;
