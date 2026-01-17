'use server';

import {
  createDefaultTaxSettings as createDefaultTaxSettingsImpl,
  createTaxComponent as createTaxComponentImpl,
  createTaxHoliday as createTaxHolidayImpl,
  createTaxRateThreshold as createTaxRateThresholdImpl,
  createTaxRegion as createTaxRegionImpl,
  deleteTaxComponent as deleteTaxComponentImpl,
  deleteTaxHoliday as deleteTaxHolidayImpl,
  deleteTaxRateThreshold as deleteTaxRateThresholdImpl,
  getActiveTaxRegions as getActiveTaxRegionsImpl,
  getClientTaxExemptStatus as getClientTaxExemptStatusImpl,
  getClientTaxSettings as getClientTaxSettingsImpl,
  getTaxComponentsByTaxRate as getTaxComponentsByTaxRateImpl,
  getTaxHolidaysByTaxRate as getTaxHolidaysByTaxRateImpl,
  getTaxRateThresholdsByTaxRate as getTaxRateThresholdsByTaxRateImpl,
  getTaxRates as getTaxRatesImpl,
  getTaxRegions as getTaxRegionsImpl,
  getTenantTaxSettings as getTenantTaxSettingsImpl,
  updateClientTaxExemptStatus as updateClientTaxExemptStatusImpl,
  updateClientTaxSettings as updateClientTaxSettingsImpl,
  updateTaxComponent as updateTaxComponentImpl,
  updateTaxHoliday as updateTaxHolidayImpl,
  updateTaxRateThreshold as updateTaxRateThresholdImpl,
  updateTaxRegion as updateTaxRegionImpl,
  updateTenantTaxSettings as updateTenantTaxSettingsImpl,
} from '@alga-psa/billing/actions/taxSettingsActions';

export async function getClientTaxSettings(
  ...args: Parameters<typeof getClientTaxSettingsImpl>
): ReturnType<typeof getClientTaxSettingsImpl> {
  return getClientTaxSettingsImpl(...args);
}

export async function updateClientTaxSettings(
  ...args: Parameters<typeof updateClientTaxSettingsImpl>
): ReturnType<typeof updateClientTaxSettingsImpl> {
  return updateClientTaxSettingsImpl(...args);
}

export async function getTaxRates(
  ...args: Parameters<typeof getTaxRatesImpl>
): ReturnType<typeof getTaxRatesImpl> {
  return getTaxRatesImpl(...args);
}

export async function getActiveTaxRegions(
  ...args: Parameters<typeof getActiveTaxRegionsImpl>
): ReturnType<typeof getActiveTaxRegionsImpl> {
  return getActiveTaxRegionsImpl(...args);
}

export async function getTaxRegions(
  ...args: Parameters<typeof getTaxRegionsImpl>
): ReturnType<typeof getTaxRegionsImpl> {
  return getTaxRegionsImpl(...args);
}

export async function createTaxRegion(
  ...args: Parameters<typeof createTaxRegionImpl>
): ReturnType<typeof createTaxRegionImpl> {
  return createTaxRegionImpl(...args);
}

export async function updateTaxRegion(
  ...args: Parameters<typeof updateTaxRegionImpl>
): ReturnType<typeof updateTaxRegionImpl> {
  return updateTaxRegionImpl(...args);
}

export async function getTaxComponentsByTaxRate(
  ...args: Parameters<typeof getTaxComponentsByTaxRateImpl>
): ReturnType<typeof getTaxComponentsByTaxRateImpl> {
  return getTaxComponentsByTaxRateImpl(...args);
}

export async function getTaxRateThresholdsByTaxRate(
  ...args: Parameters<typeof getTaxRateThresholdsByTaxRateImpl>
): ReturnType<typeof getTaxRateThresholdsByTaxRateImpl> {
  return getTaxRateThresholdsByTaxRateImpl(...args);
}

export async function getTaxHolidaysByTaxRate(
  ...args: Parameters<typeof getTaxHolidaysByTaxRateImpl>
): ReturnType<typeof getTaxHolidaysByTaxRateImpl> {
  return getTaxHolidaysByTaxRateImpl(...args);
}

export async function createTaxComponent(
  ...args: Parameters<typeof createTaxComponentImpl>
): ReturnType<typeof createTaxComponentImpl> {
  return createTaxComponentImpl(...args);
}

export async function updateTaxComponent(
  ...args: Parameters<typeof updateTaxComponentImpl>
): ReturnType<typeof updateTaxComponentImpl> {
  return updateTaxComponentImpl(...args);
}

export async function deleteTaxComponent(
  ...args: Parameters<typeof deleteTaxComponentImpl>
): ReturnType<typeof deleteTaxComponentImpl> {
  return deleteTaxComponentImpl(...args);
}

export async function createTaxRateThreshold(
  ...args: Parameters<typeof createTaxRateThresholdImpl>
): ReturnType<typeof createTaxRateThresholdImpl> {
  return createTaxRateThresholdImpl(...args);
}

export async function updateTaxRateThreshold(
  ...args: Parameters<typeof updateTaxRateThresholdImpl>
): ReturnType<typeof updateTaxRateThresholdImpl> {
  return updateTaxRateThresholdImpl(...args);
}

export async function deleteTaxRateThreshold(
  ...args: Parameters<typeof deleteTaxRateThresholdImpl>
): ReturnType<typeof deleteTaxRateThresholdImpl> {
  return deleteTaxRateThresholdImpl(...args);
}

export async function createTaxHoliday(
  ...args: Parameters<typeof createTaxHolidayImpl>
): ReturnType<typeof createTaxHolidayImpl> {
  return createTaxHolidayImpl(...args);
}

export async function updateTaxHoliday(
  ...args: Parameters<typeof updateTaxHolidayImpl>
): ReturnType<typeof updateTaxHolidayImpl> {
  return updateTaxHolidayImpl(...args);
}

export async function deleteTaxHoliday(
  ...args: Parameters<typeof deleteTaxHolidayImpl>
): ReturnType<typeof deleteTaxHolidayImpl> {
  return deleteTaxHolidayImpl(...args);
}

export async function createDefaultTaxSettings(
  ...args: Parameters<typeof createDefaultTaxSettingsImpl>
): ReturnType<typeof createDefaultTaxSettingsImpl> {
  return createDefaultTaxSettingsImpl(...args);
}

export async function updateClientTaxExemptStatus(
  ...args: Parameters<typeof updateClientTaxExemptStatusImpl>
): ReturnType<typeof updateClientTaxExemptStatusImpl> {
  return updateClientTaxExemptStatusImpl(...args);
}

export async function getClientTaxExemptStatus(
  ...args: Parameters<typeof getClientTaxExemptStatusImpl>
): ReturnType<typeof getClientTaxExemptStatusImpl> {
  return getClientTaxExemptStatusImpl(...args);
}

export async function getTenantTaxSettings(
  ...args: Parameters<typeof getTenantTaxSettingsImpl>
): ReturnType<typeof getTenantTaxSettingsImpl> {
  return getTenantTaxSettingsImpl(...args);
}

export async function updateTenantTaxSettings(
  ...args: Parameters<typeof updateTenantTaxSettingsImpl>
): ReturnType<typeof updateTenantTaxSettingsImpl> {
  return updateTenantTaxSettingsImpl(...args);
}
