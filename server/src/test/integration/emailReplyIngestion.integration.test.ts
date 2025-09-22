import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import path from 'node:path';
import process from 'node:process';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createCompany } from '../../../test-utils/testDataFactory';

let db: Knex;
let tenantId: string;

vi.mock('@alga-psa/shared/core/secretProvider', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getAppSecret: async () => '',
  })),
  secretProvider: {
    getSecret: vi.fn(async (_key: string, _envVar?: string, fallback?: string) => fallback ?? ''),
  },
}));

vi.mock('@alga-psa/shared/core', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@alga-psa/shared/core/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@shared/core/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@shared/db/admin', () => ({
  getAdminConnection: vi.fn(async () => {
    if (!db) {
      throw new Error('Test database not initialized');
    }
    return db;
  }),
  destroyAdminConnection: vi.fn(async () => {}),
}));

const { systemEmailProcessingWorkflow } = await import('@shared/workflow/workflows/system-email-processing-workflow');
const {
  createCommentFromEmail,
  findTicketByEmailThread,
} = await import('@shared/workflow/actions/emailWorkflowActions');
const { runWithTenant } = await import('@/lib/db');

describe('Email reply ingestion integration', () => {
  const HOOK_TIMEOUT = 180_000;

  beforeAll(async () => {
    process.env.DB_USER_ADMIN = process.env.DB_USER_ADMIN || 'postgres';
    process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'sebastian_test';
    process.env.DB_HOST = process.env.DB_HOST || 'localhost';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.DB_PASSWORD_ADMIN = process.env.DB_PASSWORD_ADMIN || 'postpass123';

    db = await createTestDbConnection();
    await runMigrationsAndSeeds(db);
    tenantId = await ensureTenant(db);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    if (!tenantId) {
      return;
    }
    await db('comments').where({ tenant: tenantId }).delete();
    await db('tickets').where({ tenant: tenantId, title: 'Existing Ticket' }).delete();
    await db('contacts').where({ tenant: tenantId, full_name: 'Integration Contact' }).delete();
    await db('companies').where({ tenant: tenantId, company_name: 'Integration Company' }).delete();
  });

  it('persists full comment content when reply markers are missing', async () => {
    const companyId = await createCompany(db, tenantId, 'Integration Company');
    const contactEmail = `integration-contact-${uuidv4()}@example.com`;
    const contactId = await createContact(db, tenantId, companyId, contactEmail);

    const statusId = await ensureStatus(db, tenantId);
    const priorityId = await ensurePriority(db, tenantId);
    const channelId = await ensureChannel(db, tenantId);

    const ticketId = uuidv4();
    const originalMessageId = `message-${uuidv4()}@mail`; 
    await insertTicket(db, {
      tenant: tenantId,
      ticketId,
      contactId,
      companyId,
      statusId,
      priorityId,
      channelId,
      originalMessageId,
    });

    const rawBody = 'Customer reply without embedded markers.\nSecond line of context.';

    const actions = {
      parse_email_reply: vi.fn(async () => ({
        success: true,
        parsed: {
          sanitizedText: rawBody,
          sanitizedHtml: undefined,
          confidence: 'low',
          strategy: 'fallback',
          appliedHeuristics: [],
          warnings: [],
          tokens: null,
        },
      })),
      find_ticket_by_reply_token: vi.fn(async () => ({ success: false })),
      find_ticket_by_email_thread: vi.fn(async (input: any) => {
        const match = await findTicketByEmailThread(input, tenantId);
        return match ? { success: true, ticket: match } : { success: false };
      }),
      create_comment_from_email: vi.fn(async (input: any) => {
        const commentId = await createCommentFromEmail(input, tenantId);
        return { success: true, commentId };
      }),
      process_email_attachment: vi.fn(async () => undefined),
      createTaskAndWaitForResult: vi.fn(async () => ({ success: false })),
    } as any;

    const events = {
      waitFor: vi.fn(async () => ({
        emailData: {
          id: `reply-${uuidv4()}`,
          subject: 'Re: Existing Ticket',
          from: { email: contactEmail, name: 'Integration Contact' },
          inReplyTo: originalMessageId,
          references: [originalMessageId],
          threadId: 'thread-xyz',
          body: { text: rawBody },
          attachments: [],
        },
        providerId: 'mailhog-test',
        tenantId,
      })),
    };

    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    const data = createWorkflowDataStore();
    const setState = vi.fn();

    await runWithTenant(tenantId, async () => {
      await systemEmailProcessingWorkflow({ actions, events, logger, data, setState });
    });

    const storedComment = await db('comments')
      .where({ tenant: tenantId, ticket_id: ticketId })
      .first();

    expect(storedComment).toBeTruthy();
    expect(storedComment?.note).toBe(rawBody);
    expect(storedComment?.author_type).toBe('client');

    expect(actions.parse_email_reply).toHaveBeenCalledOnce();
    expect(actions.find_ticket_by_email_thread).toHaveBeenCalledOnce();
    expect(actions.create_comment_from_email).toHaveBeenCalledOnce();
  });

  it('stores only content above reply marker when present', async () => {
    const companyId = await createCompany(db, tenantId, 'Integration Company');
    const contactEmail = `integration-contact-marker-${uuidv4()}@example.com`;
    const contactId = await createContact(db, tenantId, companyId, contactEmail);

    const statusId = await ensureStatus(db, tenantId);
    const priorityId = await ensurePriority(db, tenantId);
    const channelId = await ensureChannel(db, tenantId);

    const ticketId = uuidv4();
    const originalMessageId = `message-${uuidv4()}@mail`;
    await insertTicket(db, {
      tenant: tenantId,
      ticketId,
      contactId,
      companyId,
      statusId,
      priorityId,
      channelId,
      originalMessageId,
    });

    const replyTop = 'Quick update: issue resolved on our end.';
    const markerBody = `${replyTop}\n--- Please reply above this line ---\nPrior thread content`; 

    const actions = {
      parse_email_reply: vi.fn(async () => ({
        success: true,
        parsed: {
          sanitizedText: replyTop,
          sanitizedHtml: undefined,
          confidence: 'high',
          strategy: 'custom-boundary',
          appliedHeuristics: ['explicit-boundary'],
          warnings: [],
          tokens: null,
        },
      })),
      find_ticket_by_reply_token: vi.fn(async () => ({ success: false })),
      find_ticket_by_email_thread: vi.fn(async (input: any) => {
        const match = await findTicketByEmailThread(input, tenantId);
        return match ? { success: true, ticket: match } : { success: false };
      }),
      create_comment_from_email: vi.fn(async (input: any) => {
        const commentId = await createCommentFromEmail(input, tenantId);
        return { success: true, commentId };
      }),
      process_email_attachment: vi.fn(async () => undefined),
    } as any;

    const events = {
      waitFor: vi.fn(async () => ({
        emailData: {
          id: `reply-${uuidv4()}`,
          subject: 'Re: Existing Ticket',
          from: { email: contactEmail, name: 'Integration Contact' },
          inReplyTo: originalMessageId,
          references: [originalMessageId],
          threadId: 'thread-xyz',
          body: { text: markerBody },
          attachments: [],
        },
        providerId: 'mailhog-test',
        tenantId,
      })),
    };

    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    const data = createWorkflowDataStore();
    const setState = vi.fn();

    await runWithTenant(tenantId, async () => {
      await systemEmailProcessingWorkflow({ actions, events, logger, data, setState });
    });

    const storedComment = await db('comments')
      .where({ tenant: tenantId, ticket_id: ticketId })
      .first();

    expect(storedComment).toBeTruthy();
    expect(storedComment?.note).toBe(replyTop);
    expect(storedComment?.author_type).toBe('client');

    expect(actions.parse_email_reply).toHaveBeenCalledOnce();
    expect(actions.find_ticket_by_email_thread).toHaveBeenCalledOnce();
    expect(actions.create_comment_from_email).toHaveBeenCalledOnce();
  });
});

