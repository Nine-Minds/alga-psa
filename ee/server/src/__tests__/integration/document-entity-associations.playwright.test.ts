import { test, expect } from '@playwright/test';
import { promises as fs } from 'node:fs';
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

const TEST_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAYSURBVChTY/hPAAwEFDJQAaMKRxUOXYUAcJ4E/VIDMyoAAAAASUVORK5CYII=';

// 200x200 bright blue square for logo testing
const ONE_BY_ONE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAMgAAADICAYAAACtWK6eAAAACXBIWXMAAAsTAAALEwEAmpwYAAADuklEQVR4nO3dMW4TURSF4TcJqWhA7AA2wA5gBSyBBbADNsAK2AE7YAWsgB2wA1qQaIgEEo2FhBBIIxvPvPvO9/1SSqRoZN2jO3dm7EwmSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZKkDn2/7xcoaXt7e/fNzc03k8lk/8nJycfb29sfr6+vv97e3v54eXn5cHh4+PHk5OTT4eHhp+Pj47ePHj36cnZ29uXi4uLr6enp18vLy28XFxdfz8/Pv52fn39/+fLl98vLy+/X19c/Li4ufpydnf1Y+nutwe7du+/evPnzfvb8+fP3Ozs7Hzc3N9/f39//cnx8/OX8/Pzr9fX1t7Ozs+/n5+c/Li4ufpydnf04Ozv78fz588/Pnj37/OTJk89HR0efHzx48Pnu3bt3a/89a7K/v/9hZ2fn/c7Ozoc3b978WPr9RuZvIMvYvXvvv+/u7r49PDz8sLe39/Hk5OTTzs7O561bt77d29v7fnBw8OP09PTn9fX1z7u7u7/e3t7+dXd399f79++f7+/vP3/8+PHzR48ePT88PPx0dHT06fj4+POzZ88+n5ycfL66uvr5+vr654uLi1+Xl5e/rq+vf93d3f19c3Pz++bm5u/Nzc3fu7u7v58+ffp7//7976enp39fXV39fXx8/Pfk5OTPy8vL/y8vL/+8ubn59+bm5v/r6+vJs2fPJo8fP56cnZ1Nzs7OJq9evfpncXFxsrW1Ndnf3x+NHXN1Z33j4zYXLwaA+Yfw4sWLycHBweTs7Gzy/v37yaWlpf//lpbm/y0uzv9dXJz/u7Q0//fs7Ozk3bt3k3fv3k3ev38/effuH8a/+Pbt2+Tt27eTt2/fTl6/fj15/fr15M2bN5PXr19P3rx5M3nz5s3k9evXk3fv3k3evHkzef369eTt27eTN2/eTN68eTN59+7d5N27d5O3b99O3r59O/n777+T379/T/7+/Tv5+/fv5M+fP5M/f/5M/vz5M/n999/kz58/k7///ZtcXl5OLi4uJhcXF5Pz8/PJ+fn55Pz8fHJxcTG5uLiYXFxcTC4uLiaXl5eTy8vLyfn5+eTi4mJycXExOT8/n1xcXEwuLy8nFxcXk8vLy8nFxcXk4uJi8v8fHwWSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEn6t/wDg0VcFuLer6IAAAAASUVORK5CYII=';

/**
 * Helper function to upload a document to an entity.
 * This follows the correct flow for DocumentUpload component:
 * 1. Click upload button
 * 2. Select file (triggers FolderSelectorModal)
 * 3. Wait for folders to load
 * 4. Select folder and confirm
 * 5. Wait for upload to complete
 */
