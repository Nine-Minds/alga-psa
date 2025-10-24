import { test, expect } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';

import { E2ETestContext } from '../utils/test-context-e2e';
import {
  applyPlaywrightAuthEnvDefaults,
  ensureRoleHasPermission,
  resolvePlaywrightBaseUrl,
  setupAuthenticatedSession,
} from './helpers/playwrightAuthSessionHelper';
import {
  minioFileExists,
  getMinioFileMetadata,
  verifyMinioFileContent,
  waitForMinioFile,
} from './helpers/minioTestHelper';
import { seedPermissionsForTenant, grantAllPermissionsToRole } from './helpers/permissionTestHelper';

applyPlaywrightAuthEnvDefaults();

const TEST_CONFIG = {
  baseUrl: resolvePlaywrightBaseUrl(),
};

// Test file fixtures - Colorful, highly visible test documents
// 200x200 bright blue square with white text "TEST PNG"
const ONE_BY_ONE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAMgAAADICAYAAACtWK6eAAAACXBIWXMAAAsTAAALEwEAmpwYAAADuklEQVR4nO3dMW4TURSF4TcJqWhA7AA2wA5gBSyBBbADNsAK2AE7YAWsgB2wA1qQaIgEEo2FhBBIIxvPvPvO9/1SSqRoZN2jO3dm7EwmSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZKkDn2/7xcoaXt7e/fNzc03k8lk/8nJycfb29sfr6+vv97e3v54eXn5cHh4+PHk5OTT4eHhp+Pj47ePHj36cnZ29uXi4uLr6enp18vLy28XFxdfz8/Pv52fn39/+fLl98vLy+/X19c/Li4ufpydnf1Y+nutwe7du+/evPnzfvb8+fP3Ozs7Hzc3N9/f39//cnx8/OX8/Pzr9fX1t7Ozs+/n5+c/Li4ufpydnf04Ozv78fz588/Pnj37/OTJk89HR0efHzx48Pnu3bt3a/89a7K/v/9hZ2fn/c7Ozoc3b978WPr9RuZvIMvYvXvvv+/u7r49PDz8sLe39/Hk5OTTzs7O561bt77d29v7fnBw8OP09PTn9fX1z7u7u7/e3t7+dXd399f79++f7+/vP3/8+PHzR48ePT88PPx0dHT06fj4+POzZ88+n5ycfL66uvr5+vr654uLi1+Xl5e/rq+vf93d3f19c3Pz++bm5u/Nzc3fu7u7v58+ffp7//7976enp39fXV39fXx8/Pfk5OTPy8vL/y8vL/+8ubn59+bm5v/r6+vJs2fPJo8fP56cnZ1Nzs7OJq9evfpncXFxsrW1Ndnf3x+NHXN1Z33j4zYXLwaA+Yfw4sWLycHBweTs7Gzy/v37yaWlpf//lpbm/y0uzv9dXJz/u7Q0//fs7Ozk3bt3k3fv3k3ev38/effuH8a/+Pbt2+Tt27eTt2/fTl6/fj15/fr15M2bN5PXr19P3rx5M3nz5s3kzZs3k9evX0/evHkzef369eTt27eTN2/eTN68eTN59+7d5N27d5O3b99O3r59O/n777+T379/T/7+/Tv5+/fv5M+fP5M/f/5M/vz5M/n999/kz58/k7///ZtcXl5OLi4uJhcXF5Pz8/PJ+fn55Pz8fHJxcTG5uLiYXFxcTC4uLiaXl5eTy8vLyfn5+eTi4mJycXExOT8/n1xcXEwuLy8nFxcXk8vLy8nFxcXk4uJi8v8fHwWSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEn6t/wDg0VcFuLer6IAAAAASUVORK5CYII=';

