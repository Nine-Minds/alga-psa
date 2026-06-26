import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../lib/testing/db-test-utils';
import type { TenantTestData } from '../../lib/testing/tenant-test-factory';
import {
  applyPlaywrightAuthEnvDefaults,
  createTenantAndLogin,
  resolvePlaywrightBaseUrl,
  setupAuthenticatedSession,
} from './helpers/playwrightAuthSessionHelper';

applyPlaywrightAuthEnvDefaults();

const BASE_URL = resolvePlaywrightBaseUrl();
const LIVE_UPDATES_ENABLED =
  process.env.NEXT_PUBLIC_DISABLE_FEATURE_FLAGS === 'false' &&
  (process.env.NEXT_PUBLIC_FORCE_FEATURE_FLAGS ?? '')
    .split(',')
    .some((entry) => entry.trim() === 'live-ticket-updates:true');
const LIVE_TICKET_PERF_SMOKE = process.env.LIVE_TICKET_PERF_SMOKE === 'true';
const LIVE_TICKET_PERF_ITERATIONS = Number.parseInt(process.env.LIVE_TICKET_PERF_ITERATIONS ?? '50', 10);
const LIVE_TICKET_PERF_THRESHOLD_MS = Number.parseInt(process.env.LIVE_TICKET_PERF_THRESHOLD_MS ?? '500', 10);
const LIVE_TICKET_PERF_STRICT = process.env.LIVE_TICKET_PERF_STRICT === 'true';
const PROJECT_ROOT = path.resolve(__dirname, '../../../../..');
const PLAYWRIGHT_DOCKER_ENV_FILE = fs.existsSync(path.resolve(PROJECT_ROOT, 'ee/server/.env'))
  ? 'ee/server/.env'
  : 'ee/server/.env.test';
const TEST_DISCOVERY_TENANT = '__test_discovery__';

type TicketRefs = {
  boardId: string;
  statusId: string;
  pendingStatusId: string;
  pendingStatusName: string;
  resolvedStatusId: string;
  resolvedStatusName: string;
  priorityId: string;
  elevatedPriorityId: string;
  elevatedPriorityName: string;
};

type InternalUserSeed = {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
};

function tenantTable(db: Knex, tenantId: string, table: string) {
  return tenantDb(db, tenantId).table(table);
}

async function createInternalUserLikeAdmin(
  db: Knex,
  tenantData: TenantTestData,
  overrides: { firstName: string; lastName: string; emailPrefix: string }
): Promise<InternalUserSeed> {
  const userId = uuidv4();
  const email = `${overrides.emailPrefix}-${userId.slice(0, 6)}@example.com`;
  const username = `${overrides.firstName.toLowerCase()}-${overrides.lastName.toLowerCase()}-${userId.slice(0, 6)}`;

  await tenantTable(db, tenantData.tenant.tenantId, 'users').insert({
    user_id: userId,
    tenant: tenantData.tenant.tenantId,
    username,
    email,
    first_name: overrides.firstName,
    last_name: overrides.lastName,
    user_type: 'internal',
    is_inactive: false,
    hashed_password: 'playwright-not-a-real-hash',
  });

  const adminRoles = await tenantTable(db, tenantData.tenant.tenantId, 'user_roles')
    .where({
      tenant: tenantData.tenant.tenantId,
      user_id: tenantData.adminUser.userId,
    })
    .select<{ role_id: string }[]>('role_id');

  if (adminRoles.length === 0) {
    throw new Error(`Admin user ${tenantData.adminUser.userId} has no roles to mirror for Playwright live-ticket tests`);
  }

  await tenantTable(db, tenantData.tenant.tenantId, 'user_roles').insert(
    adminRoles.map(({ role_id }) => ({
      tenant: tenantData.tenant.tenantId,
      user_id: userId,
      role_id,
    }))
  );

  return {
    userId,
    email,
    firstName: overrides.firstName,
    lastName: overrides.lastName,
  };
}

