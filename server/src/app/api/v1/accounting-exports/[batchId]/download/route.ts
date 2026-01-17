/**
 * Accounting Export Download API Route
 * GET /api/v1/accounting-exports/[batchId]/download - Download export file (CSV/IIF)
 *
 * This endpoint supports file-based accounting adapters (xero_csv, quickbooks_desktop)
 * by regenerating the export file from stored batch data.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { AccountingExportService } from 'server/src/lib/services/accountingExportService';
import { AccountingAdapterRegistry } from 'server/src/lib/adapters/accounting/registry';
import {
  AccountingExportAdapterContext,
  TaxDelegationMode
} from 'server/src/lib/adapters/accounting/accountingExportAdapter';
import { getXeroCsvSettings } from 'server/src/lib/actions/integrations/xeroCsvActions';
import logger from '@alga-psa/core/logger';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const { batchId } = await params;

    // Check authentication
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check permissions
    const canManageBilling = await hasPermission(user, 'billing_settings', 'update');
    if (!canManageBilling) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get batch data
    const service = await AccountingExportService.create();
    const { batch, lines } = await service.getBatchWithDetails(batchId);

    if (!batch) {
      return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
    }

    // Verify batch belongs to current tenant
    const { tenant } = await createTenantKnex();
    if (batch.tenant !== tenant) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get the adapter
    const registry = await AccountingAdapterRegistry.createDefault();
    const adapter = registry.get(batch.adapter_type);

    if (!adapter) {
      return NextResponse.json(
        { error: `Unknown adapter type: ${batch.adapter_type}` },
        { status: 400 }
      );
    }

    // Check if adapter supports file-based delivery
    const capabilities = adapter.capabilities();
    if (capabilities.deliveryMode !== 'file') {
      return NextResponse.json(
        { error: 'This adapter does not support file downloads' },
        { status: 400 }
      );
    }

    // Load adapter-specific settings
    let adapterSettings: Record<string, unknown> | undefined;
    if (batch.adapter_type === 'xero_csv') {
      try {
        const xeroCsvSettings = await getXeroCsvSettings();
        adapterSettings = {
          dateFormat: xeroCsvSettings.dateFormat,
          defaultCurrency: xeroCsvSettings.defaultCurrency
        };
      } catch (error) {
        logger.warn('[AccountingExportDownload] Failed to load Xero CSV settings, using defaults', {
          error: (error as Error).message
        });
      }
    }

    // Regenerate the file content by running transform
    const context: AccountingExportAdapterContext = {
      batch,
      lines,
      taxDelegationMode: 'none' as TaxDelegationMode, // Use none for regeneration
      excludeTaxFromExport: false,
      adapterSettings
    };

    const transformResult = await adapter.transform(context);

    const file = transformResult.files?.[0];
    if (!file) {
      return NextResponse.json(
        { error: 'No file generated for this batch' },
        { status: 404 }
      );
    }

    logger.info('[AccountingExportDownload] Serving file', {
      batchId,
      filename: file.filename,
      contentType: file.contentType,
      size: file.content.length
    });

    // Return the file with appropriate headers
    return new NextResponse(file.content, {
      status: 200,
      headers: {
        'Content-Type': file.contentType,
        'Content-Disposition': `attachment; filename="${file.filename}"`,
        'Content-Length': file.content.length.toString()
      }
    });
  } catch (error: any) {
    logger.error('[AccountingExportDownload] Error', { error: error.message });
    return NextResponse.json(
      { error: error.message ?? 'Internal server error' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
