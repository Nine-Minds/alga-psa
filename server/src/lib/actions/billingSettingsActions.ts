'use server';

import {
  getClientContractLineSettings as getClientContractLineSettingsImpl,
  getDefaultBillingSettings as getDefaultBillingSettingsImpl,
  updateClientContractLineSettings as updateClientContractLineSettingsImpl,
  updateDefaultBillingSettings as updateDefaultBillingSettingsImpl,
} from '@alga-psa/billing/actions/billingSettingsActions';

type BillingSettings = import('@alga-psa/billing/actions/billingSettingsActions').BillingSettings;

export async function getDefaultBillingSettings(): Promise<BillingSettings> {
  return getDefaultBillingSettingsImpl();
}

export async function updateDefaultBillingSettings(data: BillingSettings): Promise<{ success: boolean }> {
  return updateDefaultBillingSettingsImpl(data);
}

export async function getClientContractLineSettings(clientId: string): Promise<BillingSettings | null> {
  return getClientContractLineSettingsImpl(clientId);
}

export async function updateClientContractLineSettings(
  clientId: string,
  data: BillingSettings | null
): Promise<{ success: boolean }> {
  return updateClientContractLineSettingsImpl(clientId, data);
}