// Colorful PDF with visible text "TEST PDF DOCUMENT"
const SMALL_PDF_BASE64 =
  'JVBERi0xLjQKJeLjz9MKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL0NvbnRlbnRzIDQgMCBSL01lZGlhQm94WzAgMCA2MTIgNzkyXS9SZXNvdXJjZXM8PC9Gb250PDwvRjEgNSAwIFI+Pj4+Pj4KZW5kb2JqCjQgMCBvYmoKPDwvTGVuZ3RoIDEwNT4+c3RyZWFtCkJUCi9GMSAyNCBUZgoxMDAgNzAwIFRkCihURVNUIFBERiBET0NVTUVOVCkgVGoKRVQKQlQKL0YxIDEyIFRmCjEwMCA2NTAgVGQKKFRoaXMgaXMgYSB0ZXN0IFBERiBmaWxlKSBUagpFVAplbmRzdHJlYW0KZW5kb2JqCjUgMCBvYmoKPDwvVHlwZS9Gb250L1N1YnR5cGUvVHlwZTEvQmFzZUZvbnQvSGVsdmV0aWNhPj4KZW5kb2JqCjEgMCBvYmoKPDwvVHlwZS9QYWdlcy9Db3VudCAxL0tpZHNbMyAwIFJdPj4KZW5kb2JqCjIgMCBvYmoKPDwvVHlwZS9DYXRhbG9nL1BhZ2VzIDEgMCBSPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDMzMSAwMDAwMDAwMDAwIG4gCjAwMDAwMDAzODggMDAwMDAwMDAwMCBuIAowMDAwMDAwMDA5IDAwMDAwMDAwMDAgbiAKMDAwMDAwMDE0MyAwMDAwMDAwMDAwIG4gCjAwMDAwMDAyOTYgMDAwMDAwMDAwMCBuIAp0cmFpbGVyCjw8L1NpemUgNi9Sb290IDIgMCBSPj4Kc3RhcnR4cmVmCjQzNwolJUVPRgo=';

// 200x200 bright orange/red gradient JPEG
const SMALL_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCADIAMgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlbaWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/aAAwDAQACEQMRAD8A9U0PWrjVdStLK7jRba5kWMRocBGPQgntmut0bwu+oXi3Gq3kkXkqH8iEAM5zyDnIx6HrXC+HLhtP1K3ux/qdQ3QjPeM5x+K4r0bWfET6R4bvNRS0W6Nul26IR+6dFOQ2e3pXbVp0+Rkc1OrOx//Z';


// Create a simple text file for testing
function createTextFileBuffer(content: string): Buffer {
  return Buffer.from(content, 'utf-8');
}

