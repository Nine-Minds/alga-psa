/**
 * Xero CSV Client Export API Routes
 * GET /api/v1/accounting-exports/xero-csv/client-export - Export clients to Xero Contacts CSV
 *
 * This endpoint generates a CSV file containing Alga clients in Xero Contacts import format.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { getXeroCsvClientSyncService } from 'server/src/lib/services/xeroCsvClientSyncService';
import logger from '@shared/core/logger';

export async function GET(request: NextRequest) {
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

    // Get optional client IDs from query params
    const clientIdsParam = request.nextUrl.searchParams.get('clientIds');
    const clientIds = clientIdsParam ? clientIdsParam.split(',').filter(Boolean) : undefined;

    const service = getXeroCsvClientSyncService();
    const result = await service.exportClientsToXeroCsv(clientIds);

    logger.info('[XeroCsvClientExport] Export generated', {
      userId: user.user_id,
      clientCount: result.clientCount,
      filename: result.filename
    });

    // Return as downloadable CSV file
    return new NextResponse(result.csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${result.filename}"`,
        'X-Client-Count': result.clientCount.toString(),
        'X-Exported-At': result.exportedAt
      }
    });
  } catch (error: any) {
    logger.error('[XeroCsvClientExport] Error', { error: error.message });
    return NextResponse.json(
      { error: error.message ?? 'Internal server error' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
