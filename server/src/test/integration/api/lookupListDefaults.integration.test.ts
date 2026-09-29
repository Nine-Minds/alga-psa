import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { ApiBaseController, type AuthenticatedApiRequest } from '../../../lib/api/controllers/ApiBaseController';
import { PriorityService } from '../../../lib/api/services/PriorityService';
import { StatusService } from '../../../lib/api/services/StatusService';
import { priorityListQuerySchema } from '../../../lib/api/schemas/priority';
import { statusListQuerySchema } from '../../../lib/api/schemas/status';

vi.mock('next/server', async () => ({
  ...await import('next/dist/server/web/spec-extension/request'),
  ...await import('next/dist/server/web/spec-extension/response'),
}));

let db: Knex;
let context: { tenant: string; userId: string };

// HTTP authorization is exercised by the built-app API suite. Here the real
// controller, query validation, service and migrated database remain in use.
class LookupController extends ApiBaseController {
  protected async authenticate(req: NextRequest) {
    return Object.assign(req, { context }) as AuthenticatedApiRequest;
  }
  protected async checkPermission() {}
  protected async runWithApiKeyContext<T>(_req: AuthenticatedApiRequest, callback: () => Promise<T>): Promise<T> {
    return callback();
  }
}

beforeAll(async () => {
  db = await createTestDbConnection();
  const tenant = await db('tenants').first<{ tenant: string }>('tenant');
  const user = await db('users').where({ tenant: tenant!.tenant }).first<{ user_id: string }>('user_id');
  context = { tenant: tenant!.tenant, userId: user!.user_id };
});

afterAll(async () => { await db?.destroy(); });

it.each(['priority', 'status'] as const)('searches %s names on the migrated schema and honors display ordering', async (resource) => {
  const priority = resource === 'priority';
  const table = priority ? 'priorities' : 'statuses';
  const idColumn = priority ? 'priority_id' : 'status_id';
  const nameColumn = priority ? 'priority_name' : 'name';
  const prefix = `Lookup regression ${randomUUID()}`;
  const ids = [randomUUID(), randomUUID()];
  const maximum = await db(table).where({ tenant: context.tenant }).max<{ value: string | number | null }>('order_number as value').first();
  const low = Number(maximum?.value ?? 0) + 1;
  const high = low + 9;
  await db(table).insert([high, low].map((order, index) => ({
    [idColumn]: ids[index], tenant: context.tenant,
    [nameColumn]: `${prefix} ${index}`, order_number: order, created_by: context.userId,
    ...(priority ? { item_type: 'ticket' } : { item_type: 'project', status_type: 'project', is_closed: false, is_default: false }),
  })));

  try {
    const service = priority ? new PriorityService() : new StatusService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: context.tenant });
    const controller = new LookupController(service, {
      resource, querySchema: priority ? priorityListQuerySchema : statusListQuerySchema,
    });
    const url = `http://localhost/api/v1/${table}?search=${encodeURIComponent(prefix)}`;
    const response = await controller.list()(new NextRequest(url));
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    const body = await response.json();
    expect(body.data.map((row: { order_number: number }) => row.order_number)).toEqual([low, high]);
    expect(body.pagination.total).toBe(2);
    expect(body.data.map((row: Record<string, unknown>) => row[idColumn])).toEqual([ids[1], ids[0]]);

    const descending = await controller.list()(new NextRequest(`${url}&sort=order_number&order=desc`));
    expect(descending.status).toBe(200);
    expect((await descending.json()).data.map((row: { order_number: number }) => row.order_number)).toEqual([high, low]);
  } finally {
    await db(table).where({ tenant: context.tenant }).whereIn(idColumn, ids).delete();
  }
});
