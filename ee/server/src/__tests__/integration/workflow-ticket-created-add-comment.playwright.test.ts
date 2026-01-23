import { expect, test, type Page } from '@playwright/test';
import type { Knex } from 'knex';
import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../lib/testing/db-test-utils';
import { rollbackTenant } from '../../lib/testing/tenant-creation';
import type { TenantTestData } from '../../lib/testing/tenant-test-factory';
import {
  applyPlaywrightAuthEnvDefaults,
  createTenantAndLogin,
  resolvePlaywrightBaseUrl,
} from './helpers/playwrightAuthSessionHelper';
import { WorkflowDesignerPage } from '../page-objects/WorkflowDesignerPage';

applyPlaywrightAuthEnvDefaults();

const TEST_CONFIG = {
  baseUrl: resolvePlaywrightBaseUrl(),
};

const ADMIN_PERMISSIONS = [
  {
    roleName: 'Admin',
    permissions: [
      { resource: 'user', action: 'read' },
      { resource: 'workflow', action: 'read' },
      { resource: 'workflow', action: 'manage' },
      { resource: 'workflow', action: 'publish' },
      { resource: 'workflow', action: 'admin' },
      { resource: 'ticket', action: 'create' },
      { resource: 'ticket', action: 'update' },
    ],
  },
];

async function waitForCondition<T>(
  fn: () => Promise<T | null>,
  opts: { timeoutMs: number; intervalMs?: number; label: string }
): Promise<T> {
  const deadline = Date.now() + opts.timeoutMs;
  const interval = opts.intervalMs ?? 500;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(`Timed out waiting for ${opts.label}${lastError ? `: ${String((lastError as any)?.message ?? lastError)}` : ''}`);
}

async function getTenantTicketDefaults(
  db: Knex,
  opts: { tenantId: string; createdByUserId: string }
): Promise<{
  boardId: string;
  statusId: string;
  priorityId: string;
}> {
  const tenantId = opts.tenantId;
  const createdByUserId = opts.createdByUserId;

  const ensureDefaultBoard = async (): Promise<string> => {
    const board = await db('boards')
      .where({ tenant: tenantId })
      .orderBy([{ column: 'is_default', order: 'desc' }, { column: 'display_order', order: 'asc' }])
      .first(['board_id', 'is_default']);

    if (board?.board_id) {
      if (!board.is_default) {
        await db('boards')
          .where({ tenant: tenantId, board_id: board.board_id })
          .update({ is_default: true });
      }
      return board.board_id as string;
    }

    const boardId = uuidv4();
    await db('boards').insert({
      tenant: tenantId,
      board_id: boardId,
      board_name: 'Default',
      is_default: true,
      display_order: 1,
    });
    return boardId;
  };

  const ensureDefaultTicketStatus = async (): Promise<string> => {
    const status = await db('statuses')
      .where({ tenant: tenantId, status_type: 'ticket' })
      .orderBy([{ column: 'is_default', order: 'desc' }, { column: 'order_number', order: 'asc' }])
      .first(['status_id', 'is_default']);

    if (status?.status_id) {
      if (!status.is_default) {
        await db('statuses')
          .where({ tenant: tenantId, status_id: status.status_id })
          .update({ is_default: true });
      }
      return status.status_id as string;
    }

    const now = new Date();
    const statuses = [
      { name: 'New', order_number: 1, is_default: true, is_closed: false },
      { name: 'In Progress', order_number: 2, is_default: false, is_closed: false },
      { name: 'Resolved', order_number: 3, is_default: false, is_closed: true },
      { name: 'Closed', order_number: 4, is_default: false, is_closed: true },
    ];

    const inserted = await db('statuses')
      .insert(
        statuses.map((s) => ({
          status_id: uuidv4(),
          tenant: tenantId,
          name: s.name,
          status_type: 'ticket',
          item_type: 'ticket',
          order_number: s.order_number,
          created_by: createdByUserId,
          created_at: now,
          is_closed: s.is_closed,
          is_default: s.is_default,
        }))
      )
      .returning(['status_id', 'name']);

    const newStatus = inserted.find((row: any) => row.name === 'New') as { status_id: string } | undefined;
    if (!newStatus?.status_id) {
      throw new Error('Failed to create default ticket status for tenant');
    }
    return newStatus.status_id;
  };

  const ensureDefaultTicketPriority = async (): Promise<string> => {
    const priority = await db('priorities')
      .where({ tenant: tenantId, item_type: 'ticket' })
      .orderBy([{ column: 'order_number', order: 'asc' }])
      .first(['priority_id']);
    if (priority?.priority_id) return priority.priority_id as string;

    const now = new Date();
    const priorities = [
      { priority_name: 'Low', order_number: 1, color: '#10B981' },
      { priority_name: 'Medium', order_number: 2, color: '#F59E0B' },
      { priority_name: 'High', order_number: 3, color: '#EF4444' },
    ];

    const inserted = await db('priorities')
      .insert(
        priorities.map((p) => ({
          priority_id: uuidv4(),
          tenant: tenantId,
          priority_name: p.priority_name,
          order_number: p.order_number,
          color: p.color,
          item_type: 'ticket',
          created_by: createdByUserId,
          created_at: now,
        }))
      )
      .returning(['priority_id', 'priority_name']);

    const low = inserted.find((row: any) => row.priority_name === 'Low') as { priority_id: string } | undefined;
    if (!low?.priority_id) {
      throw new Error('Failed to create default ticket priority for tenant');
    }
    return low.priority_id;
  };

  const boardId = await ensureDefaultBoard();
  const statusId = await ensureDefaultTicketStatus();
  const priorityId = await ensureDefaultTicketPriority();

  return { boardId, statusId, priorityId };
}