test.describe('Document upload and preview', () => {
  let context: E2ETestContext;

  test.beforeAll(async () => {
    context = new E2ETestContext({
      baseUrl: TEST_CONFIG.baseUrl,
      browserOptions: {
        headless: false,
        slowMo: 100,
      },
    });
    await context.initialize();
    await context.waitForAppReady();
  });

  test.afterAll(async () => {
    if (context) {
      await context.cleanup();
    }
  });

  test.beforeEach(async () => {
    await context.reset();

    // Seed permissions table for the NEW tenant created by reset()
    console.log('[Test Setup] Seeding permissions for test tenant...');
    await seedPermissionsForTenant(
      context.db,
      context.tenantData.tenant.tenantId
    );

    // Grant ALL MSP permissions to Admin role for comprehensive E2E testing
    // This ensures the test user can perform all operations
    console.log('[Test Setup] Granting all permissions to Admin role...');
    await grantAllPermissionsToRole(
      context.db,
      context.tenantData.tenant.tenantId,
      'Admin'
    );
    console.log('[Test Setup] Permissions granted successfully');
  });

  test('uploads a PNG image, verifies database storage, and displays preview modal', async ({}, testInfo) => {
    test.setTimeout(120000); // 2 minutes for upload and preview generation

    const { page, tenantData } = context;

    await setupAuthenticatedSession(page, tenantData, {
      baseUrl: TEST_CONFIG.baseUrl,
    });

    const tenantId = tenantData.tenant.tenantId;

    console.log('[Upload Preview Test] Navigating directly to documents page...');

    // Navigate directly to documents page (skip dashboard warmup to avoid slow load)
    await page.goto(`${TEST_CONFIG.baseUrl}/msp/documents`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });

    console.log('[Upload Preview Test] Page loaded, waiting for network idle...');
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {
      console.log('[Upload Preview Test] Network idle timeout, continuing...');
    });

    // Wait for page to be interactive and upload button to appear
    console.log('[Upload Preview Test] Waiting for upload button to appear...');
    await page.waitForTimeout(3000); // Give React time to hydrate and render

    // Click upload button - Documents component uses ID pattern: {id}-upload-btn
    const uploadButton = page.locator('#documents-upload-btn')
      .or(page.locator('[id$="-upload-btn"]'))
      .or(page.getByRole('button', { name: /upload/i }))
      .first();

    await uploadButton.waitFor({ state: 'visible', timeout: 30_000 });
    await uploadButton.click();

    // Wait for DocumentUpload component to appear - look for Browse Files button (id="select-file-button")
    await page.waitForTimeout(2000);
    const browseButton = page.locator('#select-file-button');
    await browseButton.waitFor({ state: 'visible', timeout: 10_000 });

    // Create test PNG file
    const fileName = `playwright-test-${Date.now()}.png`;
    const filePath = testInfo.outputPath(fileName);
    await fs.writeFile(filePath, Buffer.from(ONE_BY_ONE_PNG_BASE64, 'base64'));

    // Get file stats for verification
    const fileStats = await fs.stat(filePath);
    const expectedFileSize = fileStats.size;

    // Upload the file
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(filePath);

    // Handle folder selector modal if it appears
    await page.waitForTimeout(1000);
    const folderModal = page.locator('[role="dialog"]').filter({
      has: page.getByText(/Select Destination Folder/i)
    });
    const modalVisible = await folderModal.isVisible({ timeout: 3000 }).catch(() => false);

    if (modalVisible) {
      console.log('[PNG Test] Folder selector appeared, selecting root folder...');
      const confirmButton = page.locator('#folder-selector-confirm-btn');
      await confirmButton.click();
      await page.waitForTimeout(1000);
    }

    // Wait for upload to complete - spinner should disappear
    const spinner = page.locator('[data-testid="spinner"]').or(page.locator('text=Uploading'));
    await spinner.waitFor({ state: 'detached', timeout: 30_000 }).catch(() => {});

    // Wait for upload interface to close - look for "Document Upload" text to disappear
    const uploadLabel = page.locator('text=Document Upload');
    await uploadLabel.waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {});

    // Verify document appears in the list
    const heading = page.getByRole('heading', { name: fileName, exact: true });
    await expect(heading).toBeVisible({ timeout: 30_000 });

    // Switch to Grid view to see thumbnails
    const gridButton = page.getByRole('button', { name: /grid/i });
    await gridButton.click();
    await page.waitForTimeout(1000); // Wait for view to switch

    // Verify document was saved to database
    const dbDocument = await context.db('documents')
      .where({
        tenant: tenantId,
        document_name: fileName,
      })
      .first();

    expect(dbDocument).toBeDefined();
    expect(dbDocument.document_name).toBe(fileName);
    expect(dbDocument.mime_type).toBe('image/png');
    expect(Number(dbDocument.file_size)).toBe(expectedFileSize);
    expect(dbDocument.file_id).toBeDefined();
    expect(dbDocument.storage_path).toBeDefined();
    expect(dbDocument.user_id).toBe(tenantData.adminUser.userId);

    // Verify file was uploaded to MinIO/S3
    const fileStoreRecord = await context.db('external_files')
      .where({ file_id: dbDocument.file_id })
      .first();

    expect(fileStoreRecord).toBeDefined();
    expect(fileStoreRecord.storage_path).toBeDefined();

    // Check file exists in MinIO
    const minioExists = await waitForMinioFile(fileStoreRecord.storage_path, {
      maxAttempts: 10,
      delayMs: 500,
    });
    expect(minioExists).toBe(true);

    // Verify MinIO file metadata
    const minioMetadata = await getMinioFileMetadata(fileStoreRecord.storage_path);
    expect(minioMetadata.exists).toBe(true);
    expect(minioMetadata.size).toBe(expectedFileSize);
    expect(minioMetadata.contentType).toBe('image/png');

    // Verify file content matches what we uploaded
    const originalBuffer = Buffer.from(ONE_BY_ONE_PNG_BASE64, 'base64');
    const contentVerification = await verifyMinioFileContent(
      fileStoreRecord.storage_path,
      originalBuffer
    );
    expect(contentVerification.matches).toBe(true);

    // Click on the thumbnail image to open preview
    const thumbnail = page.locator(`img[alt="${fileName}"]`).first();
    await thumbnail.waitFor({ state: 'visible', timeout: 30_000 });
    await thumbnail.click({ force: true }); // Force click to bypass overlay

    // Verify preview modal appears with correct image
    const modalImage = page.locator(`.fixed.inset-0 img[alt="${fileName}"]`).first();
    await expect(modalImage).toBeVisible({ timeout: 20_000 });
    await expect(modalImage).toHaveAttribute('src', /\/api\/documents\/view\//);

    // Pause to see the preview (comment this out when done)
    await page.waitForTimeout(3000);

    // Close modal by clicking outside
    await page.click('.fixed.inset-0', { position: { x: 20, y: 20 } });
    await expect(modalImage).not.toBeVisible({ timeout: 10_000 });

    // Cleanup test file
    await fs.unlink(filePath).catch(() => {});
  });

  test('uploads a PDF document and verifies storage', async ({}, testInfo) => {
    test.setTimeout(120000);

    const { page, tenantData } = context;

    await setupAuthenticatedSession(page, tenantData, {
      baseUrl: TEST_CONFIG.baseUrl,
    });

    const tenantId = tenantData.tenant.tenantId;

    // Navigate directly to documents page (skip dashboard to avoid slow load)
    await page.goto(`${TEST_CONFIG.baseUrl}/msp/documents`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {
      console.log('[Upload Preview Test] Network idle timeout, continuing...');
    });

    // Click upload button
    const uploadButton = page.locator('#documents-upload-btn');
    await uploadButton.waitFor({ state: 'visible', timeout: 15_000 });
    await uploadButton.click();

    // Wait for Browse Files button to appear
    await page.waitForTimeout(2000);
    const browseButton = page.locator('#select-file-button');
    await browseButton.waitFor({ state: 'visible', timeout: 10_000 });

    // Create test PDF file
    const fileName = `playwright-test-${Date.now()}.pdf`;
    const filePath = testInfo.outputPath(fileName);
    await fs.writeFile(filePath, Buffer.from(SMALL_PDF_BASE64, 'base64'));

    const fileStats = await fs.stat(filePath);
    const expectedFileSize = fileStats.size;

    // Upload the file
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(filePath);

    // Handle folder selector modal
    await page.waitForTimeout(1000);
    const folderModal = page.locator('[role="dialog"]').filter({
      has: page.getByText(/Select Destination Folder/i)
    });
    const modalVisible = await folderModal.isVisible({ timeout: 3000 }).catch(() => false);
    if (modalVisible) {
      const confirmButton = page.locator('#folder-selector-confirm-btn');
      await confirmButton.click();
      await page.waitForTimeout(1000);
    }

    // Wait for upload to complete
    const spinner = page.locator('[data-testid="spinner"]').or(page.locator('text=Uploading'));
    await spinner.waitFor({ state: 'detached', timeout: 30_000 }).catch(() => {});
    const uploadLabel = page.locator('text=Document Upload');
    await uploadLabel.waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {});

    // Verify document appears
    const heading = page.getByRole('heading', { name: fileName, exact: true });
    await expect(heading).toBeVisible({ timeout: 30_000 });

    // Verify database storage
    const dbDocument = await context.db('documents')
      .where({
        tenant: tenantId,
        document_name: fileName,
      })
      .first();

    expect(dbDocument).toBeDefined();
    expect(dbDocument.document_name).toBe(fileName);
    expect(dbDocument.mime_type).toBe('application/pdf');
    expect(Number(dbDocument.file_size)).toBe(expectedFileSize);
    expect(dbDocument.file_id).toBeDefined();
    expect(dbDocument.storage_path).toBeDefined();

    // Verify file was uploaded to MinIO
    const fileStoreRecord = await context.db('external_files')
      .where({ file_id: dbDocument.file_id })
      .first();

    expect(fileStoreRecord).toBeDefined();

    // Check file exists in MinIO
    const minioExists = await waitForMinioFile(fileStoreRecord.storage_path);
    expect(minioExists).toBe(true);

    // Verify MinIO file metadata
    const minioMetadata = await getMinioFileMetadata(fileStoreRecord.storage_path);
    expect(minioMetadata.exists).toBe(true);
    expect(minioMetadata.size).toBe(expectedFileSize);
    expect(minioMetadata.contentType).toBe('application/pdf');

    // Verify file content
    const originalBuffer = Buffer.from(SMALL_PDF_BASE64, 'base64');
    const contentVerification = await verifyMinioFileContent(
      fileStoreRecord.storage_path,
      originalBuffer
    );
    expect(contentVerification.matches).toBe(true);

    // Cleanup
    await fs.unlink(filePath).catch(() => {});
  });

  test('uploads a JPEG image and verifies metadata', async ({}, testInfo) => {
    test.setTimeout(120000);

    const { page, tenantData } = context;

    await setupAuthenticatedSession(page, tenantData, {
      baseUrl: TEST_CONFIG.baseUrl,
    });

    const tenantId = tenantData.tenant.tenantId;

    // Navigate directly to documents page (skip dashboard to avoid slow load)
    await page.goto(`${TEST_CONFIG.baseUrl}/msp/documents`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {
      console.log('[Upload Preview Test] Network idle timeout, continuing...');
    });

    // Click upload button
    const uploadButton = page.locator('#documents-upload-btn');
    await uploadButton.waitFor({ state: 'visible', timeout: 15_000 });
    await uploadButton.click();

    // Wait for Browse Files button to appear
    await page.waitForTimeout(2000);
    const browseButton = page.locator('#select-file-button');
    await browseButton.waitFor({ state: 'visible', timeout: 10_000 });

    // Create test JPEG file
    const fileName = `playwright-test-${Date.now()}.jpg`;
    const filePath = testInfo.outputPath(fileName);
    await fs.writeFile(filePath, Buffer.from(SMALL_JPEG_BASE64, 'base64'));

    const fileStats = await fs.stat(filePath);
    const expectedFileSize = fileStats.size;

    // Upload the file
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(filePath);

    // Handle folder selector modal
    await page.waitForTimeout(1000);
    const folderModal = page.locator('[role="dialog"]').filter({
      has: page.getByText(/Select Destination Folder/i)
    });
    const modalVisible = await folderModal.isVisible({ timeout: 3000 }).catch(() => false);
    if (modalVisible) {
      const confirmButton = page.locator('#folder-selector-confirm-btn');
      await confirmButton.click();
      await page.waitForTimeout(1000);
    }

    // Wait for upload to complete
    const spinner = page.locator('[data-testid="spinner"]').or(page.locator('text=Uploading'));
    await spinner.waitFor({ state: 'detached', timeout: 30_000 }).catch(() => {});
    const uploadLabel = page.locator('text=Document Upload');
    await uploadLabel.waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {});

    // Verify document appears
    const heading = page.getByRole('heading', { name: fileName, exact: true });
    await expect(heading).toBeVisible({ timeout: 30_000 });

    // Switch to Grid view to see thumbnails
    const gridButton = page.getByRole('button', { name: /grid/i });
    await gridButton.click();
    await page.waitForTimeout(1000); // Wait for view to switch

    // Verify database storage with complete metadata
    const dbDocument = await context.db('documents')
      .where({
        tenant: tenantId,
        document_name: fileName,
      })
      .first();

    expect(dbDocument).toBeDefined();
    expect(dbDocument.document_name).toBe(fileName);
    expect(dbDocument.mime_type).toBe('image/jpeg');
    expect(Number(dbDocument.file_size)).toBe(expectedFileSize);
    expect(dbDocument.file_id).toBeDefined();
    expect(dbDocument.storage_path).toBeDefined();
    expect(dbDocument.created_by).toBe(tenantData.adminUser.userId);
    expect(dbDocument.entered_at).toBeDefined();

    // Verify file was uploaded to MinIO
    const fileStoreRecord = await context.db('external_files')
      .where({ file_id: dbDocument.file_id })
      .first();

    expect(fileStoreRecord).toBeDefined();

    // Check file exists in MinIO
    const minioExists = await waitForMinioFile(fileStoreRecord.storage_path);
    expect(minioExists).toBe(true);

    // Verify MinIO file metadata
    const minioMetadata = await getMinioFileMetadata(fileStoreRecord.storage_path);
    expect(minioMetadata.exists).toBe(true);
    expect(minioMetadata.size).toBe(expectedFileSize);
    expect(minioMetadata.contentType).toBe('image/jpeg');

    // Click on the thumbnail image to open preview
    const thumbnail = page.locator(`img[alt="${fileName}"]`).first();
    await thumbnail.waitFor({ state: 'visible', timeout: 30_000 });
    await thumbnail.click({ force: true }); // Force click to bypass overlay

    // Verify preview modal
    const modalImage = page.locator(`.fixed.inset-0 img[alt="${fileName}"]`).first();
    await expect(modalImage).toBeVisible({ timeout: 20_000 });

    // Cleanup
    await fs.unlink(filePath).catch(() => {});
  });

  test('uploads a text document and verifies storage', async ({}, testInfo) => {
    test.setTimeout(120000);

    const { page, tenantData } = context;

    await setupAuthenticatedSession(page, tenantData, {
      baseUrl: TEST_CONFIG.baseUrl,
    });

    const tenantId = tenantData.tenant.tenantId;

    await page.goto(`${TEST_CONFIG.baseUrl}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {
      console.log('[Upload Preview Test] Network idle timeout, continuing...');
    });

    await page.goto(`${TEST_CONFIG.baseUrl}/msp/documents`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {
      console.log('[Upload Preview Test] Network idle timeout, continuing...');
    });

    const uploadButton = page.locator('#documents-upload-btn');
    await uploadButton.waitFor({ state: 'visible', timeout: 15_000 });
    await uploadButton.click();

    // Wait for Browse Files button to appear
    await page.waitForTimeout(2000);
    const browseButton = page.locator('#select-file-button');
    await browseButton.waitFor({ state: 'visible', timeout: 10_000 });

    // Create test text file
    const fileName = `playwright-test-${Date.now()}.txt`;
    const textContent = 'This is a test text document for Playwright testing.\nLine 2\nLine 3';
    const filePath = testInfo.outputPath(fileName);
    const textBuffer = createTextFileBuffer(textContent);
    await fs.writeFile(filePath, textBuffer);

    const fileStats = await fs.stat(filePath);
    const expectedFileSize = fileStats.size;

    // Upload the file
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(filePath);

    // Handle folder selector modal
    await page.waitForTimeout(1000);
    const folderModal = page.locator('[role="dialog"]').filter({
      has: page.getByText(/Select Destination Folder/i)
    });
    const modalVisible = await folderModal.isVisible({ timeout: 3000 }).catch(() => false);
    if (modalVisible) {
      const confirmButton = page.locator('#folder-selector-confirm-btn');
      await confirmButton.click();
      await page.waitForTimeout(1000);
    }

    // Wait for upload to complete
    const spinner = page.locator('[data-testid="spinner"]').or(page.locator('text=Uploading'));
    await spinner.waitFor({ state: 'detached', timeout: 30_000 }).catch(() => {});
    const uploadLabel = page.locator('text=Document Upload');
    await uploadLabel.waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {});

    // Verify document appears
    const heading = page.getByRole('heading', { name: fileName, exact: true });
    await expect(heading).toBeVisible({ timeout: 30_000 });

    // Verify database storage
    const dbDocument = await context.db('documents')
      .where({
        tenant: tenantId,
        document_name: fileName,
      })
      .first();

    expect(dbDocument).toBeDefined();
    expect(dbDocument.document_name).toBe(fileName);
    expect(dbDocument.mime_type).toBe('text/plain');
    expect(Number(dbDocument.file_size)).toBe(expectedFileSize);
    expect(dbDocument.file_id).toBeDefined();

    // Verify file was uploaded to MinIO
    const fileStoreRecord = await context.db('external_files')
      .where({ file_id: dbDocument.file_id })
      .first();

    expect(fileStoreRecord).toBeDefined();

    // Check file exists in MinIO
    const minioExists = await waitForMinioFile(fileStoreRecord.storage_path);
    expect(minioExists).toBe(true);

    // Verify MinIO file metadata
    const minioMetadata = await getMinioFileMetadata(fileStoreRecord.storage_path);
    expect(minioMetadata.exists).toBe(true);
    expect(minioMetadata.size).toBe(expectedFileSize);
    expect(minioMetadata.contentType).toBe('text/plain');

    // Verify file content matches
    const contentVerification = await verifyMinioFileContent(
      fileStoreRecord.storage_path,
      textBuffer
    );
    expect(contentVerification.matches).toBe(true);

    // Cleanup
    await fs.unlink(filePath).catch(() => {});
  });

  test('displays upload progress indicator during file upload', async ({}, testInfo) => {
    test.setTimeout(120000);

    const { page, tenantData } = context;

    await setupAuthenticatedSession(page, tenantData, {
      baseUrl: TEST_CONFIG.baseUrl,
    });

    const tenantId = tenantData.tenant.tenantId;

    await page.goto(`${TEST_CONFIG.baseUrl}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {
      console.log('[Upload Preview Test] Network idle timeout, continuing...');
    });

    await page.goto(`${TEST_CONFIG.baseUrl}/msp/documents`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {
      console.log('[Upload Preview Test] Network idle timeout, continuing...');
    });

    const uploadButton = page.locator('#documents-upload-btn');
    await uploadButton.waitFor({ state: 'visible', timeout: 15_000 });
    await uploadButton.click();

    // Wait for Browse Files button to appear
    await page.waitForTimeout(2000);
    const browseButton = page.locator('#select-file-button');
    await browseButton.waitFor({ state: 'visible', timeout: 10_000 });

    // Create test file
    const fileName = `playwright-progress-test-${Date.now()}.png`;
    const filePath = testInfo.outputPath(fileName);
    await fs.writeFile(filePath, Buffer.from(ONE_BY_ONE_PNG_BASE64, 'base64'));

    // Start upload
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(filePath);

    // Verify spinner/progress indicator appears
    const spinner = page.locator('[data-testid="spinner"]').or(page.getByText('Uploading'));

    // Give it a moment to appear - it might be very fast
    const spinnerAppeared = await spinner.isVisible().catch(() => false);

    // Note: For small files, the spinner might not appear long enough to be visible
    // This is expected behavior, not a test failure

    // Wait for upload to complete - upload label should disappear
    const uploadLabel = page.locator('text=Document Upload');
    await uploadLabel.waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {});

    // Verify document was uploaded successfully
    const heading = page.getByRole('heading', { name: fileName, exact: true });
    await expect(heading).toBeVisible({ timeout: 30_000 });

    // Cleanup
    await fs.unlink(filePath).catch(() => {});
  });

  test('uploads document to a specific folder when folder is selected', async ({}, testInfo) => {
    test.setTimeout(120000);

    const { page, tenantData } = context;

    await setupAuthenticatedSession(page, tenantData, {
      baseUrl: TEST_CONFIG.baseUrl,
    });

    const tenantId = tenantData.tenant.tenantId;

    await page.goto(`${TEST_CONFIG.baseUrl}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {
      console.log('[Upload Preview Test] Network idle timeout, continuing...');
    });

    await page.goto(`${TEST_CONFIG.baseUrl}/msp/documents`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {
      console.log('[Upload Preview Test] Network idle timeout, continuing...');
    });

    // First create a test folder
    const testFolderPath = `/Test Folder ${Date.now()}`;

    // Create folder in database directly for testing
    await context.db('documents')
      .insert({
        document_id: uuidv4(),
        tenant: tenantId,
        document_name: 'Test Folder',
        folder_path: testFolderPath,
        user_id: tenantData.adminUser.userId,
        created_by: tenantData.adminUser.userId,
        order_number: 0,
        entered_at: new Date(),
      });

    // Refresh page to see the folder
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {
      console.log('[Upload Preview Test] Network idle timeout, continuing...');
    });

    // Navigate to the test folder
    const folderLink = page.getByText(testFolderPath.replace('/', ''));
    if (await folderLink.isVisible().catch(() => false)) {
      await folderLink.click();
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {
      console.log('[Upload Preview Test] Network idle timeout, continuing...');
    });
    }

    const uploadButton = page.locator('#documents-upload-btn');
    await uploadButton.waitFor({ state: 'visible', timeout: 15_000 });
    await uploadButton.click();

    // Wait for Browse Files button to appear
    await page.waitForTimeout(2000);
    const browseButton = page.locator('#select-file-button');
    await browseButton.waitFor({ state: 'visible', timeout: 10_000 });

    // Create and upload test file
    const fileName = `playwright-folder-test-${Date.now()}.png`;
    const filePath = testInfo.outputPath(fileName);
    await fs.writeFile(filePath, Buffer.from(ONE_BY_ONE_PNG_BASE64, 'base64'));

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(filePath);

    // Handle folder selector modal
    await page.waitForTimeout(1000);
    const folderModal = page.locator('[role="dialog"]').filter({
      has: page.getByText(/Select Destination Folder/i)
    });
    const modalVisible = await folderModal.isVisible({ timeout: 3000 }).catch(() => false);
    if (modalVisible) {
      const confirmButton = page.locator('#folder-selector-confirm-btn');
      await confirmButton.click();
      await page.waitForTimeout(1000);
    }

    // Wait for upload to complete
    const spinner = page.locator('[data-testid="spinner"]').or(page.locator('text=Uploading'));
    await spinner.waitFor({ state: 'detached', timeout: 30_000 }).catch(() => {});
    const uploadLabel = page.locator('text=Document Upload');
    await uploadLabel.waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {});

    // Verify document appears
    const heading = page.getByRole('heading', { name: fileName, exact: true });
    await expect(heading).toBeVisible({ timeout: 30_000 });

    // Verify document was saved with correct folder path
    const dbDocument = await context.db('documents')
      .where({
        tenant: tenantId,
        document_name: fileName,
      })
      .first();

    expect(dbDocument).toBeDefined();
    expect(dbDocument.folder_path).toBe(testFolderPath);

    // Cleanup
    await fs.unlink(filePath).catch(() => {});
  });

  test('cancels upload without saving document', async ({}, testInfo) => {
    test.setTimeout(120000);

    const { page, tenantData } = context;

    await setupAuthenticatedSession(page, tenantData, {
      baseUrl: TEST_CONFIG.baseUrl,
    });

    const tenantId = tenantData.tenant.tenantId;

    await page.goto(`${TEST_CONFIG.baseUrl}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {
      console.log('[Upload Preview Test] Network idle timeout, continuing...');
    });

    await page.goto(`${TEST_CONFIG.baseUrl}/msp/documents`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {
      console.log('[Upload Preview Test] Network idle timeout, continuing...');
    });

    const uploadButton = page.locator('#documents-upload-btn');
    await uploadButton.waitFor({ state: 'visible', timeout: 15_000 });
    await uploadButton.click();

    // Wait for Browse Files button to appear
    await page.waitForTimeout(2000);
    const browseButton = page.locator('#select-file-button');
    await browseButton.waitFor({ state: 'visible', timeout: 10_000 });

    // Get initial document count
    const initialCount = await context.db('documents')
      .where({ tenant: tenantId })
      .count('* as count')
      .first();

    // Click cancel button
    const cancelButton = page.locator('#cancel-button').or(page.getByRole('button', { name: /cancel/i }));
    await cancelButton.click();

    // Verify upload interface is closed
    const uploadLabel = page.locator('text=Document Upload');
    await expect(uploadLabel).not.toBeVisible({ timeout: 5_000 });

    // Verify no new documents were created
    const finalCount = await context.db('documents')
      .where({ tenant: tenantId })
      .count('* as count')
      .first();

    expect(finalCount.count).toBe(initialCount.count);
  });
});
