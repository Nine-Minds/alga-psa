import { TaxService } from '../../services/taxService';
import {
  allocateDiscountsBeforeTax,
  buildDiscountTaxEntities,
  type DiscountPool,
  type DiscountTaxEntity,
} from '../discountAllocationBeforeTax';

/** Minimal charge shape the preview needs (a subset of IBillingCharge). */
export interface TaxableChargeInput {
  type?: string;
  total: number;
  allocated_amount?: number | null;
  is_taxable?: boolean;
  tax_region?: string | null;
  serviceId?: string | null;
  client_contract_id?: string | null;
}

export interface AutomaticDiscountInput {
  discount_id: string;
  amount: number;
  allocations?: Array<{ item_id: string; amount: number }>;
}

/**
 * Preview tax for a set of billing charges and automatic discounts.
 *
 * Mirrors `calculateAndDistributeTax` on a persisted invoice: discounts lower
 * the taxable base of the lines they applied to (shared allocation), then tax
 * is computed once per region on the discounted base. Because both paths call
 * `allocateDiscountsBeforeTax` and tax the regional sum, preview equals the
 * generated invoice.
 *
 * `chargeItemIds[i]` is the line id discount allocations use for charge `i`
 * (consolidated fixed charges share their parent's id).
 */
export async function computeTaxAfterDiscounts(input: {
  charges: TaxableChargeInput[];
  chargeItemIds: string[];
  discounts: AutomaticDiscountInput[];
  defaultTaxRegion: string;
  calculateRegionTax: (region: string, taxableBase: number) => Promise<number>;
}): Promise<number> {
  const entities: DiscountTaxEntity[] = buildDiscountTaxEntities(
    input.charges.map((charge, index) => ({
      id: `charge-${index}`,
      itemId: input.chargeItemIds[index] ?? `preview-charge-${index}`,
      amount: charge.type === 'fixed'
        ? Number(charge.allocated_amount ?? charge.total)
        : Number(charge.total),
      region: charge.tax_region,
      taxable: Boolean(charge.is_taxable),
      serviceId: charge.serviceId ?? null,
      clientContractId: charge.client_contract_id ?? null,
    })),
    input.defaultTaxRegion,
  );

  const pools: DiscountPool[] = input.discounts.map((discount) => ({
    id: discount.discount_id,
    amount: Math.abs(Number(discount.amount) || 0),
    allocations: discount.allocations?.map((allocation) => ({
      itemId: allocation.item_id,
      amount: allocation.amount,
    })),
  }));

  const { taxableAmountById } = allocateDiscountsBeforeTax({ entities, pools });

  const baseByRegion = new Map<string, number>();
  for (const entity of entities) {
    if (!entity.taxable) continue;
    baseByRegion.set(entity.region, (baseByRegion.get(entity.region) ?? 0) + (taxableAmountById.get(entity.id) ?? 0));
  }

  let totalTax = 0;
  for (const [region, base] of baseByRegion) {
    if (base > 0) totalTax += await input.calculateRegionTax(region, base);
  }
  return totalTax;
}

/**
 * Preview tax backed by the tenant's TaxService. Not a server action: callers
 * (permission-checked actions) own authorization.
 */
export async function calculatePreviewTaxAfterDiscounts(
  charges: TaxableChargeInput[],
  clientId: string,
  cycleEnd: string,
  defaultTaxRegion: string,
  currencyCode: string,
  adjustments?: { discounts: AutomaticDiscountInput[]; chargeItemIds: string[] },
): Promise<number> {
  const taxService = new TaxService();
  return computeTaxAfterDiscounts({
    charges,
    chargeItemIds: adjustments?.chargeItemIds ?? [],
    discounts: adjustments?.discounts ?? [],
    defaultTaxRegion,
    calculateRegionTax: async (region, taxableBase) => {
      const result = await taxService.calculateTax(clientId, taxableBase, cycleEnd, region, true, currencyCode);
      return result.taxAmount;
    },
  });
}
