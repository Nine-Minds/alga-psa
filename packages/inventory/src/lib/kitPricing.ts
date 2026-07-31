import type { Knex } from 'knex';
import type { KitPricingMode } from '@alga-psa/types';

export interface KitPriceComponent {
  default_rate: number | string | null;
  quantity: number | string;
}

export interface KitCostComponent {
  extended_cost: number | null;
  cost_currency: string | null;
}

function asNumber(value: unknown, fallback = 0): number {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeQuantity(value: unknown): number {
  const quantity = Number(value);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error('Component quantity must be a positive integer');
  }
  return quantity;
}

function normalizePricingMode(value?: KitPricingMode | null): KitPricingMode {
  const mode = value ?? 'sum';
  if (mode !== 'sum' && mode !== 'fixed') {
    throw new Error(`Invalid kit_pricing_mode: ${mode}`);
  }
  return mode;
}

/** Resolve a kit's reusable price policy from already-loaded data. */
export function resolveKitPricePolicy(
  mode: KitPricingMode,
  fixedPrice: number | null,
  components: KitPriceComponent[],
): number {
  if (mode === 'fixed') return fixedPrice ?? 0;
  return components.reduce(
    (sum, component) => sum + asNumber(component.default_rate) * normalizeQuantity(component.quantity),
    0,
  );
}

export function calculateKitFinancials(
  kitPrice: number,
  kitCurrency: string,
  components: KitCostComponent[],
): { componentCost: number | null; marginAmount: number | null; marginPercent: number | null } {
  const normalizedCurrency = kitCurrency.toUpperCase();
  const hasCompleteComponentCost = components.length > 0 && components.every((component) =>
    component.extended_cost !== null &&
    (!component.cost_currency || component.cost_currency.toUpperCase() === normalizedCurrency),
  );
  const componentCost = hasCompleteComponentCost
    ? components.reduce((sum, component) => sum + (component.extended_cost ?? 0), 0)
    : null;
  const marginAmount = componentCost === null ? null : kitPrice - componentCost;
  const marginPercent = kitPrice > 0 && marginAmount !== null ? marginAmount / kitPrice : null;
  return { componentCost, marginAmount, marginPercent };
}

/** Resolve kit pricing inside an existing transaction so order writes cannot use a stale browser value. */
export async function resolveKitPriceInTransaction(
  trx: Knex.Transaction,
  tenant: string,
  kitServiceId: string,
): Promise<number> {
  const settings = await trx('product_inventory_settings')
    .where({ tenant, service_id: kitServiceId })
    .select('is_kit', 'kit_pricing_mode', 'kit_fixed_price')
    .first();
  if (!settings) throw new Error('Inventory not enabled for this product');
  if (!settings.is_kit) throw new Error('Product is not flagged as a kit (is_kit=false)');

  const mode = normalizePricingMode(settings.kit_pricing_mode);
  const fixedPrice = settings.kit_fixed_price == null ? null : asNumber(settings.kit_fixed_price);
  if (mode === 'fixed' && !(fixedPrice && fixedPrice > 0)) {
    throw new Error('Fixed kit price must be greater than 0');
  }

  const components = (await trx('kit_components as kc')
    .join('service_catalog as sc', function () {
      this.on('kc.component_service_id', '=', 'sc.service_id').andOn('kc.tenant', '=', 'sc.tenant');
    })
    .where({ 'kc.tenant': tenant, 'kc.kit_service_id': kitServiceId })
    .select('kc.quantity', 'sc.default_rate')) as KitPriceComponent[];

  return resolveKitPricePolicy(mode, fixedPrice, components);
}
