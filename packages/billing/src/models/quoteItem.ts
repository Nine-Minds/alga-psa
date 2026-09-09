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
    item: Omit<IQuoteItem, 'quote_item_id' | 'tenant' | 'total_price' | 'net_amount' | 'tax_amount' | 'display_order' | 'created_at' | 'updated_at'> & Partial<Pick<IQuoteItem, 'display_order'>>
  ): Promise<IQuoteItem> {
    if (!tenant) {
      throw new Error('Tenant context is required for creating quote item');
    }

    ensureIntegerField(item.quantity, 'Quantity');
    ensureIntegerField(item.unit_price, 'Unit price');

    let resolvedItem = { ...item };

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

      // Catalog-description snapshot policy: a caller that passes an explicit
      // catalog_description (copy/duplicate/revision/template flows) keeps it
      // verbatim — including null. A caller that does NOT pass one (a freshly
      // selected catalog-backed line) gets the authoritative, tenant-scoped
      // catalog text captured here. Persistence never trusts picker data.
      const resolvedCatalogDescription =
        item.catalog_description !== undefined
          ? normalizeCatalogDescription(item.catalog_description)
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
      // snapshot to capture. When the caller passes an explicit snapshot (a
      // copy of a line whose catalog entry was deleted and whose FK was
      // SET NULL), keep it verbatim so duplication/revision/template flows
      // preserve historical output.
      resolvedItem = {
        ...resolvedItem,
        catalog_description:
          item.catalog_description !== undefined
            ? normalizeCatalogDescription(item.catalog_description)
            : null,
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
    updateData: Partial<IQuoteItem>
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

    let resolvedUpdate: Partial<IQuoteItem> = { ...updateData };

    // Catalog selection change: recapture name/SKU/kind/catalog description
    // together. Ordinary edits (quantity, price, line description) never touch
    // the snapshot because they leave service_id and the snapshot columns out
    // of the update payload. Callers that pass an explicit catalog_description
    // keep it verbatim (copy flows); otherwise the authoritative tenant-scoped
    // catalog text is captured.
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
          catalog_description:
            updateData.catalog_description !== undefined
              ? normalizeCatalogDescription(updateData.catalog_description)
              : normalizeCatalogDescription(service.description),
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
