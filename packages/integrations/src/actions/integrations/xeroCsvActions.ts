'use server';

import { createTenantKnex } from '@alga-psa/db';
import { getCurrentUser } from '@alga-psa/users/actions';
import { hasPermission } from '@alga-psa/auth/rbac';
import { getXeroCsvTaxImportService } from '../../services/xeroCsvTaxImportService';
import type { TaxImportPreviewResult, TaxImportResult } from '@alga-psa/types';
import {
  getXeroCsvClientSyncService,
  type ClientExportResult,
  type ClientImportPreviewResult,
  type ClientImportResult,
  type ClientImportOptions
} from '../../services/xeroCsvClientSyncService';
import logger from '@alga-psa/core/logger';

/**
 * Xero CSV integration settings stored in tenant_settings.settings.
 */
export interface XeroCsvSettings {
  /** Integration mode: 'oauth' (default) or 'csv' */
  integrationMode: 'oauth' | 'csv';
  /** Date format for CSV export: 'DD/MM/YYYY' (Xero default) or 'MM/DD/YYYY' */
  dateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY';
  /** Default currency code (e.g., 'USD', 'NZD', 'AUD') */
  defaultCurrency: string;
  /** Whether setup instructions have been acknowledged */
  setupAcknowledged: boolean;
}

const DEFAULT_SETTINGS: XeroCsvSettings = {
  integrationMode: 'oauth',
  dateFormat: 'MM/DD/YYYY',
  defaultCurrency: '',
  setupAcknowledged: false
};

/**
 * Get Xero CSV integration settings for the current tenant.
 */
export async function getXeroCsvSettings(): Promise<XeroCsvSettings> {
  const { knex, tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('No tenant found');
  }

  const tenantSettings = await knex('tenant_settings')
    .where({ tenant })
    .select('settings')
    .first();

  const settings = tenantSettings?.settings ?? {};
  const xeroCsvSettings = settings.xeroCsv ?? {};

  return {
    ...DEFAULT_SETTINGS,
    ...xeroCsvSettings
  };
}

/**
 * Update Xero CSV integration settings for the current tenant.
 */
export async function updateXeroCsvSettings(
  updates: Partial<XeroCsvSettings>
): Promise<XeroCsvSettings> {
  const { knex, tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('No tenant found');
  }

  // Check user permissions
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User must be authenticated');
  }

  const canManageIntegrations = await hasPermission(user, 'billing_settings', 'update');
  if (!canManageIntegrations) {
    throw new Error('User does not have permission to manage integration settings');
  }

  // Get current settings
  const existingRow = await knex('tenant_settings')
    .where({ tenant })
    .select('settings')
    .first();

  const existingSettings = existingRow?.settings ?? {};
  const existingXeroCsv = existingSettings.xeroCsv ?? {};

  const newXeroCsvSettings: XeroCsvSettings = {
    ...DEFAULT_SETTINGS,
    ...existingXeroCsv,
    ...updates
  };

  const newSettings = {
    ...existingSettings,
    xeroCsv: newXeroCsvSettings
  };

  const now = new Date();

  if (existingRow) {
    await knex('tenant_settings')
      .where({ tenant })
      .update({
        settings: JSON.stringify(newSettings),
        updated_at: now
      });
  } else {
    await knex('tenant_settings').insert({
      tenant,
      settings: JSON.stringify(newSettings),
      onboarding_completed: false,
      onboarding_skipped: false,
      created_at: now,
      updated_at: now
    });
  }

  logger.info('[XeroCsvActions] Updated Xero CSV settings', {
    tenant,
    integrationMode: newXeroCsvSettings.integrationMode
  });

  return newXeroCsvSettings;
}

// Backwards-compatible alias.
export const saveXeroCsvSettings = updateXeroCsvSettings;

/**
 * Preview tax import from Xero Invoice Details Report CSV.
 * Parses the CSV and shows which invoices will be matched/updated.
 */
export async function previewXeroCsvTaxImport(
  csvContent: string
): Promise<TaxImportPreviewResult> {
  const { tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('No tenant found');
  }

  // Check user permissions
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User must be authenticated');
  }

  const canManageBilling = await hasPermission(user, 'billing_settings', 'update');
  if (!canManageBilling) {
    throw new Error('User does not have permission to manage billing');
  }

  if (!csvContent || csvContent.trim().length === 0) {
    throw new Error('CSV content is required');
  }

  const service = getXeroCsvTaxImportService();
  const result = await service.previewTaxImport(csvContent);

  logger.info('[XeroCsvActions] Tax import preview generated', {
    tenant,
    invoiceCount: result.invoiceCount,
    matchedCount: result.matchedCount,
    unmatchedCount: result.unmatchedCount
  });

  return result;
}