async function ensureTicketRefs(db: Knex, tenantId: string, createdByUserId: string): Promise<TicketRefs> {
  const statusColumns = await tenantDb(db, TEST_DISCOVERY_TENANT)
    .unscoped('statuses', 'columnInfo reads schema metadata, not tenant rows')
    .columnInfo();
  let board = await tenantTable(db, tenantId, 'boards').where({ tenant: tenantId }).first<{ board_id: string }>('board_id');
  if (!board?.board_id) {
    const boardId = uuidv4();
    await tenantTable(db, tenantId, 'boards').insert({
      tenant: tenantId,
      board_id: boardId,
      board_name: 'Live Updates Board',
      display_order: 0,
      is_default: true,
      is_inactive: false,
      category_type: 'custom',
      priority_type: 'custom',
      enable_live_ticket_timer: true,
    });
    board = { board_id: boardId };
  }

  const statusScope = (query: Knex.QueryBuilder) => {
    query.where({ tenant: tenantId });

    if (Object.prototype.hasOwnProperty.call(statusColumns, 'board_id')) {
      query.andWhere({ board_id: board.board_id });
    }

    query.andWhere(function () {
      this.where('item_type', 'ticket').orWhere('status_type', 'ticket');
    });
  };

  async function ensureStatus(name: string, orderNumber: number, isDefault = false): Promise<{ status_id: string; name: string }> {
    const existing = await tenantTable(db, tenantId, 'statuses')
      .modify(statusScope)
      .andWhere({ name })
      .first<{ status_id: string; name: string }>('status_id', 'name');

    if (existing?.status_id) {
      return existing;
    }

    const statusId = uuidv4();
    await tenantTable(db, tenantId, 'statuses').insert({
      tenant: tenantId,
      status_id: statusId,
      ...(Object.prototype.hasOwnProperty.call(statusColumns, 'board_id') ? { board_id: board.board_id } : {}),
      name,
      status_type: 'ticket',
      item_type: 'ticket',
      order_number: orderNumber,
      created_by: createdByUserId,
      created_at: db.fn.now(),
      is_closed: false,
      is_default: isDefault,
    });

    return { status_id: statusId, name };
  }

  const primaryStatus = await ensureStatus('Open', 1, true);
  const pendingStatus = await ensureStatus('On Hold', 2);
  const resolvedStatus = await ensureStatus('Resolved', 3);

  let priority = await tenantTable(db, tenantId, 'priorities')
    .where({ tenant: tenantId })
    .orderBy('order_number', 'asc')
    .first<{ priority_id: string; priority_name: string }>('priority_id', 'priority_name');

  if (!priority?.priority_id) {
    const priorityId = uuidv4();
    await tenantTable(db, tenantId, 'priorities').insert({
      tenant: tenantId,
      priority_id: priorityId,
      priority_name: 'Normal',
      created_by: createdByUserId,
      created_at: db.fn.now(),
      order_number: 10,
      item_type: 'ticket',
      color: '#64748b',
    });
    priority = { priority_id: priorityId, priority_name: 'Normal' };
  }

  let elevatedPriority = await tenantTable(db, tenantId, 'priorities')
    .where({ tenant: tenantId, priority_name: 'High' })
    .first<{ priority_id: string; priority_name: string }>('priority_id', 'priority_name');

  if (!elevatedPriority?.priority_id) {
    const priorityId = uuidv4();
    await tenantTable(db, tenantId, 'priorities').insert({
      tenant: tenantId,
      priority_id: priorityId,
      priority_name: 'High',
      created_by: createdByUserId,
      created_at: db.fn.now(),
      order_number: 20,
      item_type: 'ticket',
      color: '#ef4444',
    });
    elevatedPriority = { priority_id: priorityId, priority_name: 'High' };
  }

  return {
    boardId: board.board_id,
    statusId: primaryStatus.status_id,
    pendingStatusId: pendingStatus.status_id,
    pendingStatusName: pendingStatus.name,
    resolvedStatusId: resolvedStatus.status_id,
    resolvedStatusName: resolvedStatus.name,
    priorityId: priority.priority_id,
    elevatedPriorityId: elevatedPriority.priority_id,
    elevatedPriorityName: elevatedPriority.priority_name,
  };
}

