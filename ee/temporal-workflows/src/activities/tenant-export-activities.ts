/**
 * Tenant Data Export Activities for Temporal Workflows
 *
 * These activities handle exporting tenant data for:
 * - GDPR data requests
 * - Customer data backups
 * - Migration to other systems
 * - Audit/compliance purposes
 *
 * This is an EE-only feature for Nine Minds internal use via the tenant management extension.
 */

import { Context } from '@temporalio/activity';
import { getAdminConnection } from '@alga-psa/db/admin.js';
import { Knex } from 'knex';
import type {
  ExportTenantDataInput,
  ExportTenantDataResult,
  GetExportDownloadUrlInput,
  GetExportDownloadUrlResult,
} from '../types/tenant-export-types.js';

const logger = () => Context.current().log;

/**
 * Tables to export for tenant data export.
 * Focuses on business data, excludes system/config tables.
 */
const TENANT_TABLES_EXPORT_ORDER: string[] = [
  // Core business data
  'users',
  'contacts',
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
  const log = logger();
  const { tenantId, requestedBy, reason, exportId: providedExportId } = input;
  // Use provided exportId (from workflow) or generate a new one
  const exportId = providedExportId || crypto.randomUUID();

  log.info('Starting tenant data export', {
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
        tenantName: tenant.client_name,
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
            log.info(`Exported ${records.length} records from ${tableName}`);
          }
        }
      } catch (error) {
        // Log but continue - some tables may not exist
        log.debug(`Could not export ${tableName}`, {
          error: error instanceof Error ? error.message : 'Unknown',
        });
      }
    }

    exportData._metadata.totalRecords = totalRecords;
    exportData._metadata.tableCount = tableCount;

    // Convert to JSON
    const jsonContent = JSON.stringify(exportData, null, 2);
    const jsonBuffer = Buffer.from(jsonContent, 'utf-8');

    log.info('Export data collected', {
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
      const s3Module = await import('@ee/lib/storage/s3-client.js');
      const { putObject, getBucket } = s3Module;

      await putObject(s3Key, jsonBuffer, {
        contentType: 'application/json',
      });

      const bucket = getBucket();

      log.info('Tenant data export completed', {
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
      log.error('Failed to upload export to S3', { error: s3ErrorMsg });

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
    log.error('Failed to export tenant data', {
      error: errorMsg,
      tenantId,
      exportId,
    });
    return { success: false, error: errorMsg };
  }
}

/**
 * Generate a new presigned download URL for an existing export.
 * Use this to get a fresh download link for a previously created export.
 *
 * @param input - Parameters including tenantId and exportId
 * @returns New presigned download URL
 */
export async function getExportDownloadUrl(
  input: GetExportDownloadUrlInput
): Promise<GetExportDownloadUrlResult> {
  const log = logger();
  const { tenantId, exportId, expiresIn = 3600 } = input; // 1 hour default

  log.info('Generating download URL for export', {
    tenantId,
    exportId,
    expiresIn,
  });

  try {
    const s3Key = `tenant-exports/${tenantId}/${exportId}.json`;

    // Dynamically import S3 client
    const s3Module = await import('@ee/lib/storage/s3-client.js');
    const { headObject, getPresignedGetUrl } = s3Module;

    // Verify the export exists
    const exists = await headObject(s3Key);
    if (!exists.exists) {
      return {
        success: false,
        error: `Export not found: ${exportId}`,
      };
    }

    // Generate new presigned URL
    const downloadUrl = await getPresignedGetUrl(s3Key, expiresIn);
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    log.info('Download URL generated', {
      tenantId,
      exportId,
      expiresAt,
    });

    return {
      success: true,
      downloadUrl,
      expiresAt,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to generate download URL', {
      error: errorMsg,
      tenantId,
      exportId,
    });
    return { success: false, error: errorMsg };
  }
}
