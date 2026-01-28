/**
 * Tenant Data Export Functions
 *
 * Standalone functions for exporting tenant data, designed to be called
 * directly from route handlers (not inside Temporal workers).
 *
 * This is an EE-only feature for Nine Minds internal use via the tenant management extension.
 */

import { getAdminConnection } from '@alga-psa/db/admin';
import { Knex } from 'knex';
import { observabilityLogger } from '@/lib/observability/logging';

export type ISO8601String = string;

export interface ExportTenantDataInput {
  tenantId: string;
  requestedBy: string;
  reason?: string;
}

export interface ExportTenantDataResult {
  success: boolean;
  exportId?: string;
  /** S3 bucket where the export is stored */
  bucket?: string;
  /** S3 key where the export is stored (permanent) */
  s3Key?: string;
  fileSizeBytes?: number;
  tableCount?: number;
  recordCount?: number;
  error?: string;
}

/**
 * Tables to export for tenant data export.
 * Focuses on business data, excludes system/config tables.
 */
const TENANT_TABLES_EXPORT_ORDER: string[] = [
  // Core business data
  'users',
  'contacts',
  'companies',
  'clients',

  // Tickets and support
  'tickets',
  'ticket_resources',
  'ticket_materials',
  'comments',

  // Time tracking
  'time_entries',
  'time_sheets',
  'time_sheet_comments',

  // Projects
  'projects',
  'project_phases',
  'project_tasks',
  'project_task_comments',
  'project_materials',

  // Invoices and billing
  'invoices',
  'invoice_items',
  'invoice_annotations',
  'invoice_time_entries',
  'transactions',
  'credit_tracking',

  // Contracts
  'contracts',
  'contract_lines',
  'contract_line_services',

  // Documents
  'documents',
  'document_versions',
  'document_content',
  'document_block_content',

  // Assets
  'assets',
  'asset_history',
  'asset_associations',
  'asset_software',
  'asset_maintenance_schedules',

  // Schedules
  'schedules',
  'schedule_entries',

  // Teams and roles
  'teams',
  'team_members',
  'roles',
  'user_roles',

  // Interactions
  'interactions',

  // Service catalog
  'service_catalog',
  'service_categories',

  // Tags
  'tags',
  'tag_mappings',

  // Workflows
  'workflow_executions',
  'workflow_events',
  'workflow_tasks',
];

/**
 * Check if a table exists and has a tenant column
 */
async function getTableTenantColumn(
  knex: Knex,
  tableName: string
): Promise<string | null> {
  try {
    const result = await knex.raw(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = ?
        AND column_name IN ('tenant', 'tenant_id')
        AND table_schema = 'public'
      LIMIT 1
    `, [tableName]);

    if (result.rows && result.rows.length > 0) {
      return result.rows[0].column_name;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Export all tenant data to a JSON file and upload to S3.
 * The file is stored permanently; download URLs are generated on-demand.
 *
 * @param input - Export parameters including tenantId and requestedBy
 * @returns Export result with S3 key and optional initial download URL
 */
export async function exportTenantData(
  input: ExportTenantDataInput
): Promise<ExportTenantDataResult> {
  const { tenantId, requestedBy, reason } = input;
  const exportId = crypto.randomUUID();

  observabilityLogger.info('Starting tenant data export', {
    tenantId,
    exportId,
    requestedBy,
    reason,
  });

  try {
    const adminKnex = await getAdminConnection();

    // Get tenant info for the export metadata
    const tenant = await adminKnex('tenants').where({ tenant: tenantId }).first();
    if (!tenant) {
      return { success: false, error: 'Tenant not found' };
    }

    const exportData: Record<string, any> = {
      _metadata: {
        exportId,
        tenantId,
        tenantName: tenant.company_name || tenant.client_name,
        exportedAt: new Date().toISOString(),
        requestedBy,
        reason,
        version: '1.0',
      },
      tables: {},
    };

    let totalRecords = 0;
    let tableCount = 0;

    // Export each table
    for (const tableName of TENANT_TABLES_EXPORT_ORDER) {
      try {
        const tenantColumn = await getTableTenantColumn(adminKnex, tableName);

        if (tenantColumn) {
          const records = await adminKnex(tableName)
            .where({ [tenantColumn]: tenantId })
            .select('*');

          if (records.length > 0) {
            exportData.tables[tableName] = records;
            totalRecords += records.length;
            tableCount++;
            observabilityLogger.debug(`Exported ${records.length} records from ${tableName}`);
          }
        }
      } catch (error) {
        // Log but continue - some tables may not exist
        observabilityLogger.debug(`Could not export ${tableName}`, {
          error: error instanceof Error ? error.message : 'Unknown',
        });
      }
    }

    exportData._metadata.totalRecords = totalRecords;
    exportData._metadata.tableCount = tableCount;

    // Convert to JSON
    const jsonContent = JSON.stringify(exportData, null, 2);
    const jsonBuffer = Buffer.from(jsonContent, 'utf-8');

    observabilityLogger.info('Export data collected', {
      tenantId,
      exportId,
      tableCount,
      totalRecords,
      sizeBytes: jsonBuffer.length,
    });

    // Upload to S3
    // Use a dedicated path for tenant exports (permanent storage)
    const s3Key = `tenant-exports/${tenantId}/${exportId}.json`;

    try {
      // Dynamically import S3 client to avoid issues in non-EE environments
      const s3Module = await import('@ee/lib/storage/s3-client');
      const { putObject, getBucket } = s3Module;

      await putObject(s3Key, jsonBuffer, {
        contentType: 'application/json',
      });

      const bucket = getBucket();

      observabilityLogger.info('Tenant data export completed', {
        tenantId,
        exportId,
        bucket,
        s3Key,
        tableCount,
        totalRecords,
      });

      return {
        success: true,
        exportId,
        bucket,
        s3Key,
        fileSizeBytes: jsonBuffer.length,
        tableCount,
        recordCount: totalRecords,
      };
    } catch (s3Error) {
      const s3ErrorMsg = s3Error instanceof Error ? s3Error.message : 'Unknown S3 error';
      observabilityLogger.error('Failed to upload export to S3', s3Error, { s3Key });

      // If S3 is not configured, return error
      if (s3ErrorMsg.includes('Missing required environment variable')) {
        return {
          success: false,
          error: 'S3 storage not configured - cannot store export',
        };
      }

      return { success: false, error: `S3 upload failed: ${s3ErrorMsg}` };
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    observabilityLogger.error('Failed to export tenant data', error, {
      tenantId,
      exportId,
    });
    return { success: false, error: errorMsg };
  }
}
