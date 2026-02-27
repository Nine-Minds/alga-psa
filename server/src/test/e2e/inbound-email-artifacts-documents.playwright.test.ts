import { expect, test } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';

import {
  applyTestEnvDefaults,
  createTestDbConnection,
  getBaseUrl,
  setupAuthSession,
  type TenantTestData,
} from './helpers/testSetup';

applyTestEnvDefaults();

test('T242: Documents tab shows regular attachment, embedded image, and original-email .eml artifacts', async ({
  page,
}) => {
  test.setTimeout(300_000);

  const baseUrl = getBaseUrl();
  const db = createTestDbConnection();

  let ticketId: string | null = null;
  let tenantId: string | null = null;
  const documentIds: string[] = [];
  const fileIds: string[] = [];
  const associationIds: string[] = [];

  try {
    const tenant = await db('tenants').first<{ tenant: string; client_name: string }>('tenant', 'client_name');
    if (!tenant?.tenant) {
      throw new Error('Expected seeded tenant');
    }
    tenantId = tenant.tenant;

    const user = await db('users')
      .where({ tenant: tenantId, user_type: 'internal' })
      .first<{ user_id: string; email: string }>('user_id', 'email');
    if (!user?.user_id || !user?.email) {
      throw new Error('Expected seeded internal user');
    }

    const client = await db('clients').where({ tenant: tenantId }).first<{ client_id: string }>('client_id');
    const board = await db('boards').where({ tenant: tenantId }).first<{ board_id: string }>('board_id');
    const status = await db('statuses')
      .where({ tenant: tenantId, status_type: 'ticket' })
      .first<{ status_id: string }>('status_id');
    const priority = await db('priorities').where({ tenant: tenantId }).first<{ priority_id: string }>('priority_id');

    if (!client?.client_id || !board?.board_id || !status?.status_id || !priority?.priority_id) {
      throw new Error('Expected seeded ticket dependencies (client/board/status/priority)');
    }

    const tenantData: TenantTestData = {
      tenant: {
        tenantId,
        tenantName: tenant.client_name || 'Test Tenant',
      },
      adminUser: {
        userId: user.user_id,
        email: user.email,
      },
      client: {
        clientId: client.client_id,
        clientName: tenant.client_name || 'Test Client',
      },
    };
    await setupAuthSession(page, tenantData, baseUrl);

    ticketId = uuidv4();
    await db('tickets').insert({
      tenant: tenantId,
      ticket_id: ticketId,
      ticket_number: `E2E-${Math.floor(Math.random() * 1_000_000)}`,
      title: `Inbound artifact UI test ${uuidv4().slice(0, 6)}`,
      client_id: client.client_id,
      status_id: status.status_id,
      priority_id: priority.priority_id,
      board_id: board.board_id,
      entered_by: user.user_id,
      entered_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    const docs = [
      { name: 'regular-attachment.txt', mime: 'text/plain', bytes: Buffer.from('regular') },
      { name: 'embedded-image-1.png', mime: 'image/png', bytes: Buffer.from('embedded-image') },
      {
        name: `original-email-${uuidv4().slice(0, 8)}.eml`,
        mime: 'message/rfc822',
        bytes: Buffer.from('From: sender@example.com\r\n\r\nbody'),
      },
    ];

    for (const doc of docs) {
      const fileId = uuidv4();
      const documentId = uuidv4();
      const associationId = uuidv4();
      fileIds.push(fileId);
      documentIds.push(documentId);
      associationIds.push(associationId);

      await db('external_files').insert({
        tenant: tenantId,
        file_id: fileId,
        file_name: doc.name,
        original_name: doc.name,
        mime_type: doc.mime,
        file_size: doc.bytes.length,
        storage_path: `playwright/${fileId}/${doc.name}`,
        uploaded_by_id: user.user_id,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      });

      await db('documents').insert({
        tenant: tenantId,
        document_id: documentId,
        document_name: doc.name,
        type_id: null,
        shared_type_id: null,
        user_id: user.user_id,
        created_by: user.user_id,
        entered_at: db.fn.now(),
        updated_at: db.fn.now(),
        file_id: fileId,
        storage_path: `playwright/${fileId}/${doc.name}`,
        mime_type: doc.mime,
        file_size: doc.bytes.length,
      });

      await db('document_associations').insert({
        tenant: tenantId,
        association_id: associationId,
        document_id: documentId,
        entity_id: ticketId,
        entity_type: 'ticket',
        created_at: db.fn.now(),
      });
    }

    await page.goto(`${baseUrl}/msp/tickets/${ticketId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForLoadState('networkidle', { timeout: 30_000 });

    const documentsTab = page.getByRole('tab', { name: /Documents/i });
    await expect(documentsTab).toBeVisible({ timeout: 30_000 });
    await documentsTab.click();

    await expect(page.getByText('regular-attachment.txt')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('embedded-image-1.png')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/original-email-.*\\.eml/)).toBeVisible({ timeout: 30_000 });
  } finally {
    await cleanupInboundArtifactUiTestRows(db, {
      tenantId,
      ticketId,
      associationIds,
      documentIds,
      fileIds,
    });
    await db.destroy().catch(() => undefined);
  }
});

async function cleanupInboundArtifactUiTestRows(
  db: Knex,
  params: {
    tenantId: string | null;
    ticketId: string | null;
    associationIds: string[];
    documentIds: string[];
    fileIds: string[];
  }
) {
  if (!params.tenantId) return;
  const tenantId = params.tenantId;

  if (params.associationIds.length > 0) {
    await db('document_associations')
      .where({ tenant: tenantId })
      .whereIn('association_id', params.associationIds)
      .delete();
  }
  if (params.documentIds.length > 0) {
    await db('documents').where({ tenant: tenantId }).whereIn('document_id', params.documentIds).delete();
  }
  if (params.fileIds.length > 0) {
    await db('external_files').where({ tenant: tenantId }).whereIn('file_id', params.fileIds).delete();
  }
  if (params.ticketId) {
    await db('comments').where({ tenant: tenantId, ticket_id: params.ticketId }).delete();
    await db('tickets').where({ tenant: tenantId, ticket_id: params.ticketId }).delete();
  }
}
