import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { processInboundEmailInApp } from '@alga-psa/shared/services/email/processInboundEmailInApp';

let db: Knex;
let tenantId: string;
let clientId: string;
let boardId: string;
let statusId: string;
let priorityId: string;
let enteredByUserId: string;

describe('Workflow worker v2 + inbound email smoke', () => {
  beforeAll(async () => {
    process.env.WORKFLOW_WORKER_MODE = 'v2';
    db = await createTestDbConnection();

    const tenant = await db('tenants').first<{ tenant: string }>('tenant');
    if (!tenant?.tenant) throw new Error('Expected seeded tenant');
    tenantId = tenant.tenant;

    const client = await db('clients').where({ tenant: tenantId }).first<{ client_id: string }>('client_id');
    if (!client?.client_id) throw new Error('Expected seeded client');
    clientId = client.client_id;

    const board = await db('boards').where({ tenant: tenantId }).first<{ board_id: string }>('board_id');
    if (!board?.board_id) throw new Error('Expected seeded board');
    boardId = board.board_id;

    const status = await db('statuses')
      .where({ tenant: tenantId, status_type: 'ticket' })
      .first<{ status_id: string }>('status_id');
    if (!status?.status_id) throw new Error('Expected seeded ticket status');
    statusId = status.status_id;

    const priority = await db('priorities').where({ tenant: tenantId }).first<{ priority_id: string }>('priority_id');
    if (!priority?.priority_id) throw new Error('Expected seeded priority');
    priorityId = priority.priority_id;

    const user = await db('users').where({ tenant: tenantId }).first<{ user_id: string }>('user_id');
    if (!user?.user_id) throw new Error('Expected seeded user');
    enteredByUserId = user.user_id;
  }, 180_000);

  afterAll(async () => {
    if (db) await db.destroy();
  });

  it('Worker: workflow-worker runs with WORKFLOW_WORKER_MODE=v2 and inbound email still works', async () => {
    const composePaths = [
      path.resolve(process.cwd(), 'docker-compose.ce.yaml'),
      path.resolve(process.cwd(), 'docker-compose.ee.yaml'),
      path.resolve(process.cwd(), 'docker-compose.prebuilt.ce.yaml'),
      path.resolve(process.cwd(), 'docker-compose.prebuilt.ee.yaml'),
      path.resolve(process.cwd(), 'docker-compose.imap.ce.yaml'),
    ];
    for (const p of composePaths) {
      const content = fs.readFileSync(p, 'utf8');
      expect(content).toContain('WORKFLOW_WORKER_MODE: ${WORKFLOW_WORKER_MODE:-v2}');
    }

    const defaultsId = uuidv4();
    await db('inbound_ticket_defaults').insert({
      id: defaultsId,
      tenant: tenantId,
      short_name: `email-${defaultsId.slice(0, 6)}`,
      display_name: `Email Defaults ${defaultsId.slice(0, 6)}`,
      description: 'Test defaults',
      board_id: boardId,
      status_id: statusId,
      priority_id: priorityId,
      client_id: clientId,
      entered_by: enteredByUserId,
      is_active: true,
      is_default: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    const providerId = uuidv4();
    const mailbox = `support-smoke-${uuidv4().slice(0, 6)}@example.com`;
    await db('email_providers').insert({
      id: providerId,
      tenant: tenantId,
      provider_type: 'google',
      provider_name: 'Smoke provider',
      mailbox,
      is_active: true,
      status: 'connected',
      vendor_config: JSON.stringify({}),
      inbound_ticket_defaults_id: defaultsId,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    const emailId = `smoke-email-${uuidv4()}`;
    const result = await processInboundEmailInApp({
      tenantId,
      providerId,
      emailData: {
        id: emailId,
        provider: 'google',
        providerId,
        tenant: tenantId,
        receivedAt: new Date().toISOString(),
        from: { email: `unknown-${uuidv4().slice(0, 6)}@example.com`, name: 'Unknown' },
        to: [{ email: mailbox, name: 'Support' }],
        subject: 'Smoke inbound subject',
        body: { text: 'Hello', html: undefined },
        attachments: [],
      } as any,
    });

    expect(result.outcome).toBe('created');

    const ticket = await db('tickets').where({ tenant: tenantId, title: 'Smoke inbound subject' }).first<any>();
    expect(ticket).toBeDefined();
    const comments = await db('comments').where({ tenant: tenantId, ticket_id: ticket.ticket_id });
    expect(comments).toHaveLength(1);

    await db('comments').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
    await db('tickets').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
    await db('email_providers').where({ tenant: tenantId, id: providerId }).delete();
    await db('inbound_ticket_defaults').where({ tenant: tenantId, id: defaultsId }).delete();
  });
});

