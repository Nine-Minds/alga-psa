/**
 * Platform Reports Schema API - Dynamic schema discovery
 *
 * GET /api/v1/platform-reports/schema - Get available tables and columns
 *
 * Returns the database schema filtered by the security blocklist.
 * This allows the UI to dynamically populate table/column dropdowns
 * without hardcoding the schema in client code.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';
import { getAdminConnection } from '@alga-psa/shared/db/admin';
import {
  isTableAllowed,
  isColumnAllowed,
} from '@ee/lib/platformReports/blocklist';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID;

interface TableSchema {
  name: string;
  columns: string[];
}

/**
 * Verify the caller has access to platform reports schema.
 * Supports both API key auth and session auth.
 */
async function assertMasterTenantAccess(request: NextRequest): Promise<void> {
  if (!MASTER_BILLING_TENANT_ID) {
    throw new Error('MASTER_BILLING_TENANT_ID not configured on server');
  }

  // API KEY AUTH
  const apiKey = request.headers.get('x-api-key');

  if (apiKey) {
    const keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
    if (keyRecord) {
      if (keyRecord.tenant === MASTER_BILLING_TENANT_ID) {
        return; // Auth OK
      }
      throw new Error('Access denied: API key not authorized for platform reports');
    }
    console.warn('[platform-reports/schema] Invalid API key');
  }

  // SESSION AUTH
  const user = await getCurrentUser();

  if (!user) {
    throw new Error('Authentication required');
  }

  if (user.tenant !== MASTER_BILLING_TENANT_ID) {
    throw new Error('Access denied: Platform reports require master tenant access');
  }
}

/**
 * GET /api/v1/platform-reports/schema
 * Discover available tables and columns for report building
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await assertMasterTenantAccess(request);

    const knex = await getAdminConnection();

    // Query all user tables from information_schema
    const tablesResult = await knex('information_schema.tables')
      .select('table_name')
      .where('table_schema', 'public')
      .where('table_type', 'BASE TABLE')
      .orderBy('table_name');

    // Filter tables through blocklist
    const allowedTables = tablesResult
      .map(row => row.table_name as string)
      .filter(tableName => isTableAllowed(tableName));

    // Get columns for each allowed table
    const schema: TableSchema[] = [];

    for (const tableName of allowedTables) {
      const columnsResult = await knex('information_schema.columns')
        .select('column_name')
        .where('table_schema', 'public')
        .where('table_name', tableName)
        .orderBy('ordinal_position');

      // Filter columns through blocklist
      const allowedColumns = columnsResult
        .map(row => row.column_name as string)
        .filter(columnName => isColumnAllowed(tableName, columnName));

      schema.push({
        name: tableName,
        columns: allowedColumns,
      });
    }

    return NextResponse.json({
      success: true,
      data: { tables: schema },
    });
  } catch (error) {
    console.error('[platform-reports/schema] GET error:', error);

    if (error instanceof Error) {
      if (
        error.message.includes('Access denied') ||
        error.message.includes('Authentication')
      ) {
        return NextResponse.json(
          { success: false, error: error.message },
          { status: 403 }
        );
      }
    }

    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