async function getStepIds(page: Page): Promise<string[]> {
  const stepButtons = await page.locator('[id^="workflow-step-select-"]').all();
  const ids: string[] = [];
  for (const stepButton of stepButtons) {
    const id = await stepButton.getAttribute('id');
    if (id) {
      ids.push(id.replace('workflow-step-select-', ''));
    }
  }
  return ids;
}

async function createApiKeyForTenant(
  db: Knex,
  opts: { tenantId: string; userId: string; description?: string }
): Promise<string> {
  // Ensure RLS policies that depend on app.current_tenant do not block inserts.
  await db.raw(`select set_config('app.current_tenant', ?, true)`, [opts.tenantId]);

  const plaintext = `playwright_${uuidv4().replace(/-/g, '')}`;
  const hashed = createHash('sha256').update(plaintext).digest('hex');

  const now = new Date();
  const row: Record<string, any> = {
    api_key_id: uuidv4(),
    api_key: hashed,
    user_id: opts.userId,
    tenant: opts.tenantId,
    description: opts.description ?? 'Playwright workflow e2e',
    active: true,
    created_at: now,
    updated_at: now,
  };

  // Optional columns exist in newer schemas; only set them if present.
  if (await db.schema.hasColumn('api_keys', 'purpose')) row.purpose = 'playwright';
  if (await db.schema.hasColumn('api_keys', 'usage_count')) row.usage_count = 0;
  if (await db.schema.hasColumn('api_keys', 'metadata')) row.metadata = { test: 'workflow-ticket-created-add-comment' };

  await db('api_keys').insert(row);

  // Return plaintext key to be used in x-api-key header.
  return plaintext;
}

async function addActionStepFromPalette(page: Page, workflowPage: WorkflowDesignerPage, actionId: string, paletteSearch: string): Promise<string> {
  const existingStepIds = await getStepIds(page);

  await workflowPage.searchPalette(paletteSearch);
  const paletteItem = page.getByTestId(`palette-item-action:${actionId}`);
  await expect(paletteItem).toBeVisible({ timeout: 60_000 });
  await paletteItem.click();

  const updatedStepIds = await waitForCondition(
    async () => {
      const current = await getStepIds(page);
      return current.length === existingStepIds.length + 1 ? current : null;
    },
    { timeoutMs: 10_000, intervalMs: 250, label: 'new step to appear' }
  );

  const newStepId = updatedStepIds.find((id) => !existingStepIds.includes(id));
  if (!newStepId) {
    throw new Error('Failed to locate new action step id');
  }

  await workflowPage.stepSelectButton(newStepId).click();
  return newStepId;
}

