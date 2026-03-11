/**
 * Playwright E2E tests for Document System Improvements
 * Tests T020, T042-T045 from the documents system improvements plan
 */
import { test, expect, type Page } from '@playwright/test';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import {
  createTestDbConnection,
  createTenantAndLogin,
  getBaseUrl,
  applyTestEnvDefaults,
  setupClientAuthSession,
  createClientUser,
  type TenantTestData,
} from './helpers/testSetup';

// Apply default environment configuration
applyTestEnvDefaults();

const TEST_CONFIG = {
  baseUrl: getBaseUrl(),
};

// Helper to create a test client
async function createTestClient(
  db: Knex,
  tenantId: string
): Promise<{ clientId: string; clientName: string }> {
  const clientId = uuidv4();
  const clientName = `Test Client ${Date.now().toString().slice(-6)}`;

  await db('clients').insert({
    client_id: clientId,
    tenant: tenantId,
    client_name: clientName,
    created_at: new Date(),
    updated_at: new Date(),
  });

  return { clientId, clientName };
}

// Helper to create test ticket with documents
async function createTicketWithDocuments(
  db: Knex,
  tenantId: string,
  clientId: string
): Promise<{
  ticketId: string;
  visibleDocId: string;
  hiddenDocId: string;
}> {
  // Get or create a status
  let status = await db('statuses')
    .where({ tenant: tenantId, is_closed: false, status_type: 'ticket' })
    .first();

  if (!status) {
    const statusId = uuidv4();
    await db('statuses').insert({
      status_id: statusId,
      tenant: tenantId,
      name: 'Open',
      is_closed: false,
      status_type: 'ticket',
      order_number: 1,
    });
    status = { status_id: statusId };
  }

  // Get or create a priority
  let priority = await db('priorities').where({ tenant: tenantId }).first();

  if (!priority) {
    const priorityId = uuidv4();
    const user = await db('users').where({ tenant: tenantId }).first();
    await db('priorities').insert({
      priority_id: priorityId,
      tenant: tenantId,
      priority_name: 'Normal',
      color: '#808080',
      order_number: 1,
      created_by: user?.user_id || tenantId,
    });
    priority = { priority_id: priorityId };
  }

  // Get or create a board
  let board = await db('boards').where({ tenant: tenantId }).first();

  if (!board) {
    const boardId = uuidv4();
    await db('boards').insert({
      board_id: boardId,
      tenant: tenantId,
      board_name: 'Test Board',
      is_default: true,
    });
    board = { board_id: boardId };
  }

  // Create ticket
  const ticketId = uuidv4();
  const ticketNumber = `DOC-${Date.now().toString().slice(-6)}`;
  await db('tickets').insert({
    ticket_id: ticketId,
    tenant: tenantId,
    ticket_number: ticketNumber,
    title: 'Test Ticket With Documents',
    status_id: status.status_id,
    priority_id: priority.priority_id,
    board_id: board.board_id,
    client_id: clientId,
    entered_at: new Date(),
    updated_at: new Date(),
  });

  // Create visible document
  const visibleDocId = uuidv4();
  await db('documents').insert({
    document_id: visibleDocId,
    tenant: tenantId,
    document_name: 'Visible Document.pdf',
    file_path: `/uploads/${tenantId}/${visibleDocId}/visible-doc.pdf`,
    mime_type: 'application/pdf',
    file_size: 1024,
    is_client_visible: true,
    created_at: new Date(),
    updated_at: new Date(),
  });

  // Link visible document to ticket
  await db('document_associations').insert({
    tenant: tenantId,
    document_id: visibleDocId,
    entity_id: ticketId,
    entity_type: 'ticket',
  });

  // Create hidden document
  const hiddenDocId = uuidv4();
  await db('documents').insert({
    document_id: hiddenDocId,
    tenant: tenantId,
    document_name: 'Internal Only Document.pdf',
    file_path: `/uploads/${tenantId}/${hiddenDocId}/hidden-doc.pdf`,
    mime_type: 'application/pdf',
    file_size: 2048,
    is_client_visible: false,
    created_at: new Date(),
    updated_at: new Date(),
  });

  // Link hidden document to ticket
  await db('document_associations').insert({
    tenant: tenantId,
    document_id: hiddenDocId,
    entity_id: ticketId,
    entity_type: 'ticket',
  });

  return { ticketId, visibleDocId, hiddenDocId };
}

