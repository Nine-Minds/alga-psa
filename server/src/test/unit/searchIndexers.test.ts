import { describe, expect, it, vi } from 'vitest';

import { clientIndexer } from '../../lib/search/indexers/client';
import { contactIndexer } from '../../lib/search/indexers/contact';

function createFirstRowKnex(row: unknown) {
  const queryBuilder = {
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(row),
  };
  const knex = vi.fn().mockReturnValue(queryBuilder);
  return { knex, queryBuilder };
}

function createBatchKnex(rows: unknown[]) {
  const queryBuilder = {
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: vi.fn((resolve, reject) => Promise.resolve(rows).then(resolve, reject)),
  };
  const knex = vi.fn().mockReturnValue(queryBuilder);
  return { knex, queryBuilder };
}

describe('search entity indexers', () => {
  it('T027 client loadOne maps client fields into a SearchDoc', async () => {
    const { knex, queryBuilder } = createFirstRowKnex({
      client_id: 'client-1',
      client_name: 'ACME Corp',
      email: 'support@acme.example',
      phone_no: '555-0100',
      notes: 'Managed firewall customer',
      created_at: '2026-05-12T10:00:00.000Z',
      updated_at: '2026-05-13T10:00:00.000Z',
    });

    const doc = await clientIndexer.loadOne(
      knex as never,
      '11111111-1111-4111-8111-111111111111',
      'client-1',
    );

    expect(knex).toHaveBeenCalledWith('clients');
    expect(queryBuilder.where).toHaveBeenCalledWith(
      'tenant',
      '11111111-1111-4111-8111-111111111111',
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith('client_id', 'client-1');
    expect(doc).toMatchObject({
      tenant: '11111111-1111-4111-8111-111111111111',
      objectType: 'client',
      objectId: 'client-1',
      title: 'ACME Corp',
      subtitle: 'support@acme.example | 555-0100',
      body: 'Managed firewall customer',
      url: '/msp/clients/client-1',
      acl: { requiredPermission: 'client:read' },
    });
    expect(doc?.sourceUpdatedAt.toISOString()).toBe('2026-05-13T10:00:00.000Z');
  });

  it('T028 client loadBatch maps every seeded tenant client row for backfill', async () => {
    const { knex, queryBuilder } = createBatchKnex([
      {
        client_id: 'client-1',
        client_name: 'ACME Corp',
        email: 'support@acme.example',
        phone_no: null,
        notes: 'First client',
        updated_at: '2026-05-13T10:00:00.000Z',
      },
      {
        client_id: 'client-2',
        client_name: 'Exchange LLC',
        email: null,
        phone_no: '555-0101',
        notes: 'Second client',
        updated_at: '2026-05-13T11:00:00.000Z',
      },
    ]);

    const docs = await clientIndexer.loadBatch(
      knex as never,
      '11111111-1111-4111-8111-111111111111',
      undefined,
      500,
    );

    expect(knex).toHaveBeenCalledWith('clients');
    expect(queryBuilder.where).toHaveBeenCalledWith(
      'tenant',
      '11111111-1111-4111-8111-111111111111',
    );
    expect(queryBuilder.orderBy).toHaveBeenCalledWith('client_id', 'asc');
    expect(queryBuilder.limit).toHaveBeenCalledWith(500);
    expect(docs).toHaveLength(2);
    expect(docs.map((doc) => doc.objectId)).toEqual(['client-1', 'client-2']);
    expect(docs.every((doc) => doc.objectType === 'client')).toBe(true);
    expect(docs.every((doc) => doc.acl.requiredPermission === 'client:read')).toBe(true);
  });

  it('T029 contact subtitle includes email, phone, and role', async () => {
    const { knex, queryBuilder } = createFirstRowKnex({
      contact_name_id: 'contact-1',
      full_name: 'Ada Lovelace',
      email: 'ada@example.com',
      phone_number: '555-0110',
      role: 'Primary Contact',
      updated_at: '2026-05-13T10:00:00.000Z',
    });

    const doc = await contactIndexer.loadOne(
      knex as never,
      '11111111-1111-4111-8111-111111111111',
      'contact-1',
    );

    expect(knex).toHaveBeenCalledWith('contacts');
    expect(queryBuilder.andWhere).toHaveBeenCalledWith('contact_name_id', 'contact-1');
    expect(doc).toMatchObject({
      objectType: 'contact',
      objectId: 'contact-1',
      title: 'Ada Lovelace',
      subtitle: 'ada@example.com | 555-0110 | Primary Contact',
      url: '/msp/contacts/contact-1',
      acl: { requiredPermission: 'contact:read' },
    });
  });
});
