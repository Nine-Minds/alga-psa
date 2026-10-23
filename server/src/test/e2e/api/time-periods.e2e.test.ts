import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tenantDb } from '@alga-psa/db';
import { v4 as uuidv4 } from 'uuid';
import { setupE2ETestEnvironment, E2ETestEnvironment } from '../utils/e2eTestSetup';
import { ApiTestClient, assertSuccess, assertError } from '../utils/apiTestHelpers';

const API_BASE = '/api/v1/time-periods';

describe('Time Periods API E2E Tests', () => {
  let env: E2ETestEnvironment;

  const tenantTable = (table: string) => tenantDb(env.db, env.tenant).table(table);

  beforeEach(async () => {
    env = await setupE2ETestEnvironment();
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it('POST creates a period (201) and GET shows it with date-only fields', async () => {
    const created = await env.apiClient.post(API_BASE, {
      start_date: '2031-03-01',
      end_date: '2031-03-08',
      is_current: true, // accepted and ignored
    });
    assertSuccess(created, 201);
    expect(created.data.data).toMatchObject({
      start_date: '2031-03-01',
      end_date: '2031-03-08',
      is_current: false,
      is_closed: false,
    });

    const id = created.data.data.period_id;
    const fetched = await env.apiClient.get(`${API_BASE}/${id}`);
    assertSuccess(fetched);
    expect(fetched.data.data).toMatchObject({ period_id: id, start_date: '2031-03-01', end_date: '2031-03-08' });

    const overlap = await env.apiClient.post(API_BASE, { start_date: '2031-03-05', end_date: '2031-03-12' });
    assertError(overlap, 409);
  });

  it('close/reopen round-trip flips is_closed and gates PUT', async () => {
    const created = await env.apiClient.post(API_BASE, { start_date: '2031-04-01', end_date: '2031-04-08' });
    assertSuccess(created, 201);
    const id = created.data.data.period_id;

    const closed = await env.apiClient.post(`${API_BASE}/${id}/close`);
    assertSuccess(closed);
    expect(closed.data.data.is_closed).toBe(true);
    expect((await tenantTable('time_periods').where({ period_id: id }).first()).is_closed).toBe(true);

    assertError(await env.apiClient.put(`${API_BASE}/${id}`, { end_date: '2031-04-09' }), 409);

    const reopened = await env.apiClient.post(`${API_BASE}/${id}/reopen`);
    assertSuccess(reopened);
    expect(reopened.data.data.is_closed).toBe(false);

    const updated = await env.apiClient.put(`${API_BASE}/${id}`, { end_date: '2031-04-09' });
    assertSuccess(updated);
    expect(updated.data.data.end_date).toBe('2031-04-09');

    assertError(await env.apiClient.post(`${API_BASE}/${uuidv4()}/close`), 404);
  });

  it('returns 403 for close/reopen without time_period:update', async () => {
    const created = await env.apiClient.post(API_BASE, { start_date: '2031-05-01', end_date: '2031-05-08' });
    assertSuccess(created, 201);
    const id = created.data.data.period_id;

    const restrictedUserId = uuidv4();
    await tenantTable('users').insert({
      user_id: restrictedUserId,
      tenant: env.tenant,
      username: `restricted_${restrictedUserId}`,
      email: `restricted${restrictedUserId}@example.com`,
      first_name: 'Restricted',
      last_name: 'User',
      hashed_password: 'dummy',
      created_at: new Date(),
      user_type: 'internal',
    });
    const plaintextKey = `test_${uuidv4()}`;
    await tenantTable('api_keys').insert({
      api_key_id: uuidv4(),
      api_key: require('crypto').createHash('sha256').update(plaintextKey).digest('hex'),
      user_id: restrictedUserId,
      tenant: env.tenant,
      created_at: new Date(),
      active: true,
    });
    const restricted = new ApiTestClient({ baseUrl: env.apiClient['config'].baseUrl, apiKey: plaintextKey });

    assertError(await restricted.post(`${API_BASE}/${id}/close`), 403);
    assertError(await restricted.post(`${API_BASE}/${id}/reopen`), 403);
    expect((await tenantTable('time_periods').where({ period_id: id }).first()).is_closed).toBe(false);
  });
});
