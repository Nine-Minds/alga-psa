/**
 * Xero CSV Tax Import API Routes
 * POST /api/v1/accounting-exports/xero-csv/tax-import - Upload and process Xero Invoice Details Report
 * POST /api/v1/accounting-exports/xero-csv/tax-import?preview=true - Preview import without applying
 *
 * This endpoint handles CSV file uploads from Xero's Invoice Details Report
 * and imports tax amounts back into Alga PSA invoices.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { getXeroCsvTaxImportService } from 'server/src/lib/services/xeroCsvTaxImportService';
import logger from '@shared/core/logger';

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check permissions
    const canManageBilling = await hasPermission(user, 'billing:manage');
    if (!canManageBilling) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Check if this is a preview request
    const isPreview = request.nextUrl.searchParams.get('preview') === 'true';

    // Parse the request body
    const contentType = request.headers.get('content-type') ?? '';
    let csvContent: string;

    if (contentType.includes('multipart/form-data')) {
      // Handle file upload
      const formData = await request.formData();
      const file = formData.get('file') as File | null;

      if (!file) {
        return NextResponse.json(
          { error: 'No file provided. Please upload a CSV file.' },
          { status: 400 }
        );
      }

      // Validate file type
      if (!file.name.endsWith('.csv') && file.type !== 'text/csv') {
        return NextResponse.json(
          { error: 'Invalid file type. Please upload a CSV file.' },
          { status: 400 }
        );
      }

      // Read file content
      const arrayBuffer = await file.arrayBuffer();
      csvContent = new TextDecoder('utf-8').decode(arrayBuffer);
    } else if (contentType.includes('application/json')) {
      // Handle JSON body with csvContent field
      const body = await request.json();
      csvContent = body.csvContent;

      if (!csvContent) {
        return NextResponse.json(
          { error: 'No CSV content provided' },
          { status: 400 }
        );
      }
    } else if (contentType.includes('text/csv') || contentType.includes('text/plain')) {
      // Handle raw CSV body
      csvContent = await request.text();
    } else {
      return NextResponse.json(
        { error: 'Unsupported content type. Please provide a CSV file or JSON with csvContent.' },
        { status: 400 }
      );
    }

    // Validate CSV content
    if (!csvContent || csvContent.trim().length === 0) {
      return NextResponse.json(
        { error: 'Empty CSV content' },
        { status: 400 }
      );
    }

    const service = getXeroCsvTaxImportService();

    if (isPreview) {
      // Preview mode - parse and match without applying
      const preview = await service.previewTaxImport(csvContent);

      logger.info('[XeroCsvTaxImport] Preview generated', {
        userId: user.user_id,
        invoiceCount: preview.invoiceCount,
        matchedCount: preview.matchedCount
      });

      return NextResponse.json({
        success: true,
        preview
      });
    } else {
      // Execute import
      const result = await service.importTaxFromReport(csvContent, user.user_id);

      logger.info('[XeroCsvTaxImport] Import executed', {
        userId: user.user_id,
        totalProcessed: result.totalProcessed,
        successCount: result.successCount,
        failureCount: result.failureCount
      });

      return NextResponse.json({
        success: result.success,
        result
      });
    }
  } catch (error: any) {
    logger.error('[XeroCsvTaxImport] Error', { error: error.message });
    return NextResponse.json(
      { error: error.message ?? 'Internal server error' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
