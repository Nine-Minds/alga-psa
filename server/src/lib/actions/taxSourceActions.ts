'use server';

import type { TaxSource } from '@alga-psa/types';
import type { ClientTaxSourceInfo } from '@alga-psa/billing/actions/taxSourceActions';
import {
  canClientOverrideTaxSource as canClientOverrideTaxSourceImpl,
  getEffectiveTaxSourceForClient as getEffectiveTaxSourceForClientImpl,
  getInitialInvoiceTaxSource as getInitialInvoiceTaxSourceImpl,
  shouldUseTaxDelegation as shouldUseTaxDelegationImpl,
  updateInvoiceTaxSource as updateInvoiceTaxSourceImpl,
  validateInvoiceFinalization as validateInvoiceFinalizationImpl,
} from '@alga-psa/billing/actions/taxSourceActions';

export async function getEffectiveTaxSourceForClient(clientId: string): Promise<ClientTaxSourceInfo> {
  return getEffectiveTaxSourceForClientImpl(clientId);
}

export async function shouldUseTaxDelegation(clientId: string): Promise<boolean> {
  return shouldUseTaxDelegationImpl(clientId);
}

export async function getInitialInvoiceTaxSource(clientId: string): Promise<TaxSource> {
  return getInitialInvoiceTaxSourceImpl(clientId);
}

export async function validateInvoiceFinalization(
  invoiceId: string
): Promise<{ canFinalize: boolean; error?: string; warning?: string }> {
  return validateInvoiceFinalizationImpl(invoiceId);
}

export async function updateInvoiceTaxSource(
  invoiceId: string,
  newTaxSource: TaxSource
): Promise<{ success: boolean; error?: string }> {
  return updateInvoiceTaxSourceImpl(invoiceId, newTaxSource);
}

export async function canClientOverrideTaxSource(): Promise<boolean> {
  return canClientOverrideTaxSourceImpl();
}