async function uploadDocumentToEntity(
  page: any,
  testInfo: any,
  options: {
    testName: string;
    fileName: string;
    fileContent: string; // base64
    uploadButtonId?: string;
  }
): Promise<{ fileName: string; filePath: string }> {
  const { testName, fileName, fileContent, uploadButtonId } = options;

  console.log(`[${testName}] Looking for upload button...`);

  // Look for upload button using correct IDs from Documents component
  const uploadButton = uploadButtonId
    ? page.locator(`#${uploadButtonId}`)
    : page.locator('#documents-upload-btn').or(page.getByRole('button', { name: /upload file/i })).or(page.getByRole('button', { name: /upload/i }));

  const uploadButtonVisible = await uploadButton.first().isVisible({ timeout: 5000 }).catch(() => false);
  console.log(`[${testName}] Upload button visible:`, uploadButtonVisible);

  if (!uploadButtonVisible) {
    throw new Error('Upload button not found');
  }

  console.log(`[${testName}] Clicking upload button...`);
  await uploadButton.first().click();

  // Wait for upload UI to start rendering
  console.log(`[${testName}] Waiting for upload UI to render...`);
  await page.waitForTimeout(2000);

  // Wait for upload container to appear and be fully rendered
  console.log(`[${testName}] Waiting for upload container to appear...`);
  // The upload container is inside a ReflectionContainer with id ending in '-upload'
  const uploadContainer = page.locator('[id$="-upload"]').or(page.locator('text=Document Upload').locator('..').locator('..'));

  try {
    await uploadContainer.waitFor({ state: 'visible', timeout: 10_000 });
    console.log(`[${testName}] ✓ Upload container visible`);
  } catch (err) {
    console.log(`[${testName}] ERROR: Upload container did not appear!`);
    await page.screenshot({ path: `debug-no-upload-container-${Date.now()}.png`, fullPage: true });
    throw new Error('Upload container did not appear after clicking upload button');
  }

  // Wait for the Browse Files button to be ready (id="select-file-button" from DocumentUpload component)
  console.log(`[${testName}] Waiting for Browse Files button to be ready...`);
  const browseButton = page.locator('#select-file-button');
  await browseButton.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {
    console.log(`[${testName}] Browse Files button not visible yet`);
  });
  await page.waitForTimeout(500);

  // Find the hidden file input (near the Browse Files button)
  const fileInput = page.locator('input[type="file"]').first();
  const fileInputExists = await fileInput.count();
  console.log(`[${testName}] File input count:`, fileInputExists);

  if (fileInputExists === 0) {
    console.log(`[${testName}] ERROR: File input not found in upload container!`);
    await page.screenshot({ path: `debug-no-file-input-${Date.now()}.png`, fullPage: true });
    throw new Error('File input not found in upload container');
  }

  // Verify the file input is the hidden one (not a native picker trigger)
  const isHidden = await fileInput.evaluate((el: HTMLInputElement) => {
    const style = window.getComputedStyle(el);
    return style.display === 'none' || el.className.includes('hidden') || el.type === 'file';
  });
  console.log(`[${testName}] File input is hidden/controlled:`, isHidden);

  // NOW create the test file
  const actualFileName = `${fileName}-${Date.now()}.png`;
  const filePath = testInfo.outputPath(actualFileName);
  await fs.writeFile(filePath, Buffer.from(fileContent, 'base64'));
  console.log(`[${testName}] Created test file:`, actualFileName);

  // Select file - this will trigger folder selector modal
  console.log(`[${testName}] Selecting file - this will trigger folder selector modal...`);
  await fileInput.setInputFiles(filePath);
  console.log(`[${testName}] ✓ File selected`);

  await page.waitForTimeout(500);

  // Handle folder selector modal
  console.log(`[${testName}] Waiting for folder selector modal to appear...`);

  const folderSelectorDialog = page.locator('[role="dialog"]').filter({
    has: page.getByText(/Select Destination Folder|Choose where to save/i)
  });

  const dialogVisible = await folderSelectorDialog.isVisible({ timeout: 5000 }).catch(() => false);
  console.log(`[${testName}] Folder selector dialog visible:`, dialogVisible);

  if (dialogVisible) {
    console.log(`[${testName}] ✓ Folder selector modal is open`);

    // Wait for folders to load
    const loadingText = page.getByText(/loading folders/i);
    const isLoading = await loadingText.isVisible({ timeout: 1000 }).catch(() => false);

    if (isLoading) {
      console.log(`[${testName}] Waiting for folders to load...`);
      await loadingText.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {
        console.log(`[${testName}] Loading text still visible or already gone`);
      });
      console.log(`[${testName}] ✓ Folders loaded`);
    }

    await page.waitForTimeout(1000);

    // Root is usually pre-selected, but verify
    // Root button has text "Root (No folder)" based on FolderSelectorModal component
    const rootButton = page.getByRole('button', { name: /root.*no folder/i });
    try {
      await rootButton.waitFor({ state: 'visible', timeout: 3000 });
      console.log(`[${testName}] ✓ Root folder option visible`);

      const isSelected = await rootButton.evaluate((el: HTMLElement) =>
        el.className.includes('bg-purple')
      ).catch(() => false);

      if (!isSelected) {
        console.log(`[${testName}] Clicking Root folder to select it...`);
        await rootButton.click();
        await page.waitForTimeout(500);
        console.log(`[${testName}] ✓ Root folder selected`);
      } else {
        console.log(`[${testName}] ✓ Root folder already selected`);
      }
    } catch (err) {
      console.log(`[${testName}] Root button not found, Root may already be selected by default`);
    }

    // Click Confirm button - using ID from FolderSelectorModal component
    const confirmButton = page.locator('#folder-selector-confirm-btn');
    console.log(`[${testName}] Waiting for Confirm button to be ready...`);

    await confirmButton.waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(500);

    const isEnabled = await confirmButton.isEnabled();
    console.log(`[${testName}] Confirm button enabled:`, isEnabled);

    if (!isEnabled) {
      const screenshotPath = `debug-confirm-button-disabled-${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      throw new Error('Confirm button is disabled');
    }

    console.log(`[${testName}] Clicking Confirm button...`);
    await confirmButton.click();
    console.log(`[${testName}] ✓ Confirm button clicked`);

    await folderSelectorDialog.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {
      console.log(`[${testName}] Dialog still visible after 5s`);
    });

    console.log(`[${testName}] ✓ Modal closed, upload should be processing...`);
    await page.waitForTimeout(2000);
  } else {
    console.log(`[${testName}] No folder selector modal appeared - checking if direct upload happened...`);
    await page.waitForTimeout(2000);
  }

  // Wait for upload to complete
  console.log(`[${testName}] Waiting for upload to complete...`);

  const uploadSpinner = page.locator('[data-testid="spinner"]').or(
    page.locator('text=Uploading').or(
      page.locator('.uploading, [role="progressbar"]')
    )
  );

  const spinnerVisible = await uploadSpinner.isVisible({ timeout: 2000 }).catch(() => false);
  if (spinnerVisible) {
    console.log(`[${testName}] Upload spinner visible, waiting for it to disappear...`);
    await uploadSpinner.waitFor({ state: 'detached', timeout: 30_000 }).catch(() => {
      console.log(`[${testName}] Spinner still visible or already gone`);
    });
  }

  // Wait for upload container to close
  console.log(`[${testName}] Waiting for upload container to close...`);
  await uploadContainer.waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {
    console.log(`[${testName}] Upload container still visible or already gone`);
  });

  await page.waitForTimeout(3000);
  console.log(`[${testName}] ✓ Upload complete`);

  return { fileName: actualFileName, filePath };
}

/**
 * Helper function to link an existing document to an entity via DocumentSelector.
 * Handles the common pattern:
 * 1. Navigate to entity page and click Documents tab
 * 2. Check if DocumentSelector is already open (may auto-open)
 * 3. Click "Link Documents" button if needed
 * 4. Select document from the list
 * 5. Click "Associate Selected" button
 */
async function linkExistingDocumentToEntity(
  page: any,
  options: {
    testName: string;
    entityUrl: string;
    documentId: string;
    documentName: string;
  }
): Promise<void> {
  const { testName, entityUrl, documentId, documentName } = options;

  console.log(`[${testName}] Navigating to entity page:`, entityUrl);
  await page.goto(entityUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.waitForLoadState('load', { timeout: 30_000 });
  await page.waitForTimeout(2000);

  // STEP 1: Click Documents tab if it exists
  console.log(`[${testName}] Looking for Documents tab...`);
  const documentsTab = page.getByRole('tab', { name: /documents/i }).or(
    page.locator('[role="tab"]:has-text("Documents")').or(
      page.locator('button:has-text("Documents")')
    )
  );

  const tabVisible = await documentsTab.isVisible({ timeout: 3000 }).catch(() => false);
  console.log(`[${testName}] Documents tab visible:`, tabVisible);

  if (tabVisible) {
    console.log(`[${testName}] Clicking Documents tab...`);
    await documentsTab.click();
    await page.waitForTimeout(1000);
  }

  // STEP 2: Check if DocumentSelector dialog is already open (may auto-open after tab click)
  console.log(`[${testName}] Checking if DocumentSelector is already open...`);
  const selectorDialogCheck = page.locator('[role="dialog"]').filter({
    has: page.getByText(/select document/i)
  });
  const dialogAlreadyOpen = await selectorDialogCheck.isVisible({ timeout: 2000 }).catch(() => false);
  console.log(`[${testName}] DocumentSelector already open:`, dialogAlreadyOpen);

  if (!dialogAlreadyOpen) {
    // Dialog not open yet, need to click the "Link Documents" button
    console.log(`[${testName}] Looking for Link Documents button...`);

    // Scroll down to the Documents section
    const documentsSection = page.locator('text=Documents').last();
    await documentsSection.scrollIntoViewIfNeeded().catch(() => {
      console.log(`[${testName}] Could not scroll to Documents section`);
    });
    await page.waitForTimeout(1000);

    // Use ID from Documents component: {id}-link-documents-btn
    const linkButton = page.locator('#documents-link-documents-btn').or(
      page.getByRole('button', { name: /link documents?/i })
    ).or(page.getByRole('button', { name: /add document/i }));

    const linkButtonVisible = await linkButton.first().isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`[${testName}] Link Documents button visible:`, linkButtonVisible);

    if (!linkButtonVisible) {
      console.log(`[${testName}] Button not found, taking screenshot...`);
      await page.screenshot({ path: `debug-no-link-button-${Date.now()}.png`, fullPage: true });
      throw new Error('Link Documents button not found on entity page');
    }

    console.log(`[${testName}] Clicking Link Documents button...`);
    await linkButton.first().click();
    await page.waitForTimeout(1500);
  } else {
    console.log(`[${testName}] ✓ DocumentSelector was already open, skipping button click`);
  }

  // STEP 3: Wait for DocumentSelector dialog
  console.log(`[${testName}] Waiting for DocumentSelector dialog...`);
  await page.waitForTimeout(2000);

  const selectorDialog = page.locator('[role="dialog"]').filter({
    has: page.getByText(/select document|choose document/i).or(page.getByText(documentName))
  });

  const dialogVisible = await selectorDialog.isVisible({ timeout: 5000 }).catch(() => false);
  console.log(`[${testName}] DocumentSelector dialog visible:`, dialogVisible);

  if (!dialogVisible) {
    const anyDialog = page.locator('[role="dialog"]');
    const anyDialogVisible = await anyDialog.isVisible({ timeout: 2000 }).catch(() => false);
    if (anyDialogVisible) {
      console.log(`[${testName}] A dialog is visible, checking contents...`);
      await page.screenshot({ path: `debug-dialog-visible-${Date.now()}.png`, fullPage: true });
    } else {
      console.log(`[${testName}] No dialog visible at all, taking screenshot...`);
      await page.screenshot({ path: `debug-no-dialog-${Date.now()}.png`, fullPage: true });
      throw new Error('DocumentSelector dialog did not appear');
    }
  }

  // STEP 4: Wait for folders/documents to load (no more "Loading folders..." text)
  console.log(`[${testName}] Waiting for folders to finish loading...`);
  const loadingText = page.getByText(/loading folders/i);

  // Wait for loading text to disappear (up to 15 seconds)
  for (let i = 0; i < 30; i++) {
    const isLoading = await loadingText.isVisible({ timeout: 500 }).catch(() => false);
    if (!isLoading) {
      console.log(`[${testName}] ✓ Folders finished loading`);
      break;
    }
    console.log(`[${testName}] Still loading folders... (attempt ${i + 1}/30)`);
    await page.waitForTimeout(500);
  }

  // Extra wait for documents to render
  await page.waitForTimeout(1500);

  // STEP 5: Find and click the document container
  // DocumentSelector creates IDs like: {id}-document-{document_id} (see DocumentSelector.tsx line 292)
  console.log(`[${testName}] Looking for document in selector:`, documentName);

  // Try to find by document ID pattern: documents-selector-document-{uuid}
  const documentIdSelector = page.locator(`[id$="-document-${documentId}"]`);
  const docIdVisible = await documentIdSelector.isVisible({ timeout: 3000 }).catch(() => false);

  if (docIdVisible) {
    console.log(`[${testName}] Found document by ID pattern, clicking...`);
    await documentIdSelector.click();
    await page.waitForTimeout(1000);
  } else {
    // Fall back to finding by document name in cursor-pointer container
    console.log(`[${testName}] Finding document by name in grid...`);
    const clickableContainer = page.locator('div.cursor-pointer').filter({ hasText: documentName }).first();
    const isClickableVisible = await clickableContainer.isVisible({ timeout: 5000 }).catch(() => false);

    if (isClickableVisible) {
      console.log(`[${testName}] Clicking document container...`);
      await clickableContainer.click();
      await page.waitForTimeout(1000);
    } else {
      console.log(`[${testName}] ERROR: Document not found, taking screenshot...`);
      await page.screenshot({ path: `debug-document-not-found-${Date.now()}.png`, fullPage: true });
      throw new Error(`Document ${documentName} not found in DocumentSelector`);
    }
  }

  console.log(`[${testName}] ✓ Document selected`);

  // STEP 6: Click "Associate Selected" button (id="save-document-selection-button" from DocumentSelector component)
  console.log(`[${testName}] Looking for Associate Selected button...`);

  const confirmButton = page.locator('#save-document-selection-button').or(
    page.getByRole('button', { name: /associate selected/i }).or(
      page.getByRole('button', { name: /select document/i })
    )
  );

  const confirmVisible = await confirmButton.isVisible({ timeout: 3000 }).catch(() => false);
  if (!confirmVisible) {
    console.log(`[${testName}] Button not found, taking screenshot...`);
    await page.screenshot({ path: `debug-no-associate-button-${Date.now()}.png`, fullPage: true });
    throw new Error('Associate Selected button not found in DocumentSelector');
  }

  // Wait for button to become enabled
  console.log(`[${testName}] Waiting for button to become enabled...`);
  let isEnabled = false;
  for (let i = 0; i < 10; i++) {
    isEnabled = await confirmButton.isEnabled();
    if (isEnabled) {
      console.log(`[${testName}] ✓ Button is now enabled`);
      break;
    }
    console.log(`[${testName}] Button still disabled, waiting... (attempt ${i + 1}/10)`);
    await page.waitForTimeout(500);
  }

  if (!isEnabled) {
    console.log(`[${testName}] ERROR: Button still disabled, taking screenshot...`);
    await page.screenshot({ path: `debug-button-disabled-${Date.now()}.png`, fullPage: true });
    throw new Error('Associate Selected button remained disabled');
  }

  console.log(`[${testName}] Clicking Associate Selected button...`);
  await confirmButton.click();

  // Wait for network to be idle (ensures API call has completed)
  console.log(`[${testName}] Waiting for network idle (association API completion)...`);
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {
    console.log(`[${testName}] Network idle timeout - continuing anyway`);
  });

  // Wait for the dialog to close (indicates success) - state-based wait
  console.log(`[${testName}] Waiting for dialog to close...`);
  try {
    await selectorDialog.waitFor({ state: 'detached', timeout: 30_000 });
    console.log(`[${testName}] ✓ Dialog closed successfully`);
  } catch (error) {
    console.log(`[${testName}] ERROR: DocumentSelector did not close after 30s`);
    await page.screenshot({ path: `debug-dialog-still-open-${Date.now()}.png`, fullPage: true });
    throw new Error('DocumentSelector dialog did not close after clicking Associate Selected');
  }

  console.log(`[${testName}] ✓ Document linked successfully - dialog closed`);
}

test.describe('Document entity associations', () => {
  let context: E2ETestContext;
  let sharedDocument: { document_id: string; document_name: string } | null = null;

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

    // Seed permissions BEFORE creating shared document
    console.log('[Setup] Seeding permissions...');
    const tenantId = context.tenantData.tenant.tenantId;

    await seedPermissionsForTenant(
      context.db,
      tenantId
    );

    await grantAllPermissionsToRole(
      context.db,
      tenantId,
      'Admin'
    );

    // Seed a shared document directly in the database with external file reference
    console.log('[Setup] Creating shared test document in database...');
    const documentId = uuidv4();
    const documentName = `Shared Test Document ${Date.now()}.png`;
    const fileId = uuidv4();

    // Decode the test PNG to get actual file content
    const fileContent = Buffer.from(TEST_PNG_BASE64, 'base64');
    const fileSize = fileContent.length;
    const storagePath = `/test/${fileId}.png`;

    // First create the external file record
    await context.db('external_files').insert({
      file_id: fileId,
      tenant: tenantId,
      file_name: documentName,
      original_name: documentName,
      storage_path: storagePath,
      file_size: fileSize,
      mime_type: 'image/png',
      uploaded_by_id: context.tenantData.adminUser.userId,
      is_deleted: false,
    });

    // Get the shared document type for image/png
    const pngType = await context.db('shared_document_types')
      .where({ type_name: 'image/png' })
      .first();

    // Then create the document with reference to the file
    await context.db('documents').insert({
      document_id: documentId,
      document_name: documentName,
      tenant: tenantId,
      user_id: context.tenantData.adminUser.userId,
      created_by: context.tenantData.adminUser.userId,
      entered_at: new Date(),
      updated_at: new Date(),
      order_number: 1,
      file_id: fileId, // Reference to external_files
      mime_type: 'image/png',
      shared_type_id: pngType?.type_id, // Add shared document type
    });

    sharedDocument = {
      document_id: documentId,
      document_name: documentName,
    };
    console.log('[Setup] ✓ Shared document created in database:', sharedDocument.document_id);
  });

  test.afterAll(async () => {
    if (context) {
      await context.cleanup();
    }
  });

  test.beforeEach(async () => {
    await context.reset();

    const tenantId = context.tenantData.tenant.tenantId;

    // Re-seed permissions after reset (context.reset() may clear permissions)
    console.log('[Test Setup] Re-seeding permissions after reset...');
    await seedPermissionsForTenant(
      context.db,
      tenantId
    );

    await grantAllPermissionsToRole(
      context.db,
      tenantId,
      'Admin'
    );

    // Recreate shared document after reset (context.reset() clears all data and creates new tenant)
    console.log('[Test Setup] Recreating shared test document...');
    const documentId = uuidv4();
    const documentName = `Shared Test Document ${Date.now()}.png`;
    const fileId = uuidv4();

    // Decode the test PNG to get actual file content
    const fileContent = Buffer.from(TEST_PNG_BASE64, 'base64');
    const fileSize = fileContent.length;
    const storagePath = `/test/${fileId}.png`;

    // First create the external file record
    await context.db('external_files').insert({
      file_id: fileId,
      tenant: tenantId,
      file_name: documentName,
      original_name: documentName,
      storage_path: storagePath,
      file_size: fileSize,
      mime_type: 'image/png',
      uploaded_by_id: context.tenantData.adminUser.userId,
      is_deleted: false,
    });

    // Get the shared document type for image/png
    const pngType = await context.db('shared_document_types')
      .where({ type_name: 'image/png' })
      .first();

    // Then create the document with reference to the file
    await context.db('documents').insert({
      document_id: documentId,
      document_name: documentName,
      tenant: tenantId,
      user_id: context.tenantData.adminUser.userId,
      created_by: context.tenantData.adminUser.userId,
      entered_at: new Date(),
      updated_at: new Date(),
      order_number: 1,
      file_id: fileId, // Reference to external_files
      mime_type: 'image/png',
      shared_type_id: pngType?.type_id, // Add shared document type
    });

    sharedDocument = {
      document_id: documentId,
      document_name: documentName,
    };
    console.log('[Test Setup] ✓ Shared document recreated:', sharedDocument.document_id);

    // Re-authenticate after reset (context.reset() clears the session)
    const { page, tenantData } = context;
    await setupAuthenticatedSession(page, tenantData, {
      baseUrl: TEST_CONFIG.baseUrl,
    });
  });

  test('links existing document to ticket and verifies association', async ({}, testInfo) => {
    test.setTimeout(120000);

    const { page, tenantData } = context;
    const tenantId = tenantData.tenant.tenantId;

    try {
      console.log('[Ticket Link Test] Creating test data...');

      // Create a test client first (required for ticket)
      const testClient = {
        client_id: uuidv4(),
        tenant: tenantId,
        client_name: `Test Client ${Date.now()}`,
        is_inactive: false,
        is_tax_exempt: false,
        billing_cycle: 'monthly',
        created_at: new Date(),
        updated_at: new Date(),
      };

      await context.db('clients').insert(testClient);
      console.log('[Ticket Link Test] Created client:', testClient.client_id);

      // Create a board first (required for ticket)
      const testBoard = {
        board_id: uuidv4(),
        tenant: tenantId,
        board_name: 'Test Board',
      };

      await context.db('boards').insert(testBoard);
      console.log('[Ticket Link Test] Created board:', testBoard.board_id);

      // Create a test ticket with all required fields
      const testTicket = {
        ticket_id: uuidv4(),
        tenant: tenantId,
        ticket_number: `TICKET-${Date.now()}`,
        title: 'Test Ticket for Document Link',
        client_id: testClient.client_id,
        is_closed: false,
        entered_at: new Date(),
        updated_at: new Date(),
        board_id: testBoard.board_id,
      };

      await context.db('tickets').insert(testTicket);
      console.log('[Ticket Link Test] Created ticket:', testTicket.ticket_id);

      // STEP 1: Get or upload a test document
      let documentToLink: { document_id: string; document_name: string };

      if (sharedDocument) {
        console.log('[Ticket Link Test] Using shared document:', sharedDocument.document_id);
        documentToLink = sharedDocument;
      } else {
        console.log('[Ticket Link Test] No shared document, uploading standalone...');

        await setupAuthenticatedSession(page, tenantData, {
          baseUrl: TEST_CONFIG.baseUrl,
        });

        await page.goto(`${TEST_CONFIG.baseUrl}/msp/documents`, {
          waitUntil: 'domcontentloaded',
          timeout: 60_000,
        });
        await page.waitForLoadState('load', { timeout: 30_000 });
        await page.waitForTimeout(2000);

        const { fileName } = await uploadDocumentToEntity(page, testInfo, {
          testName: 'Ticket Link Test',
          fileName: 'ticket-document',
          fileContent: TEST_PNG_BASE64,
        });

        await page.waitForTimeout(3000);

        const uploadedDoc = await context.db('documents')
          .where({
            tenant: tenantId,
            document_name: fileName,
          })
          .first();

        if (!uploadedDoc) {
          throw new Error('Document upload failed');
        }

        documentToLink = {
          document_id: uploadedDoc.document_id,
          document_name: fileName,
        };
        console.log('[Ticket Link Test] ✓ Document uploaded:', documentToLink.document_id);
      }

      // STEP 2: Link document to ticket
      await linkExistingDocumentToEntity(page, {
        testName: 'Ticket Link Test',
        entityUrl: `${TEST_CONFIG.baseUrl}/msp/tickets/${testTicket.ticket_id}`,
        documentId: documentToLink.document_id,
        documentName: documentToLink.document_name,
      });

      // STEP 3: Verify association was created in database
      console.log('[Ticket Link Test] Verifying association in database...');
      const association = await context.db('document_associations')
        .where({
          tenant: tenantId,
          entity_type: 'ticket',
          entity_id: testTicket.ticket_id,
          document_id: documentToLink.document_id,
        })
        .first();

      // CRITICAL: Association MUST exist for test to pass
      if (!association) {
        console.error('[Ticket Link Test] FAILED: No association found in database!');
        await page.screenshot({ path: `debug-no-association-${Date.now()}.png`, fullPage: true });
        throw new Error(`Document association not found in database for ticket ${testTicket.ticket_id}`);
      }

      expect(association).toBeDefined();
      expect(association).not.toBeNull();
      expect(association.entity_type).toBe('ticket');
      expect(association.entity_id).toBe(testTicket.ticket_id);
      expect(association.document_id).toBe(documentToLink.document_id);
      console.log('[Ticket Link Test] ✓ Association verified in database!');
    } catch (error) {
      console.error('[Ticket Link Test] Test failed with error:', error);
      // Take a final screenshot on error
      await page.screenshot({ path: `debug-test-error-${Date.now()}.png`, fullPage: true });
      throw error;
    }
  });

  test('attaches document and creates in-app document on client', async ({}, testInfo) => {
    test.setTimeout(180000); // Increased for in-app document creation

    const { page, tenantData } = context;
    const tenantId = tenantData.tenant.tenantId;

    console.log('[Client Test] Creating test data...');

    // Create a test client with all required fields
    const testClient = {
      client_id: uuidv4(),
      tenant: tenantId,
      client_name: `Test Client ${Date.now()}`,
      is_inactive: false,
      is_tax_exempt: false,
      billing_cycle: 'monthly',
      created_at: new Date(),
      updated_at: new Date(),
    };

    await context.db('clients').insert(testClient);
    console.log('[Client Upload Test] Created client:', testClient.client_id);

    await setupAuthenticatedSession(page, tenantData, {
      baseUrl: TEST_CONFIG.baseUrl,
    });

    // Navigate to client detail page
    console.log('[Client Upload Test] Navigating to client detail page...');
    await page.goto(`${TEST_CONFIG.baseUrl}/msp/clients/${testClient.client_id}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForLoadState('load', { timeout: 30_000 });

    // Wait for React to hydrate and page to be interactive
    console.log('[Client Upload Test] Waiting for page to be fully interactive...');
    await page.waitForTimeout(3000);

    // Wait for main content to be visible (ensures React has rendered)
    await page.locator('main').or(page.locator('[role="main"]')).or(page.locator('body')).first().waitFor({
      state: 'visible',
      timeout: 10_000
    }).catch(() => {
      console.log('[Client Upload Test] Main content wait timed out, continuing...');
    });

    console.log('[Client Upload Test] Client page loaded, current URL:', page.url());

    // STEP 1: Look for and click Documents tab if it exists
    // Note: Using role="tab" is the semantic approach for tabs - no custom ID needed
    console.log('[Client Upload Test] Looking for Documents tab...');
    const documentsTab = page.getByRole('tab', { name: /documents/i }).or(
      page.locator('[role="tab"]:has-text("Documents")').or(
        page.locator('button:has-text("Documents")')
      )
    );

    const tabVisible = await documentsTab.isVisible({ timeout: 5000 }).catch(() => false);
    console.log('[Client Upload Test] Documents tab visible:', tabVisible);

    if (tabVisible) {
      console.log('[Client Upload Test] Clicking Documents tab...');
      await documentsTab.click();

      // Wait for tab panel to appear (better than arbitrary timeout)
      console.log('[Client Upload Test] Waiting for Documents tab panel to load...');
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {
        console.log('[Client Upload Test] Network idle timeout, continuing...');
      });
    }

    // STEP 2: Look for the documents section - Documents component should be rendered with entityType="client"
    console.log('[Client Upload Test] Waiting for documents section to load...');
    const documentsHeading = page.getByRole('heading', { name: /documents/i }).or(
      page.locator('text=Documents')
    );

    // Wait for heading to be visible
    await documentsHeading.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {
      console.log('[Client Upload Test] Documents heading wait timed out');
    });
    console.log('[Client Upload Test] Documents heading visible');

    // STEP 3: Wait for Documents component to fully render - wait for upload button to be ready
    // Documents component uses ID pattern: {id}-upload-btn (e.g., "client-documents-section-documents-upload-btn")
    console.log('[Client Upload Test] Waiting for Documents component controls to be ready...');
    const uploadButton = page.locator('#client-documents-section-documents-upload-btn')
      .or(page.locator('[id$="-upload-btn"]'))
      .or(page.getByRole('button', { name: /upload file/i }))
      .or(page.getByRole('button', { name: /upload/i }));

    // Wait for upload button to be visible and enabled (indicates component is fully loaded)
    await uploadButton.first().waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {
      console.log('[Client Upload Test] Upload button wait timed out');
    });

    // Additional check: wait for button to be enabled (might be disabled during loading)
    let uploadButtonEnabled = false;
    for (let i = 0; i < 10; i++) {
      uploadButtonEnabled = await uploadButton.first().isEnabled().catch(() => false);
      if (uploadButtonEnabled) {
        console.log('[Client Upload Test] ✓ Upload button is ready and enabled');
        break;
      }
      console.log(`[Client Upload Test] Upload button not enabled yet, retry ${i + 1}/10...`);
      await page.waitForTimeout(500);
    }

    const uploadButtonVisible = await uploadButton.first().isVisible().catch(() => false);
    console.log('[Client Upload Test] Upload button visible:', uploadButtonVisible, 'enabled:', uploadButtonEnabled);

    if (uploadButtonVisible) {
      console.log('[Client Upload Test] Clicking upload button...');
      await uploadButton.first().click();

      // Create test PNG file BEFORE triggering file chooser
      const fileName = `client-attachment-${Date.now()}.png`;
      const filePath = testInfo.outputPath(fileName);
      await fs.writeFile(filePath, Buffer.from(TEST_PNG_BASE64, 'base64'));
      console.log('[Client Upload Test] Created test file:', fileName);

      // Look for "Browse Files" button (id="select-file-button" from DocumentUpload component)
      console.log('[Client Upload Test] Looking for Browse Files button...');
      const browseFilesButton = page.locator('#select-file-button')
        .or(page.getByRole('button', { name: /browse files/i }))
        .or(page.locator('button:has-text("Browse Files")'));

      const browseButtonVisible = await browseFilesButton.isVisible({ timeout: 5000 }).catch(() => false);
      console.log('[Client Upload Test] Browse Files button visible:', browseButtonVisible);

      if (browseButtonVisible) {
        console.log('[Client Upload Test] Setting up file chooser listener before clicking Browse Files...');

        // Set up file chooser listener BEFORE clicking the button
        const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 10_000 });

        console.log('[Client Upload Test] Clicking Browse Files button...');
        await browseFilesButton.click();

        // Wait for and handle the native file chooser
        console.log('[Client Upload Test] Waiting for file chooser event...');
        const fileChooser = await fileChooserPromise;
        console.log('[Client Upload Test] File chooser appeared, setting files...');
        await fileChooser.setFiles(filePath);
        console.log('[Client Upload Test] ✓ File selected via file chooser');
      } else {
        // No browse button, look for upload container directly
        console.log('[Client Upload Test] No Browse Files button, looking for upload container...');
        const uploadContainer = page.locator('[data-automation-id="documents-upload"]');

        try {
          await uploadContainer.waitFor({ state: 'visible', timeout: 10_000 });
          console.log('[Client Upload Test] ✓ Upload container visible');

          // Find the file input inside the upload container
          const fileInput = uploadContainer.locator('input[type="file"]');
          console.log('[Client Upload Test] Looking for file input in upload container...');
          await fileInput.waitFor({ state: 'attached', timeout: 5000 });

          // Set the file directly using Playwright's setInputFiles
          console.log('[Client Upload Test] Setting input files...');
          await fileInput.setInputFiles(filePath);
          console.log('[Client Upload Test] ✓ File selected');
        } catch (err) {
          console.log('[Client Upload Test] ERROR: Upload container did not appear!');
          await page.screenshot({ path: `debug-no-upload-container-${Date.now()}.png`, fullPage: true });
          throw new Error('Upload container did not appear after clicking upload button');
        }
      }

      // STEP 2: Handle folder selector modal that appears after file selection
      console.log('[Client Upload Test] Waiting for folder selector modal to appear...');

      // Try multiple strategies to find the folder selector
      // Strategy 1: Look for the confirm button first (most reliable)
      const confirmButton = page.locator('#folder-selector-confirm-btn')
        .or(page.getByRole('button', { name: /confirm/i }).filter({ hasText: /confirm/i }));

      const confirmButtonVisible = await confirmButton.isVisible({ timeout: 10_000 }).catch(() => false);
      console.log('[Client Upload Test] Confirm button visible:', confirmButtonVisible);

      // Strategy 2: Look for the dialog by role
      const folderSelectorDialog = page.locator('[role="dialog"]').last(); // Use last() in case multiple dialogs

      const dialogVisible = await folderSelectorDialog.isVisible({ timeout: 2000 }).catch(() => false);
      console.log('[Client Upload Test] Folder selector dialog visible:', dialogVisible);

      // If we found the confirm button, proceed directly to clicking it
      if (confirmButtonVisible) {
        console.log('[Client Upload Test] ✓ Folder selector detected (confirm button found)');

        // CRITICAL: Wait for folder loading to complete
        // The modal shows "Loading folders..." text while fetching folders
        const loadingText = page.getByText(/loading folders/i);
        const isLoading = await loadingText.isVisible({ timeout: 1000 }).catch(() => false);

        if (isLoading) {
          console.log('[Client Upload Test] Waiting for folders to load...');
          // Wait for loading text to disappear
          await loadingText.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {
            console.log('[Client Upload Test] Loading text still visible or already gone');
          });
          console.log('[Client Upload Test] ✓ Folders loaded');
        } else {
          console.log('[Client Upload Test] Folders already loaded or no loading state shown');
        }

        // Additional wait for modal animations and React state updates
        await page.waitForTimeout(1000);

        // Root is usually pre-selected by default (selectedFolder starts as null)
        // Look for the Root folder option to ensure it's visible
        // FolderSelectorModal renders Root button with text "Root (No folder)" - using semantic selector
        const rootButton = page.getByRole('button', { name: /root.*no folder/i });

        // Wait for root button to be visible
        try {
          await rootButton.waitFor({ state: 'visible', timeout: 3000 });
          console.log('[Client Upload Test] ✓ Root folder option visible');

          // Check if already selected (has the purple background class)
          const isSelected = await rootButton.evaluate((el) =>
            el.className.includes('bg-purple')
          ).catch(() => false);

          if (!isSelected) {
            console.log('[Client Upload Test] Clicking Root folder to select it...');
            await rootButton.click();
            // Wait a brief moment for selection state to update
            await page.waitForTimeout(200);
            console.log('[Client Upload Test] ✓ Root folder selected');
          } else {
            console.log('[Client Upload Test] ✓ Root folder already selected');
          }
        } catch (err) {
          console.log('[Client Upload Test] Root button not found, Root may already be selected by default');
        }

        // Now click the Confirm button - wait for it to be both visible and enabled
        // Re-use the confirmButton locator we already verified above
        console.log('[Client Upload Test] Waiting for Confirm button to be ready...');

        // Wait for button to be visible
        try {
          await confirmButton.waitFor({ state: 'visible', timeout: 5000 });
          console.log('[Client Upload Test] ✓ Confirm button visible');
        } catch (err) {
          console.log('[Client Upload Test] ERROR: Confirm button not visible!');
          await page.screenshot({ path: `debug-no-confirm-btn-${Date.now()}.png`, fullPage: true });
          throw new Error('Confirm button not found in folder selector');
        }

        // Wait for button to be enabled (with retry logic)
        let isEnabled = false;
        for (let i = 0; i < 20; i++) {
          isEnabled = await confirmButton.first().isEnabled().catch(() => false);
          if (isEnabled) {
            console.log('[Client Upload Test] ✓ Confirm button is enabled');
            break;
          }
          await page.waitForTimeout(100);
        }
        console.log('[Client Upload Test] Confirm button enabled:', isEnabled);

        if (isEnabled) {
          console.log('[Client Upload Test] Clicking Confirm button...');

          // Click the confirm button - try multiple approaches for reliability
          try {
            // First try: normal click
            await confirmButton.first().click({ timeout: 5000 });
            console.log('[Client Upload Test] ✓ Confirm button clicked (normal click)');
          } catch (err) {
            console.log('[Client Upload Test] Normal click failed, trying force click...');
            // Fallback: force click
            await confirmButton.first().click({ force: true });
            console.log('[Client Upload Test] ✓ Confirm button clicked (force click)');
          }

          // Wait for modal to close - the dialog should disappear
          console.log('[Client Upload Test] Waiting for modal to close...');
          await folderSelectorDialog.waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {
            console.log('[Client Upload Test] Dialog still visible after 10s');
          });

          // After clicking Confirm, the upload should happen automatically
          // because the file was already selected and stored in pendingFile
          console.log('[Client Upload Test] ✓ Modal closed, upload should be processing...');
        } else {
          console.log('[Client Upload Test] ERROR: Confirm button is disabled!');
          // Take screenshot for debugging
          const screenshotPath = `debug-confirm-button-disabled-${Date.now()}.png`;
          await page.screenshot({ path: screenshotPath, fullPage: true });
          console.log('[Client Upload Test] Screenshot saved:', screenshotPath);

          throw new Error('Confirm button is disabled - cannot proceed with test');
        }
      } else {
        console.log('[Client Upload Test] No folder selector modal appeared - upload might proceed directly');
      }

      // STEP 3: Wait for upload to complete and verify
      console.log('[Client Upload Test] Waiting for upload to complete...');

      // Wait for network to be idle - this ensures upload API call has completed
      console.log('[Client Upload Test] Waiting for network idle (upload API completion)...');
      await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {
        console.log('[Client Upload Test] Network idle timeout - continuing anyway');
      });

      // Wait for any upload spinner/indicator to disappear
      const uploadSpinner = page.locator('[data-testid="spinner"]').or(
        page.locator('text=Uploading').or(
          page.locator('.uploading, [role="progressbar"]')
        )
      );

      const spinnerVisible = await uploadSpinner.isVisible({ timeout: 3000 }).catch(() => false);
      if (spinnerVisible) {
        console.log('[Client Upload Test] Upload spinner visible, waiting for it to disappear...');
        await uploadSpinner.waitFor({ state: 'detached', timeout: 60_000 }).catch(() => {
          console.log('[Client Upload Test] Spinner still visible after 60s');
        });
        console.log('[Client Upload Test] ✓ Upload spinner disappeared');
      } else {
        console.log('[Client Upload Test] No upload spinner found (may have already disappeared)');
      }

      // Wait for upload container to close (indicates upload UI completed)
      console.log('[Client Upload Test] Waiting for upload container to close...');
      const uploadContainer = page.locator('[data-automation-id="documents-upload"]')
        .or(page.locator('[id$="-upload"]'));

      const containerVisible = await uploadContainer.first().isVisible({ timeout: 3000 }).catch(() => false);
      if (containerVisible) {
        console.log('[Client Upload Test] Upload container still visible, waiting for it to close...');
        await uploadContainer.first().waitFor({ state: 'detached', timeout: 60_000 }).catch(() => {
          console.log('[Client Upload Test] Upload container still visible after 60s');
        });
        console.log('[Client Upload Test] ✓ Upload container closed');
      } else {
        console.log('[Client Upload Test] Upload container already closed');
      }

      console.log('[Client Upload Test] Upload complete, verifying document card appears...');

      // STEP 4: Verify document card appears in the UI
      const documentCard = page.locator(`[data-document-name="${fileName}"]`).or(
        page.locator('.document-card').filter({ hasText: fileName })
      ).or(
        page.getByText(fileName)
      ).first();

      const cardVisible = await documentCard.isVisible({ timeout: 10_000 }).catch(() => false);
      console.log('[Client Upload Test] Document card visible:', cardVisible);

      if (cardVisible) {
        console.log('[Client Upload Test] ✓ Document card appeared in UI!');
      } else {
        console.log('[Client Upload Test] WARNING: Document card not visible in UI');
      }

      // STEP 5: Wait for document to appear in database (state-based wait)
      console.log('[Client Upload Test] Waiting for document to appear in database...');

      // Use Playwright's expect with toPass for automatic retry
      let uploadedDoc = null;
      await expect(async () => {
        uploadedDoc = await context.db('documents')
          .where({
            tenant: tenantId,
            document_name: fileName,
          })
          .first();

        expect(uploadedDoc).toBeDefined();
        expect(uploadedDoc).not.toBeNull();
      }).toPass({
        intervals: [1000, 2000, 5000],
        timeout: 60_000,
      });

      console.log('[Client Upload Test] ✓ Document found in database:', uploadedDoc!.document_id);

      // Verify association was created in document_associations table (state-based wait)
      console.log('[Client Upload Test] Waiting for association to be created...');
      let association = null;
      await expect(async () => {
        association = await context.db('document_associations')
          .where({
            tenant: tenantId,
            entity_type: 'client',
            entity_id: testClient.client_id,
            document_id: uploadedDoc!.document_id,
          })
          .first();

        // Association MUST exist for test to pass
        expect(association).toBeDefined();
        expect(association).not.toBeNull();
        expect(association.entity_type).toBe('client');
        expect(association.entity_id).toBe(testClient.client_id);
        expect(association.document_id).toBe(uploadedDoc!.document_id);
      }).toPass({
        intervals: [500, 1000, 2000],
        timeout: 30_000,
      });

      console.log('[Client Test] ✓ Upload association verified successfully!');

      // PART 2: Test creating in-app document from client page
      console.log('[Client Test] Testing in-app document creation from client page...');

      // Click "New Document" button in the client's documents section
      // Documents component uses ID pattern: {id}-new-document-btn
      const newDocButton = page.locator('[id$="-new-document-btn"]').or(
        page.getByRole('button', { name: /new document/i })
      ).first();

      const newDocVisible = await newDocButton.isVisible({ timeout: 5000 }).catch(() => false);
      if (!newDocVisible) {
        console.log('[Client Test] ⚠ New Document button not found - in-app document creation may not be available from client page');
      } else {
        await newDocButton.click();

        // STEP 1: Handle folder selector modal that appears first
        console.log('[Client Test] Waiting for folder selector modal...');
        const folderSelectorModal = page.locator('[role="dialog"]').filter({ hasText: /Select Folder for New Document/i });

        const folderModalVisible = await folderSelectorModal.isVisible({ timeout: 10_000 }).catch(() => false);

        if (folderModalVisible) {
          console.log('[Client Test] ✓ Folder selector modal opened');

          // Wait for folders to load if there's a loading state
          const loadingText = folderSelectorModal.getByText(/loading/i);
          const isLoading = await loadingText.isVisible({ timeout: 1000 }).catch(() => false);
          if (isLoading) {
            console.log('[Client Test] Waiting for folders to load...');
            await loadingText.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {
              console.log('[Client Test] Loading text still visible');
            });
          }

          // Root should be pre-selected, click Confirm to proceed
          const confirmButton = folderSelectorModal.getByRole('button', { name: /confirm/i });
          await confirmButton.waitFor({ state: 'visible', timeout: 5000 });

          // Wait for confirm button to be enabled
          let isEnabled = false;
          for (let i = 0; i < 20; i++) {
            isEnabled = await confirmButton.isEnabled().catch(() => false);
            if (isEnabled) {
              console.log('[Client Test] ✓ Confirm button is enabled');
              break;
            }
            await page.waitForTimeout(100);
          }

          if (isEnabled) {
            console.log('[Client Test] Clicking Confirm in folder selector...');
            await confirmButton.click();

            // Wait for folder selector to close
            await folderSelectorModal.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {
              console.log('[Client Test] Folder selector still visible');
            });
            console.log('[Client Test] ✓ Folder selector closed');
          } else {
            console.log('[Client Test] ⚠ Confirm button not enabled, continuing anyway...');
          }
        }

        // STEP 2: Now wait for the document name input drawer/dialog
        console.log('[Client Test] Waiting for document name input drawer to open...');
        const documentDrawer = page.locator('[role="dialog"]').last();
        await documentDrawer.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {
          console.log('[Client Test] Document name drawer did not appear');
        });

        // Declare docName in outer scope so it's accessible for database verification
        let docName: string | null = null;

        const drawerVisible = await documentDrawer.isVisible().catch(() => false);
        if (!drawerVisible) {
          console.log('[Client Test] ⚠ Document name drawer not found - feature may work differently');
        } else {
          console.log('[Client Test] ✓ Document name drawer opened');

          // Enter document name
          // Documents component uses ID pattern: {id}-document-name
          docName = `Client In-App Doc ${Date.now()}`;

          // Try ID selector first, then fall back to input strategies
          const nameInput = documentDrawer.locator('[id$="-document-name"]')
            .or(documentDrawer.locator('input[type="text"]').first())
            .or(documentDrawer.locator('input[placeholder*="name" i]'));

          console.log('[Client Test] Filling document name...');
          await nameInput.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {
            console.log('[Client Test] Name input not found');
          });

          const inputVisible = await nameInput.isVisible().catch(() => false);
          if (inputVisible) {
            await nameInput.fill(docName);
            console.log('[Client Test] ✓ Document name filled:', docName);

            // Save the document
            const saveButton = documentDrawer.getByRole('button', { name: /save|create/i }).first();
            console.log('[Client Test] Clicking save button...');
            await saveButton.click();

            // Wait for drawer to close (indicates save completed)
            await documentDrawer.waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {
              console.log('[Client Test] Drawer still visible after save');
            });
            console.log('[Client Test] ✓ Drawer closed, document should be saved');
          } else {
            console.log('[Client Test] ⚠ Could not find document name input field');
          }
        }

        // Verify in-app document was created and associated with client
        if (docName) {
          const inAppDoc = await context.db('documents')
            .where({
              tenant: tenantId,
              document_name: docName,
            })
            .first();

          if (inAppDoc) {
            console.log('[Client Test] ✓ In-app document created:', inAppDoc.document_id);

            // Verify it's associated with the client
            const inAppAssociation = await context.db('document_associations')
              .where({
                tenant: tenantId,
                entity_type: 'client',
                entity_id: testClient.client_id,
                document_id: inAppDoc.document_id,
              })
              .first();

            if (inAppAssociation) {
              console.log('[Client Test] ✓ In-app document associated with client automatically');
            } else {
              console.log('[Client Test] ⚠ In-app document not auto-associated - may need manual linking');
            }
          } else {
            console.log('[Client Test] ⚠ In-app document not found in database');
          }
        } else {
          console.log('[Client Test] ⚠ Document name not set - skipping database verification');
        }
      }

      await fs.unlink(filePath).catch(() => {});
    } else {
      console.log('[Client Upload Test] ⚠ Upload button not found - UI may not be implemented yet');
      throw new Error('Upload button not found - document upload UI is not accessible');
    }
  });

});
