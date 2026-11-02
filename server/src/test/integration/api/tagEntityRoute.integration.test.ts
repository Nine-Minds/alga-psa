import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import type { ServiceContext } from '@alga-psa/db';

import { createTestDbConnection, wireLocalTestDbEnv } from '../../../../test-utils/dbConfig';
import { createTestApiKey } from '../../e2e/utils/apiTestHelpers';
import { createTestTicket } from '../../e2e/utils/ticketTestData';
import { createClient } from '../../../../test-utils/testDataFactory';
import TagMapping from '@alga-psa/tags/models/tagMapping';
import { withRolledBackSchemaContract } from './helpers/withRolledBackSchemaContract';

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
import { GET as readTagById } from '../../../app/api/v1/tags/[id]/route';
import { TagService } from '@/lib/api/services/TagService';

let db: Knex;
let tenant: string;
let userId: string;
let apiKey: string;
let trx: Knex.Transaction;
let ticketId: string;
let ticketBoardId: string;

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

  const board = await trx('boards').where({ tenant }).first<{ board_id: string }>('board_id');
  const status = await trx('statuses').where({ tenant }).first<{ status_id: string }>('status_id');
  if (!board || !status) throw new Error('The migrated tag route test database requires a board and status fixture');
  ticketBoardId = board.board_id;
  const clientId = await createClient(trx, tenant, `Tag route client ${userId}`);
  const ticket = await createTestTicket(trx, tenant, {
    client_id: clientId,
    status_id: status.status_id,
    board_id: ticketBoardId,
    entered_by: userId,
    assigned_to: userId,
  });
  ticketId = ticket.ticket_id;
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

function tagIdRequest(method: string, tagId: string): NextRequest {
  return new NextRequest(`http://localhost/api/v1/tags/${tagId}`, {
    method,
    headers: { 'x-api-key': apiKey },
  });
}

function service() {
  const instance = new TagService();
  vi.spyOn(instance as unknown as KnexProvidingService, 'getKnex').mockResolvedValue({ knex: trx, tenant });
  return instance;
}

