import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { processInboundEmailInApp } from '@alga-psa/shared/services/email/processInboundEmailInApp';
import { tenantDb } from '@alga-psa/db';

let db: Knex;
let tenantId: string;
let clientId: string;
let boardId: string;
let statusId: string;
let priorityId: string;
let enteredByUserId: string;

const describeDb = await describeWithDb();

describeDb('Workflow worker v2 + inbound email smoke', () => {
  beforeAll(async () => {
    process.env.WORKFLOW_WORKER_MODE = 'v2';
    db = await createTestDbConnection();

    const tenant = await tenantDb(db, '__test_discovery__')
      .unscoped('tenants', 'test discovery of seeded tenant for workflow inbound email smoke')
      .first<{ tenant: string }>('tenant');
    if (!tenant?.tenant) throw new Error('Expected seeded tenant');
    tenantId = tenant.tenant;

    const scopedDb = tenantDb(db, tenantId);

    const client = await scopedDb.table('clients').first<{ client_id: string }>('client_id');
    if (!client?.client_id) throw new Error('Expected seeded client');
    clientId = client.client_id;

    const board = await scopedDb.table('boards').first<{ board_id: string }>('board_id');
    if (!board?.board_id) throw new Error('Expected seeded board');
    boardId = board.board_id;

    const status = await scopedDb.table('statuses')
      .where({ status_type: 'ticket', board_id: boardId })
      .first<{ status_id: string; board_id: string }>('status_id', 'board_id');
    if (!status?.status_id) throw new Error('Expected seeded ticket status');
    statusId = status.status_id;

    const priority = await scopedDb.table('priorities').first<{ priority_id: string }>('priority_id');
    if (!priority?.priority_id) throw new Error('Expected seeded priority');
    priorityId = priority.priority_id;

    const user = await scopedDb.table('users').first<{ user_id: string }>('user_id');
    if (!user?.user_id) throw new Error('Expected seeded user');
    enteredByUserId = user.user_id;
  }, 180_000);

  afterAll(async () => {
    if (db) await db.destroy();
  });

  it('Worker: workflow-worker runs with WORKFLOW_WORKER_MODE=v2 and inbound email still works', async () => {
    // The compose files live at the repo root; vitest's cwd is server/, so
    // resolve them relative to this test file instead of process.cwd().
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
    const composePaths = [
      path.resolve(repoRoot, 'docker-compose.ce.yaml'),
      path.resolve(repoRoot, 'docker-compose.ee.yaml'),
      path.resolve(repoRoot, 'docker-compose.prebuilt.ce.yaml'),
      path.resolve(repoRoot, 'docker-compose.prebuilt.ee.yaml'),
      path.resolve(repoRoot, 'docker-compose.imap.ce.yaml'),
    ];
    for (const p of composePaths) {
      const content = fs.readFileSync(p, 'utf8');
      expect(content).toContain('WORKFLOW_WORKER_MODE: ${WORKFLOW_WORKER_MODE:-v2}');
    }

    const defaultsId = uuidv4();
    const scopedDb = tenantDb(db, tenantId);
    await scopedDb.table('inbound_ticket_defaults').insert({
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
    await scopedDb.table('email_providers').insert({
      id: providerId,
      tenant: tenantId,
      provider_type: 'google',
      provider_name: 'Smoke provider',
      mailbox,
      is_active: true,
      status: 'connected',
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

    const ticket = await scopedDb.table('tickets').where({ title: 'Smoke inbound subject' }).first<any>();
    expect(ticket).toBeDefined();
    const comments = await scopedDb.table('comments').where({ ticket_id: ticket.ticket_id });
    expect(comments).toHaveLength(1);

    await scopedDb.table('comments').where({ ticket_id: ticket.ticket_id }).delete();
    // Ticket creation now writes audit rows that FK the ticket.
    await scopedDb.table('ticket_audit_logs').where({ ticket_id: ticket.ticket_id }).delete();
    await scopedDb.table('tickets').where({ ticket_id: ticket.ticket_id }).delete();
    await scopedDb.table('email_providers').where({ id: providerId }).delete();
    await scopedDb.table('inbound_ticket_defaults').where({ id: defaultsId }).delete();
  });

  it('T054: workflow smoke setup resolves a board-owned ticket status for the seeded board', async () => {
    const status = await tenantDb(db, tenantId).table('statuses')
      .where({ status_id: statusId })
      .first<{ board_id: string; status_type: string }>('board_id', 'status_type');

    expect(status?.status_type).toBe('ticket');
    expect(status?.board_id).toBe(boardId);
  });
});
