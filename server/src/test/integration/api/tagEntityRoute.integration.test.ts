import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import type { ServiceContext } from '@alga-psa/db';

import { createTestDbConnection, wireLocalTestDbEnv } from '../../../../test-utils/dbConfig';
import { createTestApiKey } from '../../e2e/utils/apiTestHelpers';

const connection = vi.hoisted(() => ({ db: null as Knex | null, tenant: '' }));

function activeConnection(): Knex {
  if (!connection.db) throw new Error('The tag route test database is not initialized');
  return connection.db;
}

type KnexProvidingService = {
  getKnex: () => Promise<{ knex: Knex; tenant: string }>;
};

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: async (tenant?: string) => ({ knex: activeConnection(), tenant: tenant ?? connection.tenant }),
    getConnection: async () => activeConnection(),
  };
});

vi.mock('../../../lib/db/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../lib/db/db')>(),
  getConnection: async () => activeConnection(),
}));

vi.mock('../../../lib/api/rateLimit/enforce', () => ({ enforceApiRateLimit: async () => null }));
vi.mock('../../../lib/auth/rbac', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../lib/auth/rbac')>(),
  hasPermission: async () => true,
}));
vi.mock('@/lib/productAccess', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/productAccess')>(),
  getTenantProduct: async () => 'psa',
}));

import {
  DELETE as untagTicket,
  GET as readTicketTags,
  POST as tagTicket,
  PUT as replaceTicketTags,
} from '../../../app/api/v1/tags/entity/[entityType]/[entityId]/route';
import { POST as bulkTagEntities } from '../../../app/api/v1/tags/bulk/tag/route';
import { TagService } from '@/lib/api/services/TagService';

let db: Knex;
let tenant: string;
let userId: string;
let apiKey: string;
let trx: Knex.Transaction;

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection();
  const tenantRow = await db('tenants').first<{ tenant: string }>('tenant');
  if (!tenantRow) throw new Error('The migrated tag route test database has no tenant fixture');
  tenant = tenantRow.tenant;
});

beforeEach(async () => {
  trx = await db.transaction();
  connection.db = trx;
  connection.tenant = tenant;
  vi.spyOn(TagService.prototype as unknown as KnexProvidingService, 'getKnex').mockResolvedValue({ knex: trx, tenant });
  userId = randomUUID();
  await trx('users').insert({
    tenant,
    user_id: userId,
    username: `tag-api-${userId}`,
    email: `${userId}@example.test`,
    first_name: 'Tag API',
    last_name: 'Test',
    hashed_password: 'tag-api-integration-test',
    user_type: 'internal',
    is_inactive: false,
  });
  apiKey = (await createTestApiKey(trx, userId, tenant)).api_key;
});

afterEach(async () => {
  await trx.rollback();
  connection.db = null;
  connection.tenant = '';
});

afterAll(async () => {
  await db?.destroy();
});

