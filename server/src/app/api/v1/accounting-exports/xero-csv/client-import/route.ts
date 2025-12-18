/**
 * Xero CSV Client Import API Routes
 * POST /api/v1/accounting-exports/xero-csv/client-import - Import Xero Contacts CSV
 * POST /api/v1/accounting-exports/xero-csv/client-import?preview=true - Preview import
 *
 * This endpoint handles CSV file uploads containing Xero Contacts
 * and imports them into Alga as clients (matching, updating, or creating as configured).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { getXeroCsvClientSyncService, ClientImportOptions } from 'server/src/lib/services/xeroCsvClientSyncService';
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

    // Parse import options from query params
    const options: Partial<ClientImportOptions> = {
      createNewClients: request.nextUrl.searchParams.get('createNew') === 'true',
      updateExistingClients: request.nextUrl.searchParams.get('updateExisting') !== 'false',
      matchBy: (request.nextUrl.searchParams.get('matchBy') as 'name' | 'email' | 'xero_id') ?? 'name'
    };

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

      // Override options from form data if provided
      const createNewParam = formData.get('createNew');
      const updateExistingParam = formData.get('updateExisting');
      const matchByParam = formData.get('matchBy');

      if (createNewParam !== null) {
        options.createNewClients = createNewParam === 'true';
      }
      if (updateExistingParam !== null) {
        options.updateExistingClients = updateExistingParam !== 'false';
      }
      if (matchByParam !== null) {
        options.matchBy = matchByParam as 'name' | 'email' | 'xero_id';
      }
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

      // Override options from JSON body
      if (body.options) {
        if (body.options.createNewClients !== undefined) {
          options.createNewClients = body.options.createNewClients;
        }
        if (body.options.updateExistingClients !== undefined) {
          options.updateExistingClients = body.options.updateExistingClients;
        }
        if (body.options.matchBy !== undefined) {
          options.matchBy = body.options.matchBy;
        }
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

    const service = getXeroCsvClientSyncService();

    if (isPreview) {
      // Preview mode - parse and match without applying
      const preview = await service.previewClientImport(csvContent, options);

      logger.info('[XeroCsvClientImport] Preview generated', {
        userId: user.user_id,
        totalRows: preview.totalRows,
        toCreate: preview.toCreate,
        toUpdate: preview.toUpdate,
        toSkip: preview.toSkip
      });

      return NextResponse.json({
        success: true,
        preview
      });
    } else {
      // Execute import
      const result = await service.importClients(csvContent, options, user.user_id);

      logger.info('[XeroCsvClientImport] Import executed', {
        userId: user.user_id,
        totalProcessed: result.totalProcessed,
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        errors: result.errors.length
      });

      return NextResponse.json({
        success: result.errors.length === 0,
        result
      });
    }
  } catch (error: any) {
    logger.error('[XeroCsvClientImport] Error', { error: error.message });
    return NextResponse.json(
      { error: error.message ?? 'Internal server error' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