describe('REST tag entity route against the migrated database schema', () => {
  it('authenticates with an API key, tags a ticket, and reads the tag back through REST', async () => {
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
      background_color: postBody.data.tags[0].background_color,
      text_color: postBody.data.tags[0].text_color,
    });
    const [mapping] = await trx('tag_mappings').where({ tenant, mapping_id: postBody.data.tags[0].tag_id });
    const definition = await trx('tag_definitions').where({ tenant, tag_id: mapping.tag_id }).first();
    expect(mapping).toMatchObject({ tagged_id: ticketId, tagged_type: 'ticket', created_by: userId });
    const explicitAttribution = await TagMapping.insert(trx, tenant, {
      tag_id: mapping.tag_id,
      tagged_id: randomUUID(),
      tagged_type: 'ticket',
      created_by: userId,
    });
    expect(explicitAttribution.created_by).toBe(userId);
    await expect(trx('tag_mappings').where({ tenant, mapping_id: explicitAttribution.mapping_id }).first('created_by'))
      .resolves.toMatchObject({ created_by: userId });
    expect(definition).toMatchObject({ board_id: null, background_color: postBody.data.tags[0].background_color, text_color: postBody.data.tags[0].text_color });
    const ticket = await trx('tickets').where({ tenant, ticket_id: ticketId }).first();
    expect(ticket.board_id).toBe(ticketBoardId);
  });

  it('runs tag, untag, and replacement in a reusable rolled-back schema contract', async () => {
    const tagService = service();
    const context: ServiceContext = { tenant, userId };
    await withRolledBackSchemaContract(trx, async (contractTrx) => {
      const getKnexSpy = vi.spyOn(tagService as unknown as KnexProvidingService, 'getKnex').mockResolvedValue({ knex: contractTrx, tenant });
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
      } finally {
        getKnexSpy.mockRestore();
      }
    });
  });

  it('supports the REST tag lifecycle when tag_definitions.board_id and tag_mappings.created_by are absent', async () => {
    const parentConnection = connection.db;
    await withRolledBackSchemaContract(trx, async (contractTrx) => {
      connection.db = contractTrx;
      await contractTrx.schema.alterTable('tag_definitions', (table) => table.dropColumn('board_id'));
      await contractTrx.schema.alterTable('tag_mappings', (table) => table.dropColumn('created_by'));
      const columns = await contractTrx('information_schema.columns')
        .where({ table_schema: 'public' }).andWhere((query) => query
          .where({ table_name: 'tag_definitions' }).orWhere({ table_name: 'tag_mappings' }))
        .select('table_name', 'column_name');
      expect(columns.filter((column: { table_name: string }) => column.table_name === 'tag_definitions')
        .map((column: { column_name: string }) => column.column_name)).not.toContain('board_id');
      expect(columns.filter((column: { table_name: string }) => column.table_name === 'tag_mappings')
        .map((column: { column_name: string }) => column.column_name)).not.toContain('created_by');
      let baselineError: { code?: string; message?: string } | undefined;
      await contractTrx.transaction(async (assertionTrx) => {
        try {
          await assertionTrx('tag_mappings').insert({
            tenant,
            mapping_id: randomUUID(),
            tag_id: randomUUID(),
            tagged_id: ticketId,
            tagged_type: 'ticket',
            created_by: userId,
          });
        } catch (error) {
          baselineError = error as { code?: string; message?: string };
          throw error;
        }
      }).catch(() => undefined);
      // This controlled local reproduction confirms PostgreSQL's diagnostic for the insert dependency. The
      // nested transaction rolls back the failed statement so the contract transaction stays usable.
      expect(baselineError?.code).toBe('42703');
      expect(baselineError?.message).toMatch(/column "created_by" of relation "tag_mappings" does not exist/);
      const getKnexSpy = vi.spyOn(TagService.prototype as unknown as KnexProvidingService, 'getKnex')
        .mockResolvedValue({ knex: contractTrx, tenant });
      try {
        const posted = await tagTicket(routeRequest('POST', ticketId, {
          entity_id: ticketId, entity_type: 'ticket', tags: ['compat-post'],
        }));
        expect(posted.status).toBe(201);
        const postedTags = (await posted.json()).data.tags;
        expect(postedTags[0]).toMatchObject({
          tag_text: 'compat-post', tagged_id: ticketId, tagged_type: 'ticket', tenant,
          background_color: expect.any(String), text_color: expect.any(String),
        });
        expect(postedTags[0]).not.toHaveProperty('board_id');

        const [postedMapping] = await contractTrx('tag_mappings')
          .where({ tenant, mapping_id: postedTags[0].tag_id });
        const explicitAttribution = await TagMapping.insert(contractTrx, tenant, {
          tag_id: postedMapping.tag_id,
          tagged_id: randomUUID(),
          tagged_type: 'ticket',
          created_by: userId,
        });
        expect(explicitAttribution).not.toHaveProperty('created_by');
        const reducedSchemaRow = await contractTrx('tag_mappings')
          .where({ tenant, mapping_id: explicitAttribution.mapping_id }).first();
        expect(reducedSchemaRow).not.toHaveProperty('created_by');

        const tagById = await readTagById(tagIdRequest('GET', postedTags[0].tag_id));
        expect(tagById.status).toBe(200);
        const tagByIdBody = await tagById.json();
        expect(tagByIdBody.data).toMatchObject({
          tag_id: postedTags[0].tag_id,
          tag_text: 'compat-post',
          tagged_id: ticketId,
          tagged_type: 'ticket',
          tenant,
          background_color: postedTags[0].background_color,
          text_color: postedTags[0].text_color,
        });
        expect(tagByIdBody.data).not.toHaveProperty('created_by');
        expect(tagByIdBody.data).not.toHaveProperty('board_id');

        const fetched = await readTicketTags(routeRequest('GET', ticketId));
        const fetchedTags = (await fetched.json()).data.tags;
        expect(fetchedTags).toHaveLength(1);
        expect(fetchedTags[0]).toMatchObject({
          tag_id: postedTags[0].tag_id, tag_text: 'compat-post', tagged_id: ticketId,
          tagged_type: 'ticket', tenant, background_color: postedTags[0].background_color,
          text_color: postedTags[0].text_color,
        });

        const bulk = await bulkTagEntities(new NextRequest('http://localhost/api/v1/tags/bulk/tag', {
          method: 'POST', headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
          body: JSON.stringify({ entities: [{ entity_id: ticketId, entity_type: 'ticket' }], tags: ['compat-bulk'] }),
        }));
        expect(bulk.status).toBe(201);
        const bulkReadBack = await readTicketTags(routeRequest('GET', ticketId));
        const bulkTags = (await bulkReadBack.json()).data.tags;
        expect(bulkTags).toHaveLength(2);
        expect(bulkTags.find((tag: { tag_text: string }) => tag.tag_text === 'compat-bulk'))
          .toMatchObject({ tagged_id: ticketId, tenant, background_color: expect.any(String), text_color: expect.any(String) });

        const replaced = await replaceTicketTags(routeRequest('PUT', ticketId, {
          entity_id: ticketId, entity_type: 'ticket', tags: ['compat-put'],
        }));
        expect(replaced.status).toBe(200);
        const putReadBack = (await readTicketTags(routeRequest('GET', ticketId)).then((response) => response.json())).data.tags;
        expect(putReadBack).toHaveLength(1);
        expect(putReadBack[0]).toMatchObject({
          tag_text: 'compat-put', tagged_id: ticketId, tagged_type: 'ticket', tenant,
          background_color: expect.any(String), text_color: expect.any(String),
        });

        const replacedTags = (await replaced.json()).data.tags;
        const deleted = await untagTicket(routeRequest('DELETE', ticketId, {
          entity_id: ticketId, entity_type: 'ticket', tag_ids: replacedTags.map((tag: { tag_id: string }) => tag.tag_id),
        }));
        expect(deleted.status).toBe(200);
        expect((await readTicketTags(routeRequest('GET', ticketId)).then((response) => response.json())).data.tags).toEqual([]);
      } finally {
        getKnexSpy.mockRestore();
        connection.db = parentConnection;
      }
    });
  });

  it('batch reads REST assignments once per distinct entity under the reduced schema', async () => {
    const tagService = service();
    const context: ServiceContext = { tenant, userId };
    const secondClientId = await createClient(trx, tenant, `Tag batch client ${userId}`);
    const status = await trx('statuses').where({ tenant }).first<{ status_id: string }>('status_id');
    if (!status) throw new Error('The migrated tag route test database requires a status fixture');
    const secondTicket = await createTestTicket(trx, tenant, {
      client_id: secondClientId,
      status_id: status.status_id,
      board_id: ticketBoardId,
      entered_by: userId,
      assigned_to: userId,
    });

    await withRolledBackSchemaContract(trx, async (contractTrx) => {
      const getKnexSpy = vi.spyOn(tagService as unknown as KnexProvidingService, 'getKnex')
        .mockResolvedValue({ knex: contractTrx, tenant });
      try {
        await contractTrx.schema.alterTable('tag_definitions', (table) => table.dropColumn('board_id'));
        await tagService.tagEntity(ticketId, 'ticket', ['batch-first'], {}, context);
        await tagService.tagEntity(secondTicket.ticket_id, 'ticket', ['batch-second'], {}, context);

        const assignments = await tagService.getTagsByEntities(
          [ticketId, secondTicket.ticket_id, ticketId], 'ticket', context,
        );
        expect(assignments).toHaveLength(2);
        expect(assignments.map((tag) => tag.tagged_id).sort()).toEqual([ticketId, secondTicket.ticket_id].sort());
        expect(assignments.map((tag) => tag.tag_text).sort()).toEqual(['batch-first', 'batch-second']);
        expect(assignments.every((tag) => tag.tenant === tenant && tag.background_color && tag.text_color)).toBe(true);

        await expect(tagService.getTagsByEntities([], 'ticket', context)).resolves.toEqual([]);
      } finally {
        getKnexSpy.mockRestore();
      }
    });
  });

  it('untags a mapping through the API-key route and leaves no mapping behind', async () => {
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
    expect(await trx('tag_mappings').where({ tenant, mapping_id: tagId })).toHaveLength(0);
  });

  it('replaces a ticket tag set through the API-key route', async () => {
    const initial = await tagTicket(routeRequest('POST', ticketId, {
      entity_id: ticketId,
      entity_type: 'ticket',
      tags: ['replace-old', 'replace-shared'],
    }));
    expect(initial.status).toBe(201);

    const response = await replaceTicketTags(routeRequest('PUT', ticketId, {
      entity_id: ticketId,
      entity_type: 'ticket',
      tags: ['replace-shared', 'replace-new'],
    }));
    expect(response.status).toBe(200);

    const readBack = await readTicketTags(routeRequest('GET', ticketId));
    const readTags = (await readBack.json()).data.tags as Array<{ tag_id: string; tag_text: string }>;
    expect(readTags.map((tag) => tag.tag_text).sort()).toEqual(['replace-new', 'replace-shared']);
    const oldTagIds = (await initial.json()).data.tags.map((tag: { tag_id: string }) => tag.tag_id);
    for (const oldTagId of oldTagIds) {
      expect(await trx('tag_mappings').where({ tenant, mapping_id: oldTagId })).toHaveLength(0);
    }
    const persisted = await trx('tag_mappings').where({ tenant, tagged_id: ticketId, tagged_type: 'ticket' });
    expect(persisted.map((mapping: { mapping_id: string }) => mapping.mapping_id).sort())
      .toEqual(readTags.map((tag) => tag.tag_id).sort());
  });

  it('preserves existing mappings when PUT replacement fails during insertion', async () => {
    const initial = await tagTicket(routeRequest('POST', ticketId, {
      entity_id: ticketId,
      entity_type: 'ticket',
      tags: ['preserve-on-failure', 'preserve-second-on-failure'],
    }));
    const originalMappingIds = (await initial.json()).data.tags.map((tag: { tag_id: string }) => tag.tag_id).sort();
    const insert = vi.spyOn(TagMapping, 'insert').mockRejectedValueOnce(new Error('Injected mapping insertion failure'));

    let response: NextResponse;
    try {
      response = await replaceTicketTags(routeRequest('PUT', ticketId, {
        entity_id: ticketId,
        entity_type: 'ticket',
        tags: ['replacement-failure'],
      }));
    } finally {
      insert.mockRestore();
    }

    expect(response.status).toBe(500);
    const persisted = await trx('tag_mappings').where({ tenant, tagged_id: ticketId, tagged_type: 'ticket' });
    expect(persisted.map((mapping: { mapping_id: string }) => mapping.mapping_id).sort()).toEqual(originalMappingIds);
    const readBack = await readTicketTags(routeRequest('GET', ticketId));
    expect((await readBack.json()).data.tags.map((tag: { tag_text: string }) => tag.tag_text).sort())
      .toEqual(['preserve-on-failure', 'preserve-second-on-failure']);
  });

  it('preserves existing mappings when PUT replacement read-back raises PostgreSQL 42703', async () => {
    const initial = await tagTicket(routeRequest('POST', ticketId, {
      entity_id: ticketId,
      entity_type: 'ticket',
      tags: ['preserve-on-readback-failure'],
    }));
    const originalMapping = (await initial.json()).data.tags[0];
    const readBackMapping = vi.spyOn(TagMapping, 'getByMappingId').mockRejectedValueOnce({
      message: 'column "missing_column" of relation "tag_mappings" does not exist',
      code: '42703',
      table: 'tag_mappings',
      column: 'missing_column',
    });

    let response: NextResponse;
    try {
      response = await replaceTicketTags(routeRequest('PUT', ticketId, {
        entity_id: ticketId,
        entity_type: 'ticket',
        tags: ['replacement-readback-failure'],
      }));
    } finally {
      readBackMapping.mockRestore();
    }

    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe('INTERNAL_CONFIGURATION');
    const persisted = await trx('tag_mappings').where({ tenant, tagged_id: ticketId, tagged_type: 'ticket' });
    expect(persisted).toHaveLength(1);
    expect(persisted[0].mapping_id).toBe(originalMapping.tag_id);
    const readBack = await readTicketTags(routeRequest('GET', ticketId));
    expect((await readBack.json()).data.tags.map((tag: { tag_text: string }) => tag.tag_text))
      .toEqual(['preserve-on-readback-failure']);
  });

  it('uses the same schema-safe tagging path for bulk/tag', async () => {
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