function routeRequest(method: string, ticketId: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/v1/tags/entity/ticket/${ticketId}`, {
    method,
    headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function service() {
  const instance = new TagService();
  vi.spyOn(instance as unknown as KnexProvidingService, 'getKnex').mockResolvedValue({ knex: trx, tenant });
  return instance;
}

function databaseErrorDescription(error: unknown): string {
  const dbError = error as { code?: string; column?: string; table?: string; message?: string; detail?: string };
  return `database error code=${dbError.code ?? 'unknown'} table=${dbError.table ?? 'unknown'} column=${dbError.column ?? 'unknown'}: ${dbError.message ?? String(error)} ${dbError.detail ?? ''}`;
}

describe('REST tag entity route against the migrated database schema', () => {
  it('authenticates with an API key, tags a ticket, and reads the tag back through REST', async () => {
    const ticketId = randomUUID();
    const postResponse = await tagTicket(routeRequest('POST', ticketId, {
      entity_id: ticketId,
      entity_type: 'ticket',
      tags: ['rest-schema-proof'],
    }));

    expect(postResponse.status).toBe(201);
    const postBody = await postResponse.json();
    expect(postBody.data.tags).toHaveLength(1);
    expect(postBody.data.tags[0]).toMatchObject({
      tag_text: 'rest-schema-proof',
      tagged_id: ticketId,
      tagged_type: 'ticket',
      background_color: expect.any(String),
      text_color: expect.any(String),
      tenant,
    });

    const getResponse = await readTicketTags(routeRequest('GET', ticketId));
    expect(getResponse.status).toBe(200);
    const getBody = await getResponse.json();
    expect(getBody.data.tags).toHaveLength(1);
    expect(getBody.data.tags[0]).toMatchObject({
      tag_text: 'rest-schema-proof',
      tagged_id: ticketId,
      tagged_type: 'ticket',
      tenant,
    });
    expect(getBody.data.tags[0].board_id === null || typeof getBody.data.tags[0].board_id === 'string').toBe(true);
  });

  it('runs tag, untag, and replacement read-backs in one rolled-back schema contract', async () => {
    const ticketId = randomUUID();
    const tagService = service();
    const context: ServiceContext = { tenant, userId };

    try {
      const [created] = await tagService.tagEntity(ticketId, 'ticket', ['contract-first'], {}, context);
      expect(created.tag_text).toBe('contract-first');

      await tagService.untagEntity(ticketId, 'ticket', [created.tag_id], context);

      const replaced = await tagService.replaceEntityTags(
        ticketId,
        'ticket',
        ['contract-replacement'],
        {},
        context,
      );
      expect(replaced.map((tag) => tag.tag_text)).toEqual(['contract-replacement']);
    } catch (error) {
      throw new Error(`Tag entity schema contract failed: ${databaseErrorDescription(error)}`, { cause: error });
    }
  });

  it('untags a mapping through the API-key route and leaves no mapping behind', async () => {
    const ticketId = randomUUID();
    const created = await tagTicket(routeRequest('POST', ticketId, {
      entity_id: ticketId,
      entity_type: 'ticket',
      tags: ['rest-remove'],
    }));
    const tagId = (await created.json()).data.tags[0].tag_id as string;

    const response = await untagTicket(routeRequest('DELETE', ticketId, {
      entity_id: ticketId,
      entity_type: 'ticket',
      tag_ids: [tagId],
    }));
    expect(response.status).toBe(200);
    const readBack = await readTicketTags(routeRequest('GET', ticketId));
    expect((await readBack.json()).data.tags).toEqual([]);
  });

  it('replaces a ticket tag set through the API-key route', async () => {
    const ticketId = randomUUID();
    const initial = await tagTicket(routeRequest('POST', ticketId, {
      entity_id: ticketId,
      entity_type: 'ticket',
      tags: ['replace-old'],
    }));
    expect(initial.status).toBe(201);

    const response = await replaceTicketTags(routeRequest('PUT', ticketId, {
      entity_id: ticketId,
      entity_type: 'ticket',
      tags: ['replace-new'],
    }));
    expect(response.status).toBe(200);

    const readBack = await readTicketTags(routeRequest('GET', ticketId));
    expect((await readBack.json()).data.tags.map((tag: { tag_text: string }) => tag.tag_text)).toEqual(['replace-new']);
  });

  it('uses the same schema-safe tagging path for bulk/tag', async () => {
    const ticketId = randomUUID();
    const response = await bulkTagEntities(new NextRequest('http://localhost/api/v1/tags/bulk/tag', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        entities: [{ entity_id: ticketId, entity_type: 'ticket' }],
        tags: ['rest-bulk-schema-proof'],
      }),
    }));
    expect(response.status).toBe(201);

    const readBack = await readTicketTags(routeRequest('GET', ticketId));
    expect((await readBack.json()).data.tags.map((tag: { tag_text: string }) => tag.tag_text))
      .toEqual(['rest-bulk-schema-proof']);
  });
});
