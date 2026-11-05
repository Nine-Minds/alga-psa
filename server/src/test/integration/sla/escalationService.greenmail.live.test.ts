import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { escalateTicket } from '@alga-psa/sla/services/escalationService';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../../test-utils/dbConfig';
import { createTenant, createUser, createClient } from '../../../../test-utils/testDataFactory';

describe.skipIf(process.env.RUN_SLA_GREENMAIL_SMOKE !== '1')('live SMTP SLA escalation smoke', () => {
  let db: Knex;
  let tenant: string;

  const table = (name: string) => tenantDb(db, tenant).table(name);

  beforeAll(async () => {
    wireLocalTestDbEnv();
    db = await createTestDbConnection();
    tenant = await createTenant(db, `GreenMail SLA ${uuidv4().slice(0, 8)}`);
  }, 180_000);

  afterAll(async () => { await db?.destroy(); }, 60_000);

  it('sends two escalations through GreenMail with the sender selected by each ticket board', async () => {
    const assignee = await createUser(db, tenant, { email: `assignee-${uuidv4()}@example.test` });
    const managerAEmail = `sla-board-a-${uuidv4()}@example.test`;
    const managerBEmail = `sla-board-b-${uuidv4()}@example.test`;
    const managerA = await createUser(db, tenant, { email: managerAEmail, first_name: 'Board', last_name: 'A' });
    const managerB = await createUser(db, tenant, { email: managerBEmail, first_name: 'Board', last_name: 'B' });
    const clientId = await createClient(db, tenant, `GreenMail Client ${uuidv4().slice(0, 6)}`);
    const contactId = uuidv4();
    await table('contacts').insert({ tenant, contact_name_id: contactId, full_name: 'Smoke Contact', client_id: clientId, email: `contact-${uuidv4()}@example.test` });
    const statusId = uuidv4();
    const priorityId = uuidv4();
    await table('statuses').insert({ tenant, status_id: statusId, name: `Open ${uuidv4().slice(0, 6)}`, is_closed: false, status_type: 'ticket', order_number: 1 });
    await table('priorities').insert({ tenant, priority_id: priorityId, priority_name: 'Urgent', color: '#808080', order_number: 1, created_by: assignee, created_at: db.fn.now() });

    const boardA = uuidv4();
    const boardB = uuidv4();
    await table('boards').insert([
      { tenant, board_id: boardA, board_name: 'SMTP Route A', manager_user_id: assignee },
      { tenant, board_id: boardB, board_name: 'SMTP Route B', manager_user_id: assignee },
    ]);
    const senderA = uuidv4();
    const senderB = uuidv4();
    await table('email_sender_addresses').insert([
      { tenant, sender_id: senderA, email_address: 'board-a-route@example.test', display_name: 'Board A Mail', verification_status: 'verified' },
      { tenant, sender_id: senderB, email_address: 'board-b-route@example.test', display_name: 'Board B Mail', verification_status: 'verified' },
    ]);
    await table('email_sender_routes').insert([
      { tenant, route_id: uuidv4(), route_type: 'board', board_id: boardA, sender_id: senderA },
      { tenant, route_id: uuidv4(), route_type: 'board', board_id: boardB, sender_id: senderB },
    ]);
    await table('tenant_email_settings').insert({
      tenant,
      default_from_domain: 'example.test',
      email_provider: 'smtp',
      provider_configs: JSON.stringify([{ providerId: 'greenmail-sla', providerType: 'smtp', isEnabled: true, config: { host: '127.0.0.1', port: 3725, secure: false, from: 'fallback@example.test' } }]),
    });
    await table('notification_settings').insert({ tenant, is_enabled: true, rate_limit_per_minute: 60 });

    const addManager = async (boardId: string, userId: string) => table('escalation_managers').insert({
      tenant, config_id: uuidv4(), board_id: boardId, escalation_level: 1, manager_user_id: userId, notify_via: ['email'],
    });
    await addManager(boardA, managerA);
    await addManager(boardB, managerB);

    const makeTicket = async (boardId: string, label: string) => {
      const ticketId = uuidv4();
      await table('tickets').insert({ tenant, ticket_id: ticketId, ticket_number: `SMTP-${label}-${uuidv4().slice(0, 6)}`, title: `GreenMail board ${label}`, client_id: clientId, contact_name_id: contactId, status_id: statusId, priority_id: priorityId, board_id: boardId, assigned_to: assignee, entered_at: db.fn.now(), updated_at: db.fn.now() });
      return ticketId;
    };
    const ticketA = await makeTicket(boardA, 'A');
    const ticketB = await makeTicket(boardB, 'B');
    const escalations = [] as Array<{ ticketId: string; auditLogId: string; audit: any }>;

    for (const ticketId of [ticketA, ticketB]) {
      await withTransaction(db, async (trx) => {
        const outcome = await escalateTicket(trx, tenant, ticketId, 1);
        expect(outcome.success).toBe(true);
      });
      const audit = await table('sla_audit_log').where({ ticket_id: ticketId, event_type: 'ticket_escalated' }).first();
      const eventData = typeof audit.event_data === 'string' ? JSON.parse(audit.event_data) : audit.event_data;
      expect(eventData.notifications.email).toBe('sent');
      expect(eventData.notifications.emailMessageId).toBeTruthy();
      escalations.push({ ticketId, auditLogId: audit.log_id, audit: eventData });
    }

    const readInbox = async (email: string) => {
      const response = await fetch(`http://127.0.0.1:8690/api/user/${encodeURIComponent(email)}/messages/INBOX`);
      if (!response.ok) throw new Error(`GreenMail inbox query failed: ${response.status}`);
      return response.json() as Promise<any[]>;
    };
    const inboxA = await readInbox(managerAEmail);
    const inboxB = await readInbox(managerBEmail);
    const messageA = inboxA.find((message) => JSON.stringify(message).includes('GreenMail board A'));
    const messageB = inboxB.find((message) => JSON.stringify(message).includes('GreenMail board B'));
    expect(messageA).toBeTruthy();
    expect(messageB).toBeTruthy();
    expect(JSON.stringify(messageA)).toContain('board-a-route@example.test');
    expect(JSON.stringify(messageB)).toContain('board-b-route@example.test');
    expect(JSON.stringify(messageA)).toContain(managerAEmail);
    expect(JSON.stringify(messageB)).toContain(managerBEmail);
    expect(escalations.map((item) => item.audit.notifications.email)).toEqual(['sent', 'sent']);
    console.log('GreenMail SLA escalation proof', escalations.map(({ ticketId, auditLogId, audit }, index) => ({
      ticketId,
      auditLogId,
      recipient: index === 0 ? managerAEmail : managerBEmail,
      boardFromHeader: index === 0 ? 'board-a-route@example.test' : 'board-b-route@example.test',
      status: audit.notifications.email,
      messageId: audit.notifications.emailMessageId,
    })));
  }, 60_000);
});