function createWorkflowDataStore() {
  const store = new Map<string, any>();
  return {
    set: store.set.bind(store),
    get: store.get.bind(store),
    has: store.has.bind(store),
  };
}

async function runMigrationsAndSeeds(connection: Knex): Promise<void> {
  await connection.raw('DROP SCHEMA IF EXISTS public CASCADE');
  await connection.raw('CREATE SCHEMA public');
  await connection.raw('GRANT ALL ON SCHEMA public TO public');
  await connection.raw(`GRANT ALL ON SCHEMA public TO ${process.env.DB_USER_ADMIN || 'postgres'}`);

  await connection.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
  await connection.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  try {
    await connection.raw('CREATE EXTENSION IF NOT EXISTS "vector"');
  } catch (error) {
    console.warn('[emailReplyIngestion.integration] pgvector extension unavailable:', error);
  }

  const migrationsDir = path.resolve(process.cwd(), 'migrations');
  const seedsDir = path.resolve(process.cwd(), 'seeds', 'dev');

  await connection.migrate.rollback({ directory: migrationsDir, loadExtensions: ['.cjs', '.js'] }, true);
  await connection.migrate.latest({ directory: migrationsDir, loadExtensions: ['.cjs', '.js'] });
  await connection.seed.run({ directory: seedsDir, loadExtensions: ['.cjs', '.js'] });
}

