'use server';

import { createTenantKnex, tenantDb } from '@alga-psa/db';
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
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

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

type XeroCsvActionError = ActionMessageError | ActionPermissionError;

export type XeroCsvSettingsActionResult = XeroCsvSettings | XeroCsvActionError;
export type XeroCsvTaxImportPreviewActionResult = TaxImportPreviewResult | XeroCsvActionError;
export type XeroCsvTaxImportActionResult = TaxImportResult | XeroCsvActionError;
export type XeroCsvClientExportActionResult = ClientExportResult | XeroCsvActionError;
export type XeroCsvClientImportPreviewActionResult = ClientImportPreviewResult | XeroCsvActionError;
export type XeroCsvClientImportActionResult = ClientImportResult | XeroCsvActionError;
export type XeroCsvClientMappingsActionResult = Array<{
  clientId: string;
  clientName: string;
  xeroContactName: string;
  lastSyncedAt: string | null;
}> | XeroCsvActionError;

async function requireAccountingCapability(
  user: IUserWithRoles,
  action: 'catalog_read' | 'connections_manage' | 'exports_execute',
  message: string,
  messageKey: string,
): Promise<XeroCsvActionError | null> {
  const allowed = await hasPermission(user, 'accounting_integrations', action);
  if (!allowed) {
    return permissionError(message, messageKey);
  }
  return null;
}

/**
 * Get Xero CSV integration settings for the current tenant.
 */
export const getXeroCsvSettings = withAuth(async (
  user,
  { tenant }
): Promise<XeroCsvSettings | XeroCsvActionError> => {
  const denied = await requireAccountingCapability(
    user,
    'catalog_read',
    'User does not have permission to view integration settings',
    'msp/integrations:errors.xeroCsv.viewSettingsPermission',
  );
  if (denied) return denied;

  const { knex } = await createTenantKnex();
  const db = tenantDb(knex, tenant);

  const tenantSettings = await db.table('tenant_settings')
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
): Promise<XeroCsvSettingsActionResult> => {
  const denied = await requireAccountingCapability(
    user,
    'connections_manage',
    'User does not have permission to manage integration settings',
    'msp/integrations:errors.xeroCsv.manageIntegrationsPermission',
  );
  if (denied) return denied;

  const { knex } = await createTenantKnex();
  const db = tenantDb(knex, tenant);

  // Get current settings
  const existingRow = await db.table('tenant_settings')
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
    await db.table('tenant_settings')
      .update({
        settings: JSON.stringify(newSettings),
        updated_at: now
      });
  } else {
    await db.table('tenant_settings').insert({
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
): Promise<XeroCsvTaxImportPreviewActionResult> => {
  const denied = await requireAccountingCapability(
    user,
    'exports_execute',
    'User does not have permission to manage billing',
    'msp/integrations:errors.xeroCsv.manageBillingPermission',
  );
  if (denied) return denied;

  if (!csvContent || csvContent.trim().length === 0) {
    return actionError('CSV content is required', 'msp/integrations:errors.xeroCsv.contentRequired');
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
): Promise<XeroCsvTaxImportActionResult> => {
  const denied = await requireAccountingCapability(
    user,
    'exports_execute',
    'User does not have permission to manage billing',
    'msp/integrations:errors.xeroCsv.manageBillingPermission',
  );
  if (denied) return denied;

  if (!csvContent || csvContent.trim().length === 0) {
    return actionError('CSV content is required', 'msp/integrations:errors.xeroCsv.contentRequired');
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
): Promise<XeroCsvClientExportActionResult> => {
  const denied = await requireAccountingCapability(
    user,
    'exports_execute',
    'User does not have permission to manage billing',
    'msp/integrations:errors.xeroCsv.manageBillingPermission',
  );
  if (denied) return denied;

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
): Promise<XeroCsvClientImportPreviewActionResult> => {
  const denied = await requireAccountingCapability(
    user,
    'exports_execute',
    'User does not have permission to manage billing',
    'msp/integrations:errors.xeroCsv.manageBillingPermission',
  );
  if (denied) return denied;

  if (!csvContent || csvContent.trim().length === 0) {
    return actionError('CSV content is required', 'msp/integrations:errors.xeroCsv.contentRequired');
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
): Promise<XeroCsvClientImportActionResult> => {
  const denied = await requireAccountingCapability(
    user,
    'exports_execute',
    'User does not have permission to manage billing',
    'msp/integrations:errors.xeroCsv.manageBillingPermission',
  );
  if (denied) return denied;

  if (!csvContent || csvContent.trim().length === 0) {
    return actionError('CSV content is required', 'msp/integrations:errors.xeroCsv.contentRequired');
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
): Promise<XeroCsvClientMappingsActionResult> => {
  const denied = await requireAccountingCapability(
    user,
    'catalog_read',
    'User does not have permission to view billing settings',
    'msp/integrations:errors.xeroCsv.viewBillingPermission',
  );
  if (denied) return denied;

  const service = getXeroCsvClientSyncService();
  return service.getClientMappings();
});
