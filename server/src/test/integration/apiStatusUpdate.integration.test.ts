import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { StatusService } from '../../lib/api/services/StatusService';

describe('status service audit field integration', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection();
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  it('creates and updates a status when the table has no update audit columns', async () => {
    const tenant = await db('tenants').first<{ tenant: string }>('tenant');
    expect(tenant).toBeDefined();

    const user = await tenantDb(db, tenant!.tenant)
      .table('users')
      .first<{ user_id: string }>('user_id');
    expect(user).toBeDefined();

    const service = new StatusService();
    const context = {
      tenant: tenant!.tenant,
      userId: user!.user_id,
    };
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: tenant!.tenant });

    const [{ maxOrder }] = await tenantDb(db, tenant!.tenant)
      .table('statuses')
      .max<{ maxOrder: string | number | null }>('order_number as maxOrder');
    const orderNumber = Number(maxOrder ?? 0) + 100;
    const originalName = `API status audit regression ${Date.now()}`;
    const updatedName = `${originalName} updated`;

    const created = await service.create({
      name: originalName,
      status_type: 'project',
      item_type: 'project',
      is_closed: false,
      is_default: false,
      order_number: orderNumber,
    }, context);

    try {
      expect(created).toMatchObject({
        name: originalName,
        created_by: user!.user_id,
      });

      const updated = await service.update(created.status_id, { name: updatedName }, context);
      expect(updated.name).toBe(updatedName);

      const persisted = await tenantDb(db, tenant!.tenant)
        .table('statuses')
        .where({ status_id: created.status_id })
        .first();
      expect(persisted?.name).toBe(updatedName);
    } finally {
      await tenantDb(db, tenant!.tenant)
        .table('statuses')
        .where({ status_id: created.status_id })
        .delete();
    }
  });
});