/**
 * Execute tax import from Xero Invoice Details Report CSV.
 * Applies tax amounts to matched invoices.
 */
export async function executeXeroCsvTaxImport(
  csvContent: string
): Promise<TaxImportResult> {
  const { tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('No tenant found');
  }

  // Check user permissions
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User must be authenticated');
  }

  const canManageBilling = await hasPermission(user, 'billing_settings', 'update');
  if (!canManageBilling) {
    throw new Error('User does not have permission to manage billing');
  }

  if (!csvContent || csvContent.trim().length === 0) {
    throw new Error('CSV content is required');
  }

  const service = getXeroCsvTaxImportService();
  const result = await service.importTaxFromReport(csvContent, user.user_id);

  logger.info('[XeroCsvActions] Tax import executed', {
    tenant,
    totalProcessed: result.totalProcessed,
    successCount: result.successCount,
    failureCount: result.failureCount,
    totalTaxImported: result.totalTaxImported
  });

  return result;
}

/**
 * Get the current Xero integration mode for the tenant.
 * Convenience function for checking if CSV mode is enabled.
 */
export async function getXeroIntegrationMode(): Promise<'oauth' | 'csv'> {
  const settings = await getXeroCsvSettings();
  return settings.integrationMode;
}

// =============================================================================
// Client Sync Actions
// =============================================================================

/**
 * Export Alga clients to Xero Contacts CSV format.
 */
export async function exportClientsToXeroCsv(
  clientIds?: string[]
): Promise<ClientExportResult> {
  const { tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('No tenant found');
  }

  // Check user permissions
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User must be authenticated');
  }

  const canManageBilling = await hasPermission(user, 'billing_settings', 'update');
  if (!canManageBilling) {
    throw new Error('User does not have permission to manage billing');
  }

  const service = getXeroCsvClientSyncService();
  const result = await service.exportClientsToXeroCsv(clientIds);

  logger.info('[XeroCsvActions] Client export completed', {
    tenant,
    clientCount: result.clientCount,
    filename: result.filename
  });

  return result;
}

/**
 * Preview importing Xero Contacts CSV into Alga.
 */
export async function previewXeroCsvClientImport(
  csvContent: string,
  options?: Partial<ClientImportOptions>
): Promise<ClientImportPreviewResult> {
  const { tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('No tenant found');
  }

  // Check user permissions
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User must be authenticated');
  }

  const canManageBilling = await hasPermission(user, 'billing_settings', 'update');
  if (!canManageBilling) {
    throw new Error('User does not have permission to manage billing');
  }

  if (!csvContent || csvContent.trim().length === 0) {
    throw new Error('CSV content is required');
  }

  const service = getXeroCsvClientSyncService();
  const result = await service.previewClientImport(csvContent, options);

  logger.info('[XeroCsvActions] Client import preview generated', {
    tenant,
    totalRows: result.totalRows,
    toCreate: result.toCreate,
    toUpdate: result.toUpdate,
    toSkip: result.toSkip
  });

  return result;
}

/**
 * Execute importing Xero Contacts CSV into Alga.
 */
export async function executeXeroCsvClientImport(
  csvContent: string,
  options?: Partial<ClientImportOptions>
): Promise<ClientImportResult> {
  const { tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('No tenant found');
  }

  // Check user permissions
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User must be authenticated');
  }

  const canManageBilling = await hasPermission(user, 'billing_settings', 'update');
  if (!canManageBilling) {
    throw new Error('User does not have permission to manage billing');
  }

  if (!csvContent || csvContent.trim().length === 0) {
    throw new Error('CSV content is required');
  }

  const service = getXeroCsvClientSyncService();
  const result = await service.importClients(csvContent, options, user.user_id);

  logger.info('[XeroCsvActions] Client import executed', {
    tenant,
    totalProcessed: result.totalProcessed,
    created: result.created,
    updated: result.updated,
    skipped: result.skipped,
    errors: result.errors.length,
    mappingsCreated: result.mappingsCreated
  });

  return result;
}

/**
 * Get all Xero CSV client mappings.
 */
export async function getXeroCsvClientMappings(): Promise<Array<{
  clientId: string;
  clientName: string;
  xeroContactName: string;
  lastSyncedAt: string | null;
}>> {
  const { tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('No tenant found');
  }

  // Check user permissions
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User must be authenticated');
  }

  const canReadBilling = await hasPermission(user, 'billing_settings', 'read');
  if (!canReadBilling) {
    throw new Error('User does not have permission to view billing settings');
  }

  const service = getXeroCsvClientSyncService();
  return service.getClientMappings();
}