async function createContact(db: Knex, tenantId: string, clientId: string, fullName: string): Promise<string> {
  const contactId = uuidv4();
  await tenantTable(db, tenantId, 'contacts').insert({
    tenant: tenantId,
    contact_name_id: contactId,
    client_id: clientId,
    full_name: fullName,
    email: `${fullName.toLowerCase().replace(/\s+/g, '.')}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  return contactId;
}

async function createTicket(db: Knex, params: {
  tenantId: string;
  clientId: string;
  boardId: string;
  statusId: string;
  priorityId: string;
  title: string;
  contactId: string;
}): Promise<string> {
  const ticketId = uuidv4();
  await tenantTable(db, params.tenantId, 'tickets').insert({
    tenant: params.tenantId,
    ticket_id: ticketId,
    ticket_number: `PW-LIVE-${ticketId.slice(0, 6).toUpperCase()}`,
    title: params.title,
    client_id: params.clientId,
    contact_name_id: params.contactId,
    board_id: params.boardId,
    status_id: params.statusId,
    priority_id: params.priorityId,
    entered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    email_metadata: JSON.stringify({
      messageId: `message-${uuidv4()}@mail.test`,
      threadId: `thread-${uuidv4()}`,
      references: [],
    }),
  });

  return ticketId;
}

async function openTicket(page: Page, ticketId: string): Promise<void> {
  await page.goto(`${BASE_URL}/msp/tickets/${ticketId}`);
  await expect(page.locator('#ticket-details-container')).toBeVisible({ timeout: 30_000 });
  const titleField = page.locator('[data-live-field="title"]').first();
  await expect(titleField).toBeVisible({ timeout: 30_000 });
  await expect(titleField.locator('h1, input')).toBeVisible({ timeout: 30_000 });
}

async function expectPresenceForPeer(page: Page, peerName: string): Promise<void> {
  await expect(page.locator(`[data-testid="presence-user"][title="${peerName}"]`)).toHaveCount(1, {
    timeout: 20_000,
  });
  await expect(page.getByTestId('ticket-live-connection-status')).toHaveCount(0);
}

function runWorkflowDepsDockerCommand(args: string): void {
  execSync(
    `docker compose -f docker-compose.playwright-workflow-deps.yml -p alga-psa-playwright-workflow --env-file ${PLAYWRIGHT_DOCKER_ENV_FILE} ${args}`,
    {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
      env: process.env,
    }
  );
}

async function selectTicketFieldOption(page: Page, fieldName: string, optionText: string): Promise<void> {
  const field = page.locator(`[data-live-field="${fieldName}"]`);
  await field.getByRole('combobox').click();
  await expect(page.getByRole('option', { name: optionText, exact: true })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('option', { name: optionText, exact: true }).click();
}

function getTicketField(page: Page, fieldName: string) {
  return page.locator(`[data-live-field="${fieldName}"]`);
}

async function expectTicketFieldValue(page: Page, fieldName: string, expectedText: string): Promise<void> {
  await expect(getTicketField(page, fieldName).getByRole('combobox')).toContainText(expectedText, { timeout: 10_000 });
}

function calculateP95(latenciesMs: number[]): number {
  const sorted = [...latenciesMs].sort((left, right) => left - right);
  const p95Index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
  return sorted[p95Index];
}

type LiveTicketScenario = {
  contextA: BrowserContext;
  contextB: BrowserContext;
  db: Knex;
  pageA: Page;
  pageB: Page;
  peerUser: InternalUserSeed;
  refs: TicketRefs;
  tenantData: TenantTestData;
  ticketId: string;
  dispose: () => Promise<void>;
};

async function createLiveTicketScenario(
  browser: Browser,
  title = 'Original live title',
  options: { waitForPresence?: boolean } = {}
): Promise<LiveTicketScenario> {
  const { waitForPresence = true } = options;
  const db = createTestDbConnection();
  let tenantData: TenantTestData | null = null;
  let contextA: BrowserContext | null = null;
  let contextB: BrowserContext | null = null;

  try {
    contextA = await browser.newContext();
    contextB = await browser.newContext();

    const pageA = await contextA.newPage();

    tenantData = await createTenantAndLogin(db, pageA, {
      tenantOptions: {
        tenantName: `Live Ticket Tenant ${uuidv4().slice(0, 6)}`,
        adminUser: {
          firstName: 'Editor',
          lastName: 'One',
          email: `editor-one-${uuidv4().slice(0, 6)}@example.com`,
        },
      },
      completeOnboarding: { completedAt: new Date() },
      permissions: [
        {
          roleName: 'Admin',
          permissions: [
            { resource: 'ticket', action: 'read' },
            { resource: 'ticket', action: 'update' },
            { resource: 'user', action: 'read' },
            { resource: 'asset', action: 'read' },
            { resource: 'user_settings', action: 'read' },
            { resource: 'project', action: 'read' },
          ],
        },
      ],
    });

    const peerUser = await createInternalUserLikeAdmin(db, tenantData, {
      firstName: 'Editor',
      lastName: 'Two',
      emailPrefix: 'editor-two',
    });

    const refs = await ensureTicketRefs(db, tenantData.tenant.tenantId, tenantData.adminUser.userId);
    const contactId = await createContact(
      db,
      tenantData.tenant.tenantId,
      tenantData.client!.clientId,
      'Live Ticket Contact'
    );
    const ticketId = await createTicket(db, {
      tenantId: tenantData.tenant.tenantId,
      clientId: tenantData.client!.clientId,
      boardId: refs.boardId,
      statusId: refs.statusId,
      priorityId: refs.priorityId,
      title,
      contactId,
    });

    const pageB = await openContextWithUser(contextB, tenantData, peerUser);

    await Promise.all([
      openTicket(pageA, ticketId),
      openTicket(pageB, ticketId),
    ]);

    if (waitForPresence) {
      await Promise.all([
        expectPresenceForPeer(pageA, 'Editor Two'),
        expectPresenceForPeer(pageB, 'Editor One'),
      ]);
    }

    return {
      contextA,
      contextB,
      db,
      pageA,
      pageB,
      peerUser,
      refs,
      tenantData,
      ticketId,
      dispose: async () => {
        await contextA?.close().catch(() => undefined);
        await contextB?.close().catch(() => undefined);
        if (tenantData) {
          await tenantTable(db, tenantData.tenant.tenantId, 'tenants')
            .where({ tenant: tenantData.tenant.tenantId })
            .del()
            .catch(() => undefined);
        }
        await db.destroy();
      },
    };
  } catch (error) {
    await contextA?.close().catch(() => undefined);
    await contextB?.close().catch(() => undefined);
    if (tenantData) {
      await tenantTable(db, tenantData.tenant.tenantId, 'tenants')
        .where({ tenant: tenantData.tenant.tenantId })
        .del()
        .catch(() => undefined);
    }
    await db.destroy();
    throw error;
  }
}

async function openContextWithUser(browserContext: BrowserContext, tenantData: TenantTestData, user: InternalUserSeed) {
  const page = await browserContext.newPage();
  await setupAuthenticatedSession(page, tenantData, {
    sessionClaims: {
      id: user.userId,
      email: user.email,
      name: `${user.firstName} ${user.lastName}`,
      username: user.email.toLowerCase(),
      tenant: tenantData.tenant.tenantId,
      user_type: 'internal',
    },
  });
  return page;
}

test.describe('Ticket live updates (Playwright)', () => {
  test.skip(!LIVE_UPDATES_ENABLED, 'Set NEXT_PUBLIC_DISABLE_FEATURE_FLAGS=false and NEXT_PUBLIC_FORCE_FEATURE_FLAGS=live-ticket-updates:true');

  test('T046: B saves status and A refreshes without losing a local title draft', async ({ browser }) => {
    test.setTimeout(300_000);

    const scenario = await createLiveTicketScenario(browser);

    try {
      const { pageA, pageB, refs } = scenario;
      const localDraftTitle = `Draft title ${uuidv4().slice(0, 4)}`;

      await pageA.getByTitle('Edit title').click();
      await pageA.locator('#ticket-details-title-input').fill(localDraftTitle);

      const liveUpdateStartedAt = Date.now();
      await selectTicketFieldOption(pageB, 'status_id', refs.pendingStatusName);
      await pageB.locator('#ticket-details-info-save-changes-btn').click();

      await expect.poll(async () => {
        return (await getTicketField(pageA, 'status_id').getAttribute('data-live-highlighted')) === 'true' &&
          (await getTicketField(pageA, 'status_id').getByRole('combobox').textContent())?.includes(refs.pendingStatusName) &&
          (await pageA.locator('#ticket-details-title-input').inputValue()) === localDraftTitle;
      }, {
        timeout: 2_000,
        intervals: [50, 100, 150, 200],
      }).toBe(true);

      expect(Date.now() - liveUpdateStartedAt).toBeLessThanOrEqual(2_000);
      await expect(pageA.locator('#ticket-details-title-input')).toHaveValue(localDraftTitle);
      await expect(pageA).toHaveURL(`${BASE_URL}/msp/tickets/${scenario.ticketId}`);
    } finally {
      await scenario.dispose();
    }
  });

  test('T047: hocuspocus outage shows offline mode, preserves REST saves, and refetches after reconnect', async ({ browser }) => {
    test.setTimeout(300_000);

    const scenario = await createLiveTicketScenario(browser);
    let hocuspocusStopped = false;

    try {
      const { pageA, pageB } = scenario;
      const updatedTitle = `Offline-save title ${uuidv4().slice(0, 4)}`;
      const originalTitle = (await pageA.locator('#ticket-details-container h1').first().textContent())?.trim();

      runWorkflowDepsDockerCommand('stop hocuspocus-playwright');
      hocuspocusStopped = true;

      await expect(pageA.getByTestId('ticket-live-connection-status')).toHaveText(
        'Live updates offline — reconnecting…',
        { timeout: 35_000 }
      );
      await expect(pageA.locator('#ticket-details-container')).toBeVisible();

      await pageB.getByTitle('Edit title').click();
      await pageB.locator('#ticket-details-title-input').fill(updatedTitle);
      await pageB.locator('#ticket-details-save-title-btn').click();
      await expect(pageB.locator('#ticket-details-container h1').first()).toHaveText(updatedTitle, { timeout: 10_000 });

      await expect.poll(async () => {
        return (await pageA.locator('#ticket-details-container h1').first().textContent())?.trim();
      }, {
        timeout: 1_500,
        intervals: [100, 200, 300],
      }).toBe(originalTitle);

      runWorkflowDepsDockerCommand('up -d --wait --wait-timeout 120 hocuspocus-playwright');
      hocuspocusStopped = false;

      await expect(pageA.getByTestId('ticket-live-connection-status')).toHaveCount(0, { timeout: 35_000 });
      await expect
        .poll(async () => {
          return (await pageA.locator('#ticket-details-container h1').first().textContent())?.trim();
        }, {
          timeout: 35_000,
          intervals: [250, 500, 1000],
        })
        .toBe(updatedTitle);
    } finally {
      if (hocuspocusStopped) {
        runWorkflowDepsDockerCommand('up -d --wait --wait-timeout 120 hocuspocus-playwright');
      }
      await scenario.dispose();
    }
  });

  test('T048: focus indicator appears on a peer while status is being edited and clears on blur', async ({ browser }) => {
    test.setTimeout(300_000);

    const scenario = await createLiveTicketScenario(browser);

    try {
      const { pageA, pageB } = scenario;

      await getTicketField(pageA, 'status_id').getByRole('combobox').click();

      await expect(getTicketField(pageB, 'status_id')).toHaveAttribute('data-live-editing', 'true', { timeout: 5_000 });
      await expect(pageB.getByText('Editor One is editing', { exact: true })).toBeVisible({ timeout: 5_000 });

      await pageA.locator('#ticket-details-container h1').first().click();

      await expect(getTicketField(pageB, 'status_id')).not.toHaveAttribute('data-live-editing', 'true', { timeout: 5_000 });
      await expect(pageB.getByText('Editor One is editing', { exact: true })).toHaveCount(0);
    } finally {
      await scenario.dispose();
    }
  });

  test('T049: same-field status conflict shows a banner and Take theirs applies the remote value', async ({ browser }) => {
    test.setTimeout(300_000);

    const scenario = await createLiveTicketScenario(browser);

    try {
      const { pageA, pageB, refs } = scenario;
      const localDraftTitle = `Conflict draft ${uuidv4().slice(0, 4)}`;

      await pageA.getByTitle('Edit title').click();
      await pageA.locator('#ticket-details-title-input').fill(localDraftTitle);
      await selectTicketFieldOption(pageA, 'status_id', refs.pendingStatusName);

      await selectTicketFieldOption(pageB, 'status_id', refs.resolvedStatusName);
      await pageB.locator('#ticket-details-info-save-changes-btn').click();

      await expect(getTicketField(pageA, 'status_id')).toHaveAttribute('data-live-conflict', 'true', { timeout: 5_000 });
      await expect(pageA.getByRole('alert')).toContainText('Editor Two', { timeout: 5_000 });
      await expect(pageA.getByRole('alert')).toContainText(refs.resolvedStatusName);

      await pageA.getByRole('button', { name: 'Take theirs', exact: true }).click();

      await expect(getTicketField(pageA, 'status_id')).not.toHaveAttribute('data-live-conflict', 'true', { timeout: 5_000 });
      await expectTicketFieldValue(pageA, 'status_id', refs.resolvedStatusName);
      await expect(pageA.locator('#ticket-details-title-input')).toHaveValue(localDraftTitle);
    } finally {
      await scenario.dispose();
    }
  });

  test('T050: non-overlapping remote update keeps the local status draft and shows a toast', async ({ browser }) => {
    test.setTimeout(300_000);

    const scenario = await createLiveTicketScenario(browser);

    try {
      const { pageA, pageB, refs } = scenario;

      await selectTicketFieldOption(pageA, 'status_id', refs.pendingStatusName);
      await selectTicketFieldOption(pageB, 'priority_id', refs.elevatedPriorityName);
      await pageB.locator('#ticket-details-info-save-changes-btn').click();

      await expect(pageA.getByText('Editor Two updated priority', { exact: true })).toBeVisible({ timeout: 5_000 });
      await expectTicketFieldValue(pageA, 'status_id', refs.pendingStatusName);
      await expectTicketFieldValue(pageA, 'priority_id', refs.elevatedPriorityName);
    } finally {
      await scenario.dispose();
    }
  });

  test('T051: opening the same ticket in two tabs only shows one presence avatar per user', async ({ browser }) => {
    test.setTimeout(300_000);

    const scenario = await createLiveTicketScenario(browser);

    try {
      const { contextA, pageB, ticketId } = scenario;
      const pageASecond = await contextA.newPage();

      try {
        await openTicket(pageASecond, ticketId);
        await expect(pageB.locator('[data-testid="presence-user"][title="Editor One"]')).toHaveCount(1, {
          timeout: 20_000,
        });
      } finally {
        await pageASecond.close().catch(() => undefined);
      }
    } finally {
      await scenario.dispose();
    }
  });

  test('T059: B saves a title change and A sees it without a reload', async ({ browser }) => {
    test.setTimeout(300_000);

    const scenario = await createLiveTicketScenario(browser);

    try {
      const { pageA, pageB } = scenario;

      const updatedTitle = `Updated live title ${uuidv4().slice(0, 4)}`;

      await pageB.getByTitle('Edit title').click();
      await pageB.locator('#ticket-details-title-input').fill(updatedTitle);

      const liveUpdateStartedAt = Date.now();
      await pageB.locator('#ticket-details-save-title-btn').click();

      await expect
        .poll(async () => {
          return (await pageA.locator('#ticket-details-container h1').first().textContent())?.trim();
        }, {
          timeout: 1500,
          intervals: [50, 100, 150, 200],
        })
        .toBe(updatedTitle);

      expect(Date.now() - liveUpdateStartedAt).toBeLessThanOrEqual(1500);
      await expect(pageA).toHaveURL(`${BASE_URL}/msp/tickets/${scenario.ticketId}`);
    } finally {
      await scenario.dispose();
    }
  });

  test('T057: performance smoke reports remote update latency over 50 saves', async ({ browser }) => {
    test.skip(!LIVE_TICKET_PERF_SMOKE, 'Set LIVE_TICKET_PERF_SMOKE=true to run the perf smoke');
    test.setTimeout(300_000);

    const scenario = await createLiveTicketScenario(browser, 'Original live title', { waitForPresence: false });

    try {
      const { pageA, pageB, refs } = scenario;
      const saveChangesButton = pageB.locator('#ticket-details-info-save-changes-btn');

      const saveNextStatusAndWaitForRemoteApply = async (): Promise<number> => {
        const currentStatusText = (await getTicketField(pageB, 'status_id').getByRole('combobox').textContent()) ?? '';
        const nextStatusName = currentStatusText.includes(refs.pendingStatusName)
          ? refs.resolvedStatusName
          : refs.pendingStatusName;

        await selectTicketFieldOption(pageB, 'status_id', nextStatusName);
        await expect(saveChangesButton).toBeVisible({ timeout: 10_000 });
        await expect(saveChangesButton).toBeEnabled({ timeout: 10_000 });

        const startedAt = Date.now();
        await saveChangesButton.click();

        await expect
          .poll(async () => {
            return (await getTicketField(pageA, 'status_id').getByRole('combobox').textContent())?.includes(nextStatusName);
          }, {
            timeout: 5_000,
            intervals: [25, 50, 75, 100, 150, 200],
          })
          .toBe(true);

        return Date.now() - startedAt;
      };

      await saveNextStatusAndWaitForRemoteApply();

      const latenciesMs: number[] = [];
      for (let iteration = 0; iteration < LIVE_TICKET_PERF_ITERATIONS; iteration += 1) {
        latenciesMs.push(await saveNextStatusAndWaitForRemoteApply());
      }

      const p95Ms = calculateP95(latenciesMs);
      console.log(
        JSON.stringify({
          metric: 'ticket-live-update-latency',
          measuredFrom: 'ui-save-click',
          iterations: latenciesMs.length,
          p95Ms,
          minMs: Math.min(...latenciesMs),
          maxMs: Math.max(...latenciesMs),
          thresholdMs: LIVE_TICKET_PERF_THRESHOLD_MS,
          strict: LIVE_TICKET_PERF_STRICT,
          latenciesMs,
        })
      );

      expect(latenciesMs).toHaveLength(LIVE_TICKET_PERF_ITERATIONS);
      expect(latenciesMs.every((latencyMs) => Number.isFinite(latencyMs) && latencyMs > 0)).toBe(true);

      if (LIVE_TICKET_PERF_STRICT) {
        expect(p95Ms).toBeLessThanOrEqual(LIVE_TICKET_PERF_THRESHOLD_MS);
      } else if (p95Ms > LIVE_TICKET_PERF_THRESHOLD_MS) {
        console.warn(
          `[ticket-live-perf] P95 ${p95Ms}ms exceeded ${LIVE_TICKET_PERF_THRESHOLD_MS}ms in local smoke mode; rerun with LIVE_TICKET_PERF_STRICT=true to enforce.`
        );
      }
    } finally {
      await scenario.dispose();
    }
  });
});