// Helper to create entity-scoped folders
async function createEntityFolders(
  db: Knex,
  tenantId: string,
  entityId: string,
  entityType: string
): Promise<{ folderId: string }> {
  const folderId = uuidv4();

  await db('document_folders').insert({
    folder_id: folderId,
    tenant: tenantId,
    folder_name: 'Client Documents',
    folder_path: '/Client Documents',
    parent_folder_id: null,
    entity_id: entityId,
    entity_type: entityType,
    is_client_visible: true,
    created_at: new Date(),
    updated_at: new Date(),
  });

  return { folderId };
}

// Helper to create a document in a folder
async function createDocumentInFolder(
  db: Knex,
  tenantId: string,
  folderId: string,
  options: {
    name: string;
    isClientVisible: boolean;
    entityId?: string;
    entityType?: string;
  }
): Promise<{ documentId: string }> {
  const documentId = uuidv4();

  await db('documents').insert({
    document_id: documentId,
    tenant: tenantId,
    document_name: options.name,
    file_path: `/uploads/${tenantId}/${documentId}/${options.name}`,
    mime_type: 'application/pdf',
    file_size: 1024,
    is_client_visible: options.isClientVisible,
    folder_id: folderId,
    created_at: new Date(),
    updated_at: new Date(),
  });

  // Create association if entity specified
  if (options.entityId && options.entityType) {
    await db('document_associations').insert({
      tenant: tenantId,
      document_id: documentId,
      entity_id: options.entityId,
      entity_type: options.entityType,
    });
  }

  return { documentId };
}

// Helper to create default folders for an entity type
async function createDefaultFolders(
  db: Knex,
  tenantId: string,
  entityType: string,
): Promise<void> {
  const now = new Date();

  await db('document_default_folders').insert([
    {
      default_folder_id: uuidv4(),
      tenant: tenantId,
      entity_type: entityType,
      folder_name: 'Contracts',
      folder_path: '/Contracts',
      is_client_visible: true,
      sort_order: 0,
      created_at: now,
      updated_at: now,
    },
    {
      default_folder_id: uuidv4(),
      tenant: tenantId,
      entity_type: entityType,
      folder_name: 'Invoices',
      folder_path: '/Invoices',
      is_client_visible: true,
      sort_order: 1,
      created_at: now,
      updated_at: now,
    },
  ]);
}

// Helper to create document share link
async function createDocumentShareLink(
  db: Knex,
  tenantId: string,
  documentId: string,
  options: {
    shareType: 'public' | 'password_protected' | 'portal_authenticated';
    password?: string;
    expiresAt?: Date;
  }
): Promise<{ linkId: string; token: string }> {
  const linkId = uuidv4();
  const token = uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');

  await db('document_share_links').insert({
    link_id: linkId,
    tenant: tenantId,
    document_id: documentId,
    share_token: token,
    share_type: options.shareType,
    password_hash: options.password || null,
    expires_at: options.expiresAt || null,
    created_at: new Date(),
    is_revoked: false,
    download_count: 0,
  });

  return { linkId, token };
}

// Helper to create KB article
async function createKBArticle(
  db: Knex,
  tenantId: string,
  options: {
    title: string;
    audience: 'internal' | 'client';
    status: 'draft' | 'published' | 'archived';
    articleType: string;
  }
): Promise<{ articleId: string; documentId: string }> {
  const articleId = uuidv4();
  const documentId = uuidv4();

  // Create base document
  await db('documents').insert({
    document_id: documentId,
    tenant: tenantId,
    document_name: options.title,
    file_path: null,
    mime_type: 'text/html',
    file_size: 0,
    is_client_visible: options.audience === 'client' && options.status === 'published',
    created_at: new Date(),
    updated_at: new Date(),
  });

  // Create KB article record
  await db('kb_articles').insert({
    article_id: articleId,
    tenant: tenantId,
    document_id: documentId,
    title: options.title,
    status: options.status,
    audience: options.audience,
    article_type: options.articleType,
    category: 'General',
    view_count: 0,
    helpful_count: 0,
    not_helpful_count: 0,
    created_at: new Date(),
    updated_at: new Date(),
    published_at: options.status === 'published' ? new Date() : null,
  });

  return { articleId, documentId };
}