async function setMonacoExpression(page: Page, ariaLabel: string, expression: string): Promise<void> {
  // Monaco's "textarea.inputarea" does not reliably carry our aria-label; use the labeled wrapper and force focus.
  const editor = page.getByLabel(new RegExp(ariaLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')).first();
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.scrollIntoViewIfNeeded();
  await editor.click({ force: true });

  const selectAll = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
  await page.keyboard.press(selectAll);
  await page.keyboard.type(expression);
  // Blur to ensure change handlers run.
  await page.keyboard.press('Tab');
}

test('E2E: TICKET_CREATED triggers workflow that adds a ticket comment', async ({ page }) => {
  test.setTimeout(300000);

  const db = createTestDbConnection();
  let tenantData: TenantTestData | null = null;

  const commentBody = 'hello from workflow';
  const workflowName = `E2E Ticket Comment ${uuidv4().slice(0, 8)}`;

  try {
    tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Ticket ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;
    // Keep tenant GUC set for any RLS-protected tables we touch in this test.
    await db.raw(`select set_config('app.current_tenant', ?, true)`, [tenantId]);

    const workflowPage = new WorkflowDesignerPage(page);
    await workflowPage.goto(TEST_CONFIG.baseUrl);

    await workflowPage.clickNewWorkflow();
    await workflowPage.setName(workflowName);
    // New workflows start in inferred contract mode; pin it so we can deterministically pick the schema ref for this test.
    await workflowPage.setContractModePinned();
    await workflowPage.selectPayloadSchemaRef('payload.TicketCreated.v1');
    await workflowPage.selectTriggerEvent('TICKET_CREATED');
    await workflowPage.waitForPipelineReady();

    // Prefer searching by action id to avoid label substring mismatches (e.g., "Add Ticket Comment" won't match "add comment").
    const stepId = await addActionStepFromPalette(page, workflowPage, 'tickets.add_comment', 'tickets.add_comment');

    // Map inputs: ticket_id ← payload.ticketId, body ← literal
    await page.locator(`#add-mapping-${stepId}-ticket_id`).click();
    await setMonacoExpression(page, 'Expression for ticket_id', 'payload.ticketId');

    await page.locator(`#add-mapping-${stepId}-body`).click();
    // Switch body mapping to literal and set message.
    const bodyTypeSelect = page.locator(`#mapping-${stepId}-body-type [role="combobox"]`).first();
    await expect(bodyTypeSelect).toBeVisible({ timeout: 30_000 });
    await bodyTypeSelect.click();
    await page.getByRole('option', { name: /^Literal$/ }).click();
    await page.locator(`#mapping-${stepId}-body-literal-str`).fill(commentBody);

    await workflowPage.saveDraft();

    const workflowIdFromUrl = new URL(page.url()).searchParams.get('workflowId');
    expect(workflowIdFromUrl).toBeTruthy();
    const workflowId = workflowIdFromUrl as string;

    await workflowPage.publishButton.click();
    // No global toast surface in EE app layout; wait on button state + DB to confirm publish.
    await expect(workflowPage.publishButton).toHaveText(/Publishing\.\.\./, { timeout: 30_000 });
    await expect(workflowPage.publishButton).toHaveText(/Publish/, { timeout: 90_000 });
    await waitForCondition(
      async () => {
        const row = await db('workflow_definition_versions')
          .where({ workflow_id: workflowId, version: 1 })
          .first(['published_at']);
        return row?.published_at ? row : null;
      },
      { timeoutMs: 90_000, intervalMs: 1000, label: 'workflow_definition_versions.published_at to be set' }
    );

    const { boardId, statusId, priorityId } = await getTenantTicketDefaults(db, {
      tenantId,
      createdByUserId: tenantData.adminUser.userId,
    });
    const clientId = tenantData.client?.clientId;
    if (!clientId) throw new Error('Tenant factory did not create a client');

    const apiKey = await createApiKeyForTenant(db, {
      tenantId,
      userId: tenantData.adminUser.userId,
    });

    const ticketTitle = `Ticket from workflow test ${uuidv4().slice(0, 6)}`;
    const createTicketResp = await page.request.post(`${TEST_CONFIG.baseUrl}/api/v1/tickets`, {
      headers: {
        'x-api-key': apiKey,
        'x-tenant-id': tenantId,
      },
      data: {
        title: ticketTitle,
        board_id: boardId,
        client_id: clientId,
        status_id: statusId,
        priority_id: priorityId,
      },
    });
    expect(createTicketResp.ok()).toBeTruthy();
    const createdTicket = (await createTicketResp.json()) as {
      data?: { ticket_id?: string; ticketId?: string };
      ticket_id?: string;
      ticketId?: string;
    };
    const ticketId =
      createdTicket.data?.ticket_id ??
      createdTicket.data?.ticketId ??
      createdTicket.ticket_id ??
      createdTicket.ticketId;
    expect(ticketId).toBeTruthy();

    // Wait for workflow runtime event + run linkage
    const eventRecord = await waitForCondition(
      async () => {
        const row = await db('workflow_runtime_events')
          .where({ tenant_id: tenantId, event_name: 'TICKET_CREATED' })
          .andWhereRaw(`payload->>'ticketId' = ?`, [ticketId])
          .orderBy('created_at', 'desc')
          .first(['event_id', 'matched_run_id']);
        return row ? (row as { event_id: string; matched_run_id: string | null }) : null;
      },
      { timeoutMs: 60_000, intervalMs: 500, label: 'workflow_runtime_events record for ticket' }
    );

    const runId = await waitForCondition(
      async () => {
        // Prefer a direct linkage if present, but fall back to finding the run by workflow + tenant + event type.
        const direct = await db('workflow_runtime_events')
          .where({ event_id: eventRecord.event_id })
          .first(['matched_run_id']);
        if (direct?.matched_run_id) return direct.matched_run_id as string;

        const run = await db('workflow_runs')
          .where({ tenant_id: tenantId, workflow_id: workflowId, event_type: 'TICKET_CREATED' })
          .orderBy('started_at', 'desc')
          .first(['run_id']);
        return run?.run_id ? (run.run_id as string) : null;
      },
      { timeoutMs: 60_000, intervalMs: 500, label: 'workflow run to be created' }
    );

    const terminalRun = await waitForCondition(
      async () => {
        const run = await db('workflow_runs').where({ run_id: runId }).first(['status', 'error_json', 'resume_error', 'node_path']);
        if (!run?.status) return null;
        if (['SUCCEEDED', 'FAILED', 'CANCELED'].includes(String(run.status))) return run as any;
        return null;
      },
      { timeoutMs: 120_000, intervalMs: 750, label: `workflow_runs(${runId}).status terminal` }
    );

    if (terminalRun.status !== 'SUCCEEDED') {
      const lastInvocation = await db('workflow_action_invocations')
        .where({ run_id: runId })
        .orderBy('created_at', 'desc')
        .first(['action_id', 'status', 'error_message']);

      const recentLogs = await db('workflow_run_logs')
        .where({ run_id: runId })
        .orderBy('created_at', 'desc')
        .limit(10)
        .select(['level', 'message', 'step_path', 'context_json', 'source']);

      throw new Error(
        [
          `Workflow run did not succeed (run_id=${runId})`,
          `status=${terminalRun.status}`,
          terminalRun.node_path ? `node_path=${terminalRun.node_path}` : null,
          terminalRun.error_json ? `error_json=${JSON.stringify(terminalRun.error_json)}` : null,
          terminalRun.resume_error ? `resume_error=${JSON.stringify(terminalRun.resume_error)}` : null,
          lastInvocation
            ? `last_invocation=${JSON.stringify({ action_id: lastInvocation.action_id, status: lastInvocation.status, error_message: lastInvocation.error_message })}`
            : 'last_invocation=null',
          `recent_logs=${JSON.stringify(recentLogs)}`
        ].filter(Boolean).join('\n')
      );
    }

    await waitForCondition(
      async () => {
        const invocation = await db('workflow_action_invocations')
          .where({ run_id: runId, action_id: 'tickets.add_comment' })
          .orderBy('created_at', 'desc')
          .first(['status', 'error_message']);
        if (!invocation?.status) return null;
        if (invocation.status === 'SUCCEEDED') return invocation;
        if (invocation.status === 'FAILED') {
          throw new Error(`tickets.add_comment failed: ${String(invocation.error_message ?? '')}`);
        }
        return null;
      },
      { timeoutMs: 60_000, intervalMs: 500, label: 'tickets.add_comment invocation SUCCEEDED' }
    );

    // Verify side effect in DB
    await waitForCondition(
      async () => {
        const comment = await db('comments')
          .where({ tenant: tenantId, ticket_id: ticketId })
          .andWhere({ note: commentBody })
          .first(['comment_id', 'is_internal', 'is_resolution', 'note']);
        return comment
          ? (comment as { comment_id: string; is_internal: boolean; is_resolution: boolean; note: string })
          : null;
      },
      { timeoutMs: 60_000, intervalMs: 500, label: 'ticket comment created' }
    );
  } finally {
    await db('workflow_definitions').where({ name: workflowName }).del().catch(() => undefined);
    if (tenantData) {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
    }
    await db.destroy().catch(() => undefined);
  }
});