async function ensureTenant(connection: Knex): Promise<string> {
  const row = await connection('tenants').first<{ tenant: string }>('tenant');
  if (row?.tenant) {
    return row.tenant;
  }

  const newTenantId = uuidv4();
  await connection('tenants').insert({
    tenant: newTenantId,
    company_name: 'Email Reply Test Tenant',
    email: 'email-reply@test.co',
    created_at: connection.fn.now(),
    updated_at: connection.fn.now(),
  });
  return newTenantId;
}

async function createContact(
  connection: Knex,
  tenant: string,
  companyId: string,
  email: string,
): Promise<string> {
  const contactId = uuidv4();
  await connection('contacts').insert({
    tenant,
    contact_name_id: contactId,
    full_name: 'Integration Contact',
    company_id: companyId,
    email,
    created_at: connection.fn.now(),
    updated_at: connection.fn.now(),
  });
  return contactId;
}

async function ensureStatus(connection: Knex, tenant: string): Promise<string> {
  const existing = await connection('statuses')
    .where({ tenant, status_type: 'ticket' })
    .first<{ status_id: string }>('status_id');
  if (!existing?.status_id) {
    throw new Error('No ticket statuses available for integration test');
  }
  return existing.status_id;
}

async function ensurePriority(connection: Knex, tenant: string): Promise<string> {
  const existing = await connection('priorities')
    .where({ tenant })
    .first<{ priority_id: string }>('priority_id');
  if (!existing?.priority_id) {
    throw new Error('No priorities available for integration test');
  }
  return existing.priority_id;
}

async function ensureChannel(connection: Knex, tenant: string): Promise<string> {
  const existing = await connection('channels')
    .where({ tenant })
    .first<{ channel_id: string }>('channel_id');
  if (!existing?.channel_id) {
    throw new Error('No channels available for integration test');
  }
  return existing.channel_id;
}

async function insertTicket(connection: Knex, params: {
  tenant: string;
  ticketId: string;
  contactId: string;
  companyId: string;
  statusId: string;
  priorityId: string;
  channelId: string;
  originalMessageId: string;
}): Promise<void> {
  const ticketNumber = `INT-${Math.floor(Math.random() * 1_000_000)}`;

  await connection('tickets').insert({
    tenant: params.tenant,
    ticket_id: params.ticketId,
    ticket_number: ticketNumber,
    title: 'Existing Ticket',
    company_id: params.companyId,
    contact_name_id: params.contactId,
    status_id: params.statusId,
    priority_id: params.priorityId,
    channel_id: params.channelId,
    email_metadata: JSON.stringify({
      messageId: params.originalMessageId,
      threadId: 'thread-xyz',
      references: [params.originalMessageId],
    }),
    entered_at: connection.fn.now(),
    updated_at: connection.fn.now(),
  });
}
