import { expect, test } from '@playwright/test';

const BASE_URL = process.env.EE_BASE_URL || 'http://localhost:3000';

// Lightweight fixtures to emulate API responses returned by the real accounting exports screen

type AccountingExportStatus =
  | 'pending'
  | 'validating'
  | 'ready'
  | 'delivered'
  | 'posted'
  | 'failed'
  | 'cancelled'
  | 'needs_attention';

type AccountingExportBatch = {
  batch_id: string;
  adapter_type: string;
  status: AccountingExportStatus;
  export_type: string;
  target_realm: string | null;
  filters: Record<string, unknown> | null;
  queued_at: string;
  validated_at: string | null;
  delivered_at: string | null;
  posted_at: string | null;
  created_by: string | null;
  last_updated_by: string | null;
  created_at: string;
  updated_at: string;
  notes: string | null;
};

type AccountingExportLine = {
  line_id: string;
  batch_id: string;
  invoice_id: string;
  amount_cents: number;
  currency_code: string;
  status: 'pending' | 'ready' | 'delivered' | 'posted' | 'failed';
  created_at: string;
  updated_at: string;
};

type AccountingExportError = {
  error_id: string;
  batch_id: string;
  line_id: string | null;
  code: string;
  message: string;
  resolution_state: 'open' | 'pending_review' | 'resolved' | 'dismissed';
  created_at: string;
  resolved_at: string | null;
};

