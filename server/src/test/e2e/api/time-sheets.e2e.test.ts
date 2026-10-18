import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tenantDb } from '@alga-psa/db';
import { v4 as uuidv4 } from 'uuid';
import { setupE2ETestEnvironment, E2ETestEnvironment } from '../utils/e2eTestSetup';
import { assertSuccess, assertError } from '../utils/apiTestHelpers';
import { grantTestUserPermission } from '../utils/simpleRoleSetup';

const API_BASE = '/api/v1/time-sheets';

/**
 * Regression for #3205: GET /api/v1/time-sheets used to 500 (INTERNAL_CONFIGURATION)
 * because the default sort referenced the nonexistent time_sheets.created_at.
 */
describe('Time Sheets API E2E (list read path)', () => {
  let env: E2ETestEnvironment;
  const tenantTable = (table: string) => tenantDb(env.db, env.tenant).table(table);

  beforeEach(async () => {
    env = await setupE2ETestEnvironment();
    // setupTestUserWithPermissions does not grant time_sheet; list/search/export all check time_sheet:read.
    await grantTestUserPermission(env.db, env.userId, env.tenant, 'time_sheet', 'read');
    const periodId = uuidv4();
    await tenantTable('time_periods').insert({
      period_id: periodId,
      tenant: env.tenant,
      start_date: '2031-06-01',
      end_date: '2031-06-08',
    });
    await tenantTable('time_sheets').insert({
      id: uuidv4(),
      tenant: env.tenant,
      period_id: periodId,
      user_id: env.userId,
      approval_status: 'DRAFT',
    });
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it('GET with no sort returns 200 and paginated data', async () => {
    const res = await env.apiClient.get(API_BASE);
    assertSuccess(res);
    expect(Array.isArray(res.data.data)).toBe(true);
    expect(res.data.data.length).toBeGreaterThanOrEqual(1);
  });

  it('GET with an allowlisted sort returns 200', async () => {
    assertSuccess(await env.apiClient.get(`${API_BASE}?sort=approved_at&order=asc`));
  });

  it('GET with an unknown sort returns 400 VALIDATION_ERROR, not 500', async () => {
    const res = await env.apiClient.get(`${API_BASE}?sort=bogus`);
    assertError(res, 400, 'VALIDATION_ERROR');
  });

  it('GET /search returns 200', async () => {
    assertSuccess(await env.apiClient.get(`${API_BASE}/search`));
  });

  it('GET /export returns 200', async () => {
    assertSuccess(await env.apiClient.get(`${API_BASE}/export?format=json`));
  });
});