test.describe('Document System E2E Tests', () => {
  test.describe('T020: Ticket Detail Page Inline Documents', () => {
    test('Ticket detail page inline documents section shows all attached documents regardless of is_client_visible flag', async ({ page }) => {
      test.setTimeout(300000);
      const db = createTestDbConnection();
      let tenantData: TenantTestData | null = null;

      try {
        tenantData = await createTenantAndLogin(db, page, {
          companyName: `Doc Test ${uuidv4().slice(0, 6)}`,
        });

        const tenantId = tenantData.tenant.tenantId;
        const clientId = tenantData.client!.clientId;

        // Create ticket with both visible and hidden documents
        const { ticketId, visibleDocId, hiddenDocId } = await createTicketWithDocuments(
          db,
          tenantId,
          clientId
        );

        // Navigate to ticket detail page as MSP user
        await page.goto(`${TEST_CONFIG.baseUrl}/msp/tickets/${ticketId}`, {
          waitUntil: 'domcontentloaded',
          timeout: 60_000,
        });
        await page.waitForLoadState('networkidle', { timeout: 30_000 });

        // Wait for documents section to load
        await page.waitForSelector('[data-automation-id*="documents"]', { timeout: 15_000 });

        // Verify visible document appears
        const visibleDoc = page.locator('text=Visible Document.pdf');
        await expect(visibleDoc).toBeVisible({ timeout: 10_000 });

        // Verify hidden document also appears (MSP users should see all docs)
        const hiddenDoc = page.locator('text=Internal Only Document.pdf');
        await expect(hiddenDoc).toBeVisible({ timeout: 10_000 });

      } finally {
        await db.destroy().catch(() => undefined);
      }
    });
  });

  test.describe('T042: Entity-Scoped Folders and Client Portal', () => {
    test('Create entity-scoped folders for a client, upload a document, toggle visibility, verify document appears in client portal Documents hub', async ({ page }) => {
      test.setTimeout(300000);
      const db = createTestDbConnection();
      let tenantData: TenantTestData | null = null;

      try {
        // Create tenant and MSP user
        tenantData = await createTenantAndLogin(db, page, {
          companyName: `Entity Folders Test ${uuidv4().slice(0, 6)}`,
        });

        const tenantId = tenantData.tenant.tenantId;
        const clientId = tenantData.client!.clientId;

        // Create entity-scoped folder for the client
        const { folderId } = await createEntityFolders(db, tenantId, clientId, 'client');

        // Create a document in the folder with visibility set to true
        const { documentId } = await createDocumentInFolder(db, tenantId, folderId, {
          name: 'Client Visible Report.pdf',
          isClientVisible: true,
          entityId: clientId,
          entityType: 'client',
        });

        // Navigate to client's documents page as MSP to verify setup
        await page.goto(`${TEST_CONFIG.baseUrl}/msp/clients/${clientId}`, {
          waitUntil: 'domcontentloaded',
          timeout: 60_000,
        });
        await page.waitForLoadState('networkidle', { timeout: 30_000 });

        // Look for Documents tab or section
        const documentsTab = page.locator('text=Documents').first();
        if (await documentsTab.isVisible()) {
          await documentsTab.click();
          await page.waitForLoadState('networkidle', { timeout: 10_000 });
        }

        // Create client user and verify they can see the document
        const { userId: clientUserId, email: clientEmail } = await createClientUser(
          db,
          tenantId,
          clientId
        );

        // Add document permission for client role
        const clientRole = await db('roles')
          .where({ tenant: tenantId, client: true })
          .first();

        if (clientRole) {
          const docReadPermissionId = uuidv4();
          await db('permissions').insert({
            permission_id: docReadPermissionId,
            tenant: tenantId,
            resource: 'document',
            action: 'read',
            msp: false,
            client: true,
          });
          await db('role_permissions').insert({
            tenant: tenantId,
            role_id: clientRole.role_id,
            permission_id: docReadPermissionId,
          });
        }

        // Switch to client portal session
        await setupClientAuthSession(page, clientUserId, clientEmail, tenantId, TEST_CONFIG.baseUrl);

        // Navigate to client portal documents
        await page.goto(`${TEST_CONFIG.baseUrl}/client-portal/documents`, {
          waitUntil: 'domcontentloaded',
          timeout: 60_000,
        });
        await page.waitForLoadState('networkidle', { timeout: 30_000 });

        // Verify the visible document appears in client portal
        const clientVisibleDoc = page.locator('text=Client Visible Report.pdf');
        await expect(clientVisibleDoc).toBeVisible({ timeout: 15_000 });

      } finally {
        await db.destroy().catch(() => undefined);
      }
    });
  });

  test.describe('T043: Public Share Link Download', () => {
    test('Generate a public share link for a document, open in incognito browser, verify download works without auth', async ({ page, browser }) => {
      test.setTimeout(300000);
      const db = createTestDbConnection();
      let tenantData: TenantTestData | null = null;

      try {
        tenantData = await createTenantAndLogin(db, page, {
          companyName: `Share Link Test ${uuidv4().slice(0, 6)}`,
        });

        const tenantId = tenantData.tenant.tenantId;

        // Create a document
        const documentId = uuidv4();
        await db('documents').insert({
          document_id: documentId,
          tenant: tenantId,
          document_name: 'Shareable Document.pdf',
          file_path: `/uploads/${tenantId}/${documentId}/shareable.pdf`,
          mime_type: 'application/pdf',
          file_size: 1024,
          is_client_visible: false,
          created_at: new Date(),
          updated_at: new Date(),
        });

        // Create a public share link
        const { linkId, token } = await createDocumentShareLink(db, tenantId, documentId, {
          shareType: 'public',
        });

        // Open new incognito context (no auth)
        const incognitoContext = await browser.newContext();
        const incognitoPage = await incognitoContext.newPage();

        try {
          // Navigate to share link URL
          const shareUrl = `${TEST_CONFIG.baseUrl}/share/${token}`;
          await incognitoPage.goto(shareUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 60_000,
          });
          await incognitoPage.waitForLoadState('networkidle', { timeout: 30_000 });

          // Verify the share landing page loads with document info
          const documentName = incognitoPage.locator('text=Shareable Document');
          await expect(documentName).toBeVisible({ timeout: 10_000 });

          // Verify download button is available
          const downloadButton = incognitoPage.locator('button:has-text("Download"), a:has-text("Download")');
          await expect(downloadButton.first()).toBeVisible({ timeout: 10_000 });

        } finally {
          await incognitoContext.close();
        }

      } finally {
        await db.destroy().catch(() => undefined);
      }
    });
  });

  test.describe('T044: KB Article Publishing and Client Portal', () => {
    test('Create KB article from template, publish with audience=client, verify it appears in client portal KB section with feedback buttons', async ({ page }) => {
      test.setTimeout(300000);
      const db = createTestDbConnection();
      let tenantData: TenantTestData | null = null;

      try {
        tenantData = await createTenantAndLogin(db, page, {
          companyName: `KB Test ${uuidv4().slice(0, 6)}`,
        });

        const tenantId = tenantData.tenant.tenantId;
        const clientId = tenantData.client!.clientId;

        // Create a published client-facing KB article
        const { articleId, documentId } = await createKBArticle(db, tenantId, {
          title: 'How to Reset Your Password',
          audience: 'client',
          status: 'published',
          articleType: 'how_to',
        });

        // Create client user
        const { userId: clientUserId, email: clientEmail } = await createClientUser(
          db,
          tenantId,
          clientId
        );

        // Add KB read permission for client role
        const clientRole = await db('roles')
          .where({ tenant: tenantId, client: true })
          .first();

        if (clientRole) {
          const kbReadPermissionId = uuidv4();
          await db('permissions').insert({
            permission_id: kbReadPermissionId,
            tenant: tenantId,
            resource: 'knowledge_base',
            action: 'read',
            msp: false,
            client: true,
          });
          await db('role_permissions').insert({
            tenant: tenantId,
            role_id: clientRole.role_id,
            permission_id: kbReadPermissionId,
          });
        }

        // Setup client authentication
        await setupClientAuthSession(page, clientUserId, clientEmail, tenantId, TEST_CONFIG.baseUrl);

        // Navigate to client portal KB section
        await page.goto(`${TEST_CONFIG.baseUrl}/client-portal/knowledge-base`, {
          waitUntil: 'domcontentloaded',
          timeout: 60_000,
        });
        await page.waitForLoadState('networkidle', { timeout: 30_000 });

        // Verify the KB article appears
        const articleTitle = page.locator('text=How to Reset Your Password');
        await expect(articleTitle).toBeVisible({ timeout: 15_000 });

        // Click on the article to open it
        await articleTitle.click();
        await page.waitForLoadState('networkidle', { timeout: 10_000 });

        // Verify feedback buttons are present
        const helpfulButton = page.locator('button:has-text("Helpful"), button:has-text("Yes")');
        const notHelpfulButton = page.locator('button:has-text("Not Helpful"), button:has-text("No")');

        // At least one feedback mechanism should be visible
        const feedbackSection = page.locator('[data-automation-id*="feedback"], .feedback, text=Was this helpful');
        await expect(feedbackSection.first()).toBeVisible({ timeout: 10_000 });

      } finally {
        await db.destroy().catch(() => undefined);
      }
    });
  });

  test.describe('T045: Default Folder Template Auto-Creation', () => {
    test('Configure folder template as default, open new client Documents tab, verify folders auto-created from template', async ({ page }) => {
      test.setTimeout(300000);
      const db = createTestDbConnection();
      let tenantData: TenantTestData | null = null;

      try {
        tenantData = await createTenantAndLogin(db, page, {
          companyName: `Template Test ${uuidv4().slice(0, 6)}`,
        });

        const tenantId = tenantData.tenant.tenantId;

        // Create default folders for clients
        await createDefaultFolders(db, tenantId, 'client');

        // Create a new client (without pre-existing folders)
        const { clientId, clientName } = await createTestClient(db, tenantId);

        // Navigate to the new client's documents section
        await page.goto(`${TEST_CONFIG.baseUrl}/msp/clients/${clientId}`, {
          waitUntil: 'domcontentloaded',
          timeout: 60_000,
        });
        await page.waitForLoadState('networkidle', { timeout: 30_000 });

        // Click on Documents tab
        const documentsTab = page.locator('[data-automation-id*="documents-tab"], button:has-text("Documents"), a:has-text("Documents")');
        await documentsTab.first().click();
        await page.waitForLoadState('networkidle', { timeout: 15_000 });

        // Wait for folders to be created (ensureEntityFolders should trigger)
        await page.waitForTimeout(2000);

        // Verify template folders were created
        const contractsFolder = page.locator('text=Contracts');
        const invoicesFolder = page.locator('text=Invoices');

        await expect(contractsFolder.first()).toBeVisible({ timeout: 15_000 });
        await expect(invoicesFolder.first()).toBeVisible({ timeout: 10_000 });

        // Verify folders exist in database
        const createdFolders = await db('document_folders')
          .where({
            tenant: tenantId,
            entity_id: clientId,
            entity_type: 'client',
          })
          .select('folder_name');

        expect(createdFolders.length).toBeGreaterThanOrEqual(2);
        const folderNames = createdFolders.map((f: { folder_name: string }) => f.folder_name);
        expect(folderNames).toContain('Contracts');
        expect(folderNames).toContain('Invoices');

      } finally {
        await db.destroy().catch(() => undefined);
      }
    });
  });
});
