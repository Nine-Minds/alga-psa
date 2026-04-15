import type { Knex } from 'knex';
import type { IQuoteItem } from '@alga-psa/types';
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
  } as IQuoteItem;
}

async function getNextDisplayOrder(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  quoteId: string
): Promise<number> {
  const result = await knexOrTrx('quote_items')
    .where({ tenant, quote_id: quoteId })
    .max<{ max?: number | string }>('display_order as max')
    .first();

  return Number(result?.max ?? -1) + 1;
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

    const items = await knexOrTrx('quote_items')
      .where({ tenant, quote_id: quoteId })
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
      const service = await knexOrTrx('service_catalog')
        .where({ tenant, service_id: item.service_id })
        .select(
          'service_name',
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
        const quote = await knexOrTrx('quotes')
          .where({ tenant, quote_id: item.quote_id })
          .select('currency_code')
          .first();
        const currencyCode = quote?.currency_code ?? 'USD';

        const priceRow = await knexOrTrx('service_prices')
          .where({ tenant, service_id: item.service_id, currency_code: currencyCode })
          .select('rate')
          .first();

        resolvedUnitPrice = priceRow ? Number(priceRow.rate) : Number(service.default_rate ?? 0);
      }

      const resolvedItemKind = resolvedItem.service_item_kind ?? service.item_kind ?? 'service';

      resolvedItem = {
        ...resolvedItem,
        service_name: resolvedItem.service_name ?? service.service_name,
        service_sku: resolvedItem.service_sku ?? service.sku ?? null,
        unit_price: resolvedUnitPrice,
        unit_of_measure: resolvedItem.unit_of_measure ?? service.unit_of_measure ?? null,
        billing_method: resolvedItem.billing_method ?? service.billing_method ?? null,
        service_item_kind: resolvedItemKind,
        description: resolvedItem.description || service.service_name,
        // Snapshot cost for product items so markup can be calculated on the quote
        cost: resolvedItemKind === 'product' && service.cost != null ? Number(service.cost) : (resolvedItem as any).cost ?? null,
        cost_currency: resolvedItemKind === 'product' && service.cost_currency ? service.cost_currency : (resolvedItem as any).cost_currency ?? null,
      };
    }

    const quantity = Number(resolvedItem.quantity ?? 1);
    const unitPrice = Number(resolvedItem.unit_price ?? 0);
    const totalPrice = quantity * unitPrice;
    const displayOrder = resolvedItem.display_order ?? await getNextDisplayOrder(knexOrTrx, tenant, item.quote_id);

    const [createdItem] = await knexOrTrx('quote_items')
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

    const refreshedItem = await knexOrTrx('quote_items')
      .where({ tenant, quote_item_id: createdItem.quote_item_id })
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

    const existingItem = await knexOrTrx('quote_items')
      .where({ tenant, quote_item_id: quoteItemId })
      .first();

    if (!existingItem) {
      throw new Error(`Quote item ${quoteItemId} not found in tenant ${tenant}`);
    }

    const quantity = Number(updateData.quantity ?? existingItem.quantity);
    const unitPrice = Number(updateData.unit_price ?? existingItem.unit_price);

    ensureIntegerField(quantity, 'Quantity');
    ensureIntegerField(unitPrice, 'Unit price');

    const totalPrice = Number(quantity) * Number(unitPrice);

    const [updatedItem] = await knexOrTrx('quote_items')
      .where({ tenant, quote_item_id: quoteItemId })
      .update({
        ...updateData,
        quantity,
        unit_price: unitPrice,
        total_price: totalPrice,
        net_amount: totalPrice,
      })
      .returning('*');

    await recalculateQuoteFinancials(knexOrTrx, tenant, existingItem.quote_id);

    const refreshedItem = await knexOrTrx('quote_items')
      .where({ tenant, quote_item_id: quoteItemId })
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

    const existingItem = await knexOrTrx('quote_items')
      .where({ tenant, quote_item_id: quoteItemId })
      .select('quote_id')
      .first();

    if (!existingItem) {
      throw new Error(`Quote item ${quoteItemId} not found in tenant ${tenant}`);
    }

    await knexOrTrx('quote_items')
      .where({ tenant, quote_item_id: quoteItemId })
      .del();

    const remainingItems = await knexOrTrx('quote_items')
      .where({ tenant, quote_id: existingItem.quote_id })
      .orderBy('display_order', 'asc')
      .orderBy('created_at', 'asc');

    for (const [index, item] of remainingItems.entries()) {
      if (item.display_order !== index) {
        await knexOrTrx('quote_items')
          .where({ tenant, quote_item_id: item.quote_item_id })
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

    const actualItemIds = await knexOrTrx('quote_items')
      .where({ tenant, quote_id: quoteId })
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
      await knexOrTrx('quote_items')
        .where({ tenant, quote_id: quoteId, quote_item_id: quoteItemId })
        .update({ display_order: index });
    }

    await recalculateQuoteFinancials(knexOrTrx, tenant, quoteId);

    return QuoteItem.listByQuoteId(knexOrTrx, tenant, quoteId);
  }
};

export default QuoteItem;
