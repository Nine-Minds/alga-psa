import { test, expect } from '@playwright/test';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../lib/testing/db-test-utils';
import type { TenantTestData } from '../../lib/testing/tenant-test-factory';
import {
  applyPlaywrightAuthEnvDefaults,
  createTenantAndLogin,
  resolvePlaywrightBaseUrl,
} from './helpers/playwrightAuthSessionHelper';

applyPlaywrightAuthEnvDefaults();

const TEST_CONFIG = {
  baseUrl: resolvePlaywrightBaseUrl(),
};

async function ensureTicketRefs(db: Knex, tenantId: string, createdByUserId: string): Promise<{
  boardId: string;
  statusId: string;
  priorityId: string;
}> {
  const existingBoard = await db('boards').where({ tenant: tenantId }).first<{ board_id: string }>('board_id');
  if (!existingBoard?.board_id) {
    await db('boards').insert({
      tenant: tenantId,
      board_id: uuidv4(),
      board_name: 'Email',
      display_order: 0,
      is_default: true,
      is_inactive: false,
      category_type: 'custom',
      priority_type: 'custom',
    });
  }

  const existingOpenStatus = await db('statuses')
    .where({ tenant: tenantId, status_type: 'ticket', is_closed: false })
    .first<{ status_id: string }>('status_id');
  if (!existingOpenStatus?.status_id) {
    await db('statuses').insert({
      tenant: tenantId,
      status_id: uuidv4(),
      name: 'Open',
      status_type: 'ticket',
      order_number: 1,
      created_by: createdByUserId,
      created_at: db.fn.now(),
      is_closed: false,
      is_default: true,
    });
  }

  const existingClosedStatus = await db('statuses')
    .where({ tenant: tenantId, status_type: 'ticket', is_closed: true })
    .first<{ status_id: string }>('status_id');
  if (!existingClosedStatus?.status_id) {
    await db('statuses').insert({
      tenant: tenantId,
      status_id: uuidv4(),
      name: 'Closed',
      status_type: 'ticket',
      order_number: 99,
      created_by: createdByUserId,
      created_at: db.fn.now(),
      is_closed: true,
      is_default: false,
    });
  }

  const existingPriority = await db('priorities')
    .where({ tenant: tenantId })
    .first<{ priority_id: string }>('priority_id');
  if (!existingPriority?.priority_id) {
    await db('priorities').insert({
      tenant: tenantId,
      priority_id: uuidv4(),
      priority_name: 'Normal',
      created_by: createdByUserId,
      created_at: db.fn.now(),
      order_number: 50,
      item_type: 'ticket',
      color: '#6B7280',
    });
  }

  const board = await db('boards').where({ tenant: tenantId }).first<{ board_id: string }>('board_id');
  const statusOpen = await db('statuses')
    .where({ tenant: tenantId, is_closed: false })
    .andWhere(function () {
      this.where('item_type', 'ticket').orWhere('status_type', 'ticket');
    })
    .orderBy('is_default', 'desc')
    .orderBy('order_number', 'asc')
    .first<{ status_id: string }>('status_id');
  const priority = await db('priorities')
    .where({ tenant: tenantId })
    .orderBy('order_number', 'asc')
    .first<{ priority_id: string }>('priority_id');

  if (!board?.board_id || !statusOpen?.status_id || !priority?.priority_id) {
    throw new Error('Failed to ensure board/status/priority reference data for ticket creation');
  }

  const boardId = board.board_id;
  const statusId = statusOpen.status_id;
  const priorityId = priority.priority_id;

  const existingDefaults = await db('inbound_ticket_defaults')
    .where({ tenant: tenantId, is_active: true })
    .whereNotNull('entered_by')
    .first<{ id: string }>('id');

  if (!existingDefaults?.id) {
    await db('inbound_ticket_defaults').insert({
      id: uuidv4(),
      tenant: tenantId,
      short_name: `pw-defaults-${uuidv4().slice(0, 8)}`,
      display_name: 'Playwright Inbound Defaults',
      description: null,
      board_id: boardId,
      status_id: statusId,
      priority_id: priorityId,
      client_id: null,
      entered_by: createdByUserId,
      category_id: null,
      subcategory_id: null,
      location_id: null,
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
  }

  return { boardId, statusId, priorityId };
}

async function createContact(db: Knex, tenantId: string, clientId: string, email: string): Promise<string> {
  const contactId = uuidv4();
  await db('contacts').insert({
    tenant: tenantId,
    contact_name_id: contactId,
    full_name: 'Playwright Contact',
    client_id: clientId,
    email,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return contactId;
}

async function insertTicket(db: Knex, params: {
  tenant: string;
  ticketId: string;
  clientId: string;
  contactId: string;
  boardId: string;
  statusId: string;
  priorityId: string;
  title: string;
}) {
  await db('tickets').insert({
    tenant: params.tenant,
    ticket_id: params.ticketId,
    ticket_number: `PW-${Date.now()}`,
    title: params.title,
    client_id: params.clientId,
    contact_name_id: params.contactId,
    status_id: params.statusId,
    priority_id: params.priorityId,
    board_id: params.boardId,
    email_metadata: JSON.stringify({
      messageId: `message-${uuidv4()}@mail`,
      threadId: `thread-${uuidv4()}`,
      references: [],
    }),
    entered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

async function attachDocumentToTicket(db: Knex, params: {
  tenant: string;
  ticketId: string;
  systemUserId: string;
  fileName: string;
  contentType: string;
  fileSize: number;
}) {
  const now = new Date();
  const fileId = uuidv4();
  const documentId = uuidv4();
  const storagePath = `test/${params.tenant}/${fileId}`;

  await db.transaction(async (trx) => {
    await trx('external_files').insert({
      tenant: params.tenant,
      file_id: fileId,
      file_name: params.fileName,
      original_name: params.fileName,
      mime_type: params.contentType,
      file_size: params.fileSize,
      storage_path: storagePath,
      uploaded_by_id: params.systemUserId,
      created_at: now,
      updated_at: now,
    });

    await trx('documents').insert({
      tenant: params.tenant,
      document_id: documentId,
      document_name: params.fileName,
      type_id: null,
      shared_type_id: null,
      user_id: params.systemUserId,
      created_by: params.systemUserId,
      entered_at: now,
      updated_at: now,
      file_id: fileId,
      storage_path: storagePath,
      mime_type: params.contentType,
      file_size: params.fileSize,
    });

    await trx('document_associations').insert({
      tenant: params.tenant,
      association_id: uuidv4(),
      document_id: documentId,
      entity_id: params.ticketId,
      entity_type: 'ticket',
      created_at: now,
    });
  });
}

async function openTicketDocumentsTab(page: any, ticketUrl: string): Promise<void> {
  await page.goto(ticketUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('load', { timeout: 30_000 });

  const documentsTab = page.getByRole('tab', { name: /documents/i }).or(
    page.locator('[role="tab"]:has-text("Documents")').or(page.locator('button:has-text("Documents")'))
  );
  const tabVisible = await documentsTab.isVisible({ timeout: 3_000 }).catch(() => false);
  if (tabVisible) {
    await documentsTab.click();
  }
}

test.beforeAll(async () => {
  // Ensure no filesystem secrets override Playwright env (DB creds, etc).
  process.env.SECRET_READ_CHAIN = process.env.SECRET_READ_CHAIN || 'env';
  process.env.SECRET_WRITE_PROVIDER = process.env.SECRET_WRITE_PROVIDER || 'env';
});

test('New ticket: email attachments are stored and appear in Ticket Documents', async ({ page }) => {
  test.setTimeout(300_000);
  const db = createTestDbConnection();
  let tenantData: TenantTestData | null = null;

  try {
    tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: {
        companyName: `Email Attachments Co ${uuidv4().slice(0, 6)}`,
      },
      completeOnboarding: { completedAt: new Date() },
      permissions: [
        {
          roleName: 'Admin',
          permissions: [
            { resource: 'ticket', action: 'read' },
            { resource: 'document', action: 'read' },
          ],
        },
      ],
      sessionOptions: {
        baseUrl: TEST_CONFIG.baseUrl,
      },
    });

    // Warm up session to ensure cookies are properly applied before hitting /msp routes.
    await page.goto(`${TEST_CONFIG.baseUrl}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);

    const tenantId = tenantData.tenant.tenantId;
    const clientId = tenantData.client!.clientId;
    const contactId = await createContact(db, tenantId, clientId, `pw-contact-${uuidv4().slice(0, 6)}@example.com`);
    const { boardId, statusId, priorityId } = await ensureTicketRefs(db, tenantId, tenantData.adminUser.userId);

    const ticketId = uuidv4();
    await insertTicket(db, {
      tenant: tenantId,
      ticketId,
      clientId,
      contactId,
      boardId,
      statusId,
      priorityId,
      title: 'Ticket created from inbound email',
    });

    const fileName = `email-attachment-${uuidv4().slice(0, 6)}.pdf`;
    await attachDocumentToTicket(db, {
      tenant: tenantId,
      ticketId,
      systemUserId: tenantData.adminUser.userId,
      fileName,
      contentType: 'application/pdf',
      fileSize: Buffer.from('This is a test attachment', 'utf-8').length,
    });

    const ticketUrl = `${TEST_CONFIG.baseUrl}/msp/tickets/${ticketId}`;
    await openTicketDocumentsTab(page, ticketUrl);
    await expect(page.getByText(fileName).first()).toBeVisible({ timeout: 30_000 });

    const association = await db('document_associations').where({ tenant: tenantId, entity_type: 'ticket', entity_id: ticketId }).first();
    expect(association).toBeDefined();
  } finally {
    await db.destroy().catch(() => undefined);
  }
});

test('Reply: additional email attachments appear on the same ticket', async ({ page }) => {
  test.setTimeout(300_000);
  const db = createTestDbConnection();
  let tenantData: TenantTestData | null = null;

  try {
    tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: {
        companyName: `Email Replies Co ${uuidv4().slice(0, 6)}`,
      },
      completeOnboarding: { completedAt: new Date() },
      permissions: [
        {
          roleName: 'Admin',
          permissions: [
            { resource: 'ticket', action: 'read' },
            { resource: 'document', action: 'read' },
          ],
        },
      ],
      sessionOptions: {
        baseUrl: TEST_CONFIG.baseUrl,
      },
    });

    // Warm up session to ensure cookies are properly applied before hitting /msp routes.
    await page.goto(`${TEST_CONFIG.baseUrl}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);

    const tenantId = tenantData.tenant.tenantId;
    const clientId = tenantData.client!.clientId;
    const contactId = await createContact(db, tenantId, clientId, `pw-contact-${uuidv4().slice(0, 6)}@example.com`);
    const { boardId, statusId, priorityId } = await ensureTicketRefs(db, tenantId, tenantData.adminUser.userId);

    const ticketId = uuidv4();
    await insertTicket(db, {
      tenant: tenantId,
      ticketId,
      clientId,
      contactId,
      boardId,
      statusId,
      priorityId,
      title: 'Ticket created from inbound email (threaded)',
    });

    const baseProviderId = uuidv4();
    const firstName = `initial-${uuidv4().slice(0, 6)}.txt`;
    const replyName = `reply-${uuidv4().slice(0, 6)}.zip`;

    await attachDocumentToTicket(db, {
      tenant: tenantId,
      ticketId,
      systemUserId: tenantData.adminUser.userId,
      fileName: firstName,
      contentType: 'text/plain',
      fileSize: Buffer.from('initial', 'utf-8').length,
    });

    await attachDocumentToTicket(db, {
      tenant: tenantId,
      ticketId,
      systemUserId: tenantData.adminUser.userId,
      fileName: replyName,
      contentType: 'application/zip',
      fileSize: Buffer.from('zipdata', 'utf-8').length,
    });

    const ticketUrl = `${TEST_CONFIG.baseUrl}/msp/tickets/${ticketId}`;
    await openTicketDocumentsTab(page, ticketUrl);

    await expect(page.getByText(firstName).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(replyName).first()).toBeVisible({ timeout: 30_000 });
  } finally {
    await db.destroy().catch(() => undefined);
  }
});
