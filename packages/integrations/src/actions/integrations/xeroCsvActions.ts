'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { getXeroCsvTaxImportService } from '../../services/xeroCsvTaxImportService';
import type { TaxImportPreviewResult, TaxImportResult, IUserWithRoles } from '@alga-psa/types';
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
export const getXeroCsvSettings = withAuth(async (
  _user,
  { tenant }
): Promise<XeroCsvSettings> => {
  const { knex } = await createTenantKnex();

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
});

/**
 * Update Xero CSV integration settings for the current tenant.
 */
export const updateXeroCsvSettings = withAuth(async (
  user,
  { tenant },
  updates: Partial<XeroCsvSettings>
): Promise<XeroCsvSettings> => {
  const { knex } = await createTenantKnex();

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
});

// Backwards-compatible alias.
export const saveXeroCsvSettings = updateXeroCsvSettings;

/**
 * Preview tax import from Xero Invoice Details Report CSV.
 * Parses the CSV and shows which invoices will be matched/updated.
 */
export const previewXeroCsvTaxImport = withAuth(async (
  user,
  { tenant },
  csvContent: string
): Promise<TaxImportPreviewResult> => {
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
});

/**
 * Execute tax import from Xero Invoice Details Report CSV.
 * Applies tax amounts to matched invoices.
 */
export const executeXeroCsvTaxImport = withAuth(async (
  user,
  { tenant },
  csvContent: string
): Promise<TaxImportResult> => {
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
});

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
export const exportClientsToXeroCsv = withAuth(async (
  user,
  { tenant },
  clientIds?: string[]
): Promise<ClientExportResult> => {
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
});

/**
 * Preview importing Xero Contacts CSV into Alga.
 */
export const previewXeroCsvClientImport = withAuth(async (
  user,
  { tenant },
  csvContent: string,
  options?: Partial<ClientImportOptions>
): Promise<ClientImportPreviewResult> => {
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
});

/**
 * Execute importing Xero Contacts CSV into Alga.
 */
export const executeXeroCsvClientImport = withAuth(async (
  user,
  { tenant },
  csvContent: string,
  options?: Partial<ClientImportOptions>
): Promise<ClientImportResult> => {
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
});

/**
 * Get all Xero CSV client mappings.
 */
export const getXeroCsvClientMappings = withAuth(async (
  user,
  _ctx
): Promise<Array<{
  clientId: string;
  clientName: string;
  xeroContactName: string;
  lastSyncedAt: string | null;
}>> => {
  const canReadBilling = await hasPermission(user, 'billing_settings', 'read');
  if (!canReadBilling) {
    throw new Error('User does not have permission to view billing settings');
  }

  const service = getXeroCsvClientSyncService();
  return service.getClientMappings();
});
