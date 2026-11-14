import { test, expect, type Page } from '@playwright/test';
import { tenantDb } from '@alga-psa/db/tenantDb';
import { v4 as uuidv4 } from 'uuid';

import { E2ETestContext } from '../utils/test-context-e2e';
import {
  applyPlaywrightAuthEnvDefaults,
  resolvePlaywrightBaseUrl,
  setupAuthenticatedSession,
} from './helpers/playwrightAuthSessionHelper';
import { seedPermissionsForTenant, grantAllPermissionsToRole } from './helpers/permissionTestHelper';

applyPlaywrightAuthEnvDefaults();

const TEST_CONFIG = {
  baseUrl: resolvePlaywrightBaseUrl(),
};

const MIB = 1024 * 1024;

/**
 * Uploads through `DocumentUpload` on a ticket go to the resumable session API
 * (`/api/documents/uploads`): create, PUT chunks, complete. The uploader shows committed bytes in a
 * progress bar and names the API's limit when a file is over it.
 */
test.describe('Chunked document upload on a ticket', () => {
  let context: E2ETestContext;
  let ticketId: string;

  function tenantTable(tenantId: string, table: string) {
    return tenantDb(context.db, tenantId).table(table);
  }

  test.beforeAll(async () => {
    context = new E2ETestContext({
      baseUrl: TEST_CONFIG.baseUrl,
      browserOptions: { headless: false, slowMo: 100 },
    });
    await context.initialize();
    await context.waitForAppReady();
  });

  test.afterAll(async () => {
    if (context) await context.cleanup();
  });

  test.beforeEach(async () => {
    await context.reset();
    const tenantId = context.tenantData.tenant.tenantId;
    await seedPermissionsForTenant(context.db, tenantId);
    await grantAllPermissionsToRole(context.db, tenantId, 'Admin');

    const client = {
      client_id: uuidv4(),
      tenant: tenantId,
      client_name: `Upload Client ${Date.now()}`,
      is_inactive: false,
      is_tax_exempt: false,
      billing_cycle: 'monthly',
      created_at: new Date(),
      updated_at: new Date(),
    };
    await tenantTable(tenantId, 'clients').insert(client);
    const board = { board_id: uuidv4(), tenant: tenantId, board_name: 'Upload Board' };
    await tenantTable(tenantId, 'boards').insert(board);
    ticketId = uuidv4();
    await tenantTable(tenantId, 'tickets').insert({
      ticket_id: ticketId,
      tenant: tenantId,
      ticket_number: `UPLOAD-${Date.now()}`,
      title: 'Ticket with a large attachment',
      client_id: client.client_id,
      is_closed: false,
      entered_at: new Date(),
      updated_at: new Date(),
      board_id: board.board_id,
    });

    await setupAuthenticatedSession(context.page, context.tenantData, { baseUrl: TEST_CONFIG.baseUrl });
  });

  async function openUploader(page: Page) {
    await page.goto(`${TEST_CONFIG.baseUrl}/msp/tickets/${ticketId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.locator('#documents-upload-btn').or(page.getByRole('button', { name: /upload/i })).first().click();
    await page.locator('#select-file-button').waitFor({ state: 'visible', timeout: 15_000 });
  }

  /** Picks a file, then confirms the root folder in the destination dialog. */
  async function chooseFile(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
    await page.locator('input[type="file"]').first().setInputFiles(file);
    await page.locator('#folder-selector-confirm-btn').click();
  }

  test('uploads a multi-chunk file with visible progress and lists the document', async () => {
    test.setTimeout(180_000);
    const { page, tenantData } = context;
    const tenantId = tenantData.tenant.tenantId;
    const fileName = `large-attachment-${Date.now()}.bin`;

    // Hold each chunk briefly so the progress bar is observable; the bytes still go to the server.
    await page.route('**/api/documents/uploads/*', async (route) => {
      if (route.request().method() === 'PUT') await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });

    await openUploader(page);
    // 20 MiB: three chunks at the server's 8 MiB chunk size.
    await chooseFile(page, { name: fileName, mimeType: 'application/octet-stream', buffer: Buffer.alloc(20 * MIB, 7) });

    const progress = page.getByRole('progressbar', { name: `Upload progress for ${fileName}` });
    await expect(progress).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/\d+(\.\d+)? MB of 20 MB/).first()).toBeVisible();

    await expect(page.getByText(fileName).first()).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText('Uploaded')).toBeVisible({ timeout: 120_000 });

    const documents = await tenantTable(tenantId, 'documents').where({ document_name: fileName });
    expect(documents).toHaveLength(1);
    const associations = await tenantTable(tenantId, 'document_associations')
      .where({ document_id: documents[0].document_id, entity_type: 'ticket', entity_id: ticketId });
    expect(associations).toHaveLength(1);
  });

  test('names the file size and the limit the API reports when a file is over it', async () => {
    test.setTimeout(120_000);
    const { page } = context;
    const limit = 1 * MIB;
    const fileName = `too-big-${Date.now()}.bin`;
    const followUps: string[] = [];

    // The API refuses at create, before any chunk goes out. The mocked limit is below the 2 MiB file.
    await page.route('**/api/documents/uploads', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({
        status: 413,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'UPLOAD_TOO_LARGE', message: 'File size exceeds limit', maxFileSize: limit } }),
      });
    });
    // Any request on a session URL (a chunk PUT, HEAD, complete or DELETE) means bytes were sent.
    page.on('request', (request) => {
      if (/\/api\/documents\/uploads\/[^/?]+/.test(request.url())) followUps.push(`${request.method()} ${request.url()}`);
    });

    await openUploader(page);
    await chooseFile(page, { name: fileName, mimeType: 'application/octet-stream', buffer: Buffer.alloc(2 * MIB) });

    await expect(page.getByText('This file is 2 MB. The current limit is 1 MB per file.')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Failed to upload file')).toHaveCount(0);
    expect(followUps).toEqual([]); // no PUT, no complete
  });
});