test.describe('Accounting Exports – BatchLifecycle', () => {
  test('walks the batch lifecycle on the real dashboard with mocked APIs', async ({ page }) => {
    test.setTimeout(120_000);

    let batchCounter = 1;
    const batches: AccountingExportBatch[] = [];
    const linesByBatch = new Map<string, AccountingExportLine[]>();
    const errorsByBatch = new Map<string, AccountingExportError[]>();
    const transitionQueues = new Map<string, AccountingExportStatus[]>();
    const duplicateKeys = new Set<string>();

    const nowIso = () => new Date().toISOString();

    const findBatch = (batchId: string) => batches.find((batch) => batch.batch_id === batchId);

    const setBatchStatus = (batchId: string, status: AccountingExportStatus) => {
      const batch = findBatch(batchId);
      if (!batch) return;

      const timestamp = nowIso();
      batch.status = status;
      batch.updated_at = timestamp;

      if (status === 'validating') {
        batch.validated_at = timestamp;
      } else if (status === 'delivered') {
        batch.delivered_at = timestamp;
      } else if (status === 'posted') {
        batch.posted_at = timestamp;
      }

      const lines = linesByBatch.get(batchId);
      if (lines) {
        if (status === 'ready') {
          lines.forEach((line) => {
            line.status = 'ready';
            line.updated_at = timestamp;
          });
        }
        if (status === 'delivered') {
          lines.forEach((line) => {
            line.status = 'delivered';
            line.updated_at = timestamp;
          });
        }
        if (status === 'posted') {
          lines.forEach((line) => {
            line.status = 'posted';
            line.updated_at = timestamp;
          });
        }
        if (status === 'cancelled') {
          lines.forEach((line) => {
            line.status = 'failed';
            line.updated_at = timestamp;
          });
        }
      }
    };

    const buildBatchDetail = (batchId: string) => {
      const batch = findBatch(batchId);
      return {
        batch: batch ? { ...batch } : null,
        lines: linesByBatch.get(batchId)?.map((line) => ({ ...line })) ?? [],
        errors: errorsByBatch.get(batchId)?.map((error) => ({ ...error })) ?? []
      };
    };

    const progressTransitions = () => {
      for (const [batchId, queue] of transitionQueues.entries()) {
        if (queue.length === 0) {
          transitionQueues.delete(batchId);
          continue;
        }
        const nextStatus = queue.shift();
        if (nextStatus) {
          setBatchStatus(batchId, nextStatus);
        }
        if (queue.length === 0) {
          transitionQueues.delete(batchId);
        }
      }
    };

    await page.route(/.*\/api\/accounting\/exports\/([^\/]+)\/execute$/, async (route) => {
      const url = new URL(route.request().url());
      const segments = url.pathname.split('/');
      const batchId = segments[segments.length - 2];

      setBatchStatus(batchId, 'validating');
      transitionQueues.set(batchId, ['ready', 'delivered']);

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true })
      });
    });

    await page.route(/.*\/api\/accounting\/exports\/([^\/?]+)$/, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/execute')) {
        return route.continue();
      }
      const segments = url.pathname.split('/');
      const batchId = segments[segments.length - 1];
      const method = route.request().method();

      if (method === 'GET') {
        const detail = buildBatchDetail(batchId);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(detail)
        });
        return;
      }

      if (method === 'PATCH') {
        const body = route.request().postDataJSON() as { status?: AccountingExportStatus } | null;
        if (body?.status) {
          setBatchStatus(batchId, body.status);
          transitionQueues.delete(batchId);
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true })
        });
        return;
      }

      route.continue();
    });

    await page.route('**/api/accounting/exports', async (route) => {
      const method = route.request().method();
      const url = new URL(route.request().url());

      if (method === 'GET') {
        const statusParam = url.searchParams.get('status');
        const adapterParam = url.searchParams.get('adapter_type');
        let data = [...batches];
        if (statusParam && statusParam !== 'all') {
          data = data.filter((batch) => batch.status === statusParam);
        }
        if (adapterParam && adapterParam !== 'all') {
          data = data.filter((batch) => batch.adapter_type === adapterParam);
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(data)
        });
        progressTransitions();
        return;
      }

      if (method === 'POST') {
        const body = route.request().postDataJSON() as any;
        const key = `${body?.adapter_type ?? 'unknown'}|${body?.filters?.start_date ?? ''}|${body?.filters?.end_date ?? ''}`;
        if (duplicateKeys.has(key)) {
          await route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'Batch already exists for selected filters.' })
          });
          return;
        }
        duplicateKeys.add(key);

        const batchId = `BCH${String(batchCounter).padStart(3, '0')}`;
        batchCounter += 1;
        const timestamp = nowIso();

        const newBatch: AccountingExportBatch = {
          batch_id: batchId,
          adapter_type: body?.adapter_type ?? 'quickbooks_online',
          status: 'pending',
          export_type: 'invoice',
          target_realm: body?.target_realm ?? null,
          filters: body?.filters ?? null,
          queued_at: timestamp,
          validated_at: null,
          delivered_at: null,
          posted_at: null,
          created_by: 'Automation Harness',
          last_updated_by: 'Automation Harness',
          created_at: timestamp,
          updated_at: timestamp,
          notes: body?.notes ?? null
        };

        batches.unshift(newBatch);
        linesByBatch.set(batchId, [
          {
            line_id: `${batchId}-LINE-1`,
            batch_id: batchId,
            invoice_id: 'INV-1001',
            amount_cents: 425000,
            currency_code: 'USD',
            status: 'pending',
            created_at: timestamp,
            updated_at: timestamp
          }
        ]);
        errorsByBatch.set(batchId, []);

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(newBatch)
        });
        return;
      }

      route.continue();
    });

    await page.goto(`${BASE_URL}/msp/billing?tab=accounting-exports`, {
      waitUntil: 'networkidle'
    });

    const firstRowStatus = () =>
      page.locator('#accounting-export-table tbody tr').first().locator('td').nth(2);

    // Step 1: Create the initial batch, expect pending status and drawer
    await page.click('#accounting-export-new');
    const createDialog = page.locator('#accounting-export-create-dialog');
    await expect(createDialog).toBeVisible();
    await createDialog.getByLabel('Start Date').fill('2025-01-01');
    await createDialog.getByLabel('End Date').fill('2025-01-31');
    await createDialog.getByLabel('Target Realm / Connection').fill('Realm-001');
    await createDialog.locator('#accounting-export-create-submit').click();

    await expect(firstRowStatus()).toHaveText(/Pending/i);
    await expect(page.getByRole('heading', { name: /Batch BCH001/ })).toBeVisible();

    // Step 2: Execute and observe status transitions (validating -> ready -> delivered)
    await page.click('#accounting-export-execute');
    await expect(firstRowStatus()).toHaveText(/Validating/i);
    await page.click('#accounting-export-refresh');
    await expect(firstRowStatus()).toHaveText(/Ready/i);
    await page.click('#accounting-export-refresh');
    await expect(firstRowStatus()).toHaveText(/Delivered/i);

    // Step 3: Mark the batch as posted
    await page.click('#accounting-export-mark-posted');
    await expect(firstRowStatus()).toHaveText(/Posted/i);

    // Step 4: Attempt duplicate creation and expect warning
    await page.click('#accounting-export-new');
    await expect(createDialog).toBeVisible();
    await createDialog.getByLabel('Start Date').fill('2025-01-01');
    await createDialog.getByLabel('End Date').fill('2025-01-31');
    await createDialog.locator('#accounting-export-create-submit').click();
    await expect(createDialog.getByText(/Failed to create export batch/)).toBeVisible();
    await createDialog.locator('#accounting-export-create-cancel').click();

    // Step 5: Create a second batch and cancel it before delivery
    await page.click('#accounting-export-new');
    await expect(createDialog).toBeVisible();
    await createDialog.getByLabel('Start Date').fill('2025-02-01');
    await createDialog.getByLabel('End Date').fill('2025-02-28');
    await createDialog.locator('#accounting-export-create-submit').click();

    // New batch should appear at the top of the table
    const secondRow = page.locator('#accounting-export-table tbody tr').first();
    await expect(secondRow.locator('td').nth(0)).toHaveText('BCH002');
    await expect(secondRow.locator('td').nth(2)).toHaveText(/Pending/i);

    await page.click('#accounting-export-cancel');
    await expect(secondRow.locator('td').nth(2)).toHaveText(/Cancelled/i);
    await expect(page.locator('#accounting-export-mark-posted')).toBeDisabled();
    await expect(page.locator('#accounting-export-cancel')).toBeDisabled();
  });
});
