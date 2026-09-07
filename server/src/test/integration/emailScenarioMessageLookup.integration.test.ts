import { beforeAll, afterAll, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTestEnvironment } from '../../../test-utils/testDataFactory';
import { createTicket } from '../../../test-utils/billingProfileTestHelpers';
import { readTicketsForEmailMessage } from '../e2e/utils/email-message-tickets';
let db: Knex;
beforeAll(async () => { db = await createTestDbConnection(); }, 180000);
afterAll(async () => { await db?.destroy(); });
it('finds the exact message without a contact and excludes another tenant and unrelated messages', async () => {
  const own = await createTestEnvironment(db);
  const foreign = await createTestEnvironment(db);
  const create = async (environment: typeof own, number: string, messageId: string) => {
    const id = await createTicket({ db, tenantId: environment.tenantId }, {
      clientId: environment.clientId, ticketNumber: number, title: 'Unknown sender',
    });
    await db('tickets').where({ tenant: environment.tenantId, ticket_id: id }).update({
      contact_name_id: null, email_metadata: { messageId },
    });
    return id;
  };
  const ownId = await create(own, 'EMAIL-1', '<sent@example.test>');
  await create(own, 'EMAIL-2', 'unrelated@example.test');
  await create(foreign, 'EMAIL-3', 'sent@example.test');
  const matches = await readTicketsForEmailMessage(db, own.tenantId, 'sent@example.test');
  expect(matches.map(row => row.ticket_id)).toEqual([ownId]);
  expect(matches[0].contact_name_id).toBeNull();
  expect(await readTicketsForEmailMessage(db, own.tenantId, 'missing@example.test')).toEqual([]);
  await expect(readTicketsForEmailMessage(db, own.tenantId, undefined)).rejects.toThrow('Send and capture');
});
