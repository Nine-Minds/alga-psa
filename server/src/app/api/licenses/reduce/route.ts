import { NextRequest, NextResponse } from 'next/server';
import { getSession } from 'server/src/lib/auth/getSession';
import { reduceLicenseCount } from 'server/src/lib/actions/license-actions';
import logger from '@alga-psa/shared/core/logger';

/**
 * POST /api/licenses/reduce
 * Reduce license count with validation
 *
 * Required Permission: account_management.update
 *
 * Body: { newQuantity: number }
 *
 * Returns:
 * - Success: { success: true, data: { scheduledChange, effectiveDate, currentQuantity, newQuantity } }
 * - Validation error: { success: false, error, needsDeactivation?, activeUserCount?, requestedQuantity? }
 */
export async function POST(req: NextRequest) {
  try {
    // Authenticate user
    const session = await getSession();

    if (!session?.user?.tenant) {
      return NextResponse.json(
        { success: false, error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // TODO: Add permission check for account_management.update
    // For now, we'll proceed if authenticated
    // if (!hasPermission(session.user, 'account_management.update')) {
    //   return NextResponse.json(
    //     { success: false, error: 'Insufficient permissions' },
    //     { status: 403 }
    //   );
    // }

    // Parse request body
    const body = await req.json();
    const { newQuantity } = body;

    // Validate input
    if (typeof newQuantity !== 'number') {
      return NextResponse.json(
        { success: false, error: 'newQuantity must be a number' },
        { status: 400 }
      );
    }

    logger.info(
      `[POST /api/licenses/reduce] User ${session.user.id} requesting license reduction for tenant ${session.user.tenant} to ${newQuantity}`
    );

    // Call the license reduction action
    const result = await reduceLicenseCount(session.user.tenant, newQuantity);

    // Return appropriate status code based on result
    if (!result.success) {
      // Validation errors are business logic errors, not server errors
      const statusCode = result.needsDeactivation ? 400 : 422;
      return NextResponse.json(result, { status: statusCode });
    }

    return NextResponse.json(result);

  } catch (error) {
    logger.error('[POST /api/licenses/reduce] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
