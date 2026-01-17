'use server';

import type { ITaxRate } from '@alga-psa/types';
import type { DeleteTaxRateResult } from '@alga-psa/billing/actions/taxRateActions';
import {
  addTaxRate as addTaxRateImpl,
  confirmDeleteTaxRate as confirmDeleteTaxRateImpl,
  deleteTaxRate as deleteTaxRateImpl,
  getTaxRates as getTaxRatesImpl,
  updateTaxRate as updateTaxRateImpl,
} from '@alga-psa/billing/actions/taxRateActions';

export async function getTaxRates(): Promise<ITaxRate[]> {
  return getTaxRatesImpl();
}

export async function addTaxRate(taxRateData: Omit<ITaxRate, 'tax_rate_id'>): Promise<ITaxRate> {
  return addTaxRateImpl(taxRateData);
}

export async function updateTaxRate(taxRateData: ITaxRate): Promise<ITaxRate> {
  return updateTaxRateImpl(taxRateData);
}

export async function deleteTaxRate(taxRateId: string): Promise<DeleteTaxRateResult> {
  return deleteTaxRateImpl(taxRateId);
}

export async function confirmDeleteTaxRate(taxRateId: string): Promise<void> {
  return confirmDeleteTaxRateImpl(taxRateId);
}
