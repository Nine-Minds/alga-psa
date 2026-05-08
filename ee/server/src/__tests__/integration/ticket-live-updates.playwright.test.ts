import { expect, test, type BrowserContext, type Page } from '@playwright/test';
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

type TicketRefs = {
  boardId: string;
  statusId: string;
  priorityId: string;
};

type InternalUserSeed = {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
};

async function createInternalUserLikeAdmin(
  db: Knex,
  tenantData: TenantTestData,
  overrides: { firstName: string; lastName: string; emailPrefix: string }
): Promise<InternalUserSeed> {
  const userId = uuidv4();
  const email = `${overrides.emailPrefix}-${userId.slice(0, 6)}@example.com`;
  const username = `${overrides.firstName.toLowerCase()}-${overrides.lastName.toLowerCase()}-${userId.slice(0, 6)}`;

  await db('users').insert({
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

  const adminRoles = await db('user_roles')
    .where({
      tenant: tenantData.tenant.tenantId,
      user_id: tenantData.adminUser.userId,
    })
    .select<{ role_id: string }[]>('role_id');

  if (adminRoles.length === 0) {
    throw new Error(`Admin user ${tenantData.adminUser.userId} has no roles to mirror for Playwright live-ticket tests`);
  }

  await db('user_roles').insert(
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
  let board = await db('boards').where({ tenant: tenantId }).first<{ board_id: string }>('board_id');
  if (!board?.board_id) {
    const boardId = uuidv4();
    await db('boards').insert({
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

  let status = await db('statuses')
    .where({ tenant: tenantId })
    .andWhere(function () {
      this.where('item_type', 'ticket').orWhere('status_type', 'ticket');
    })
    .orderBy('is_default', 'desc')
    .orderBy('order_number', 'asc')
    .first<{ status_id: string }>('status_id');

  if (!status?.status_id) {
    const statusId = uuidv4();
    await db('statuses').insert({
      tenant: tenantId,
      status_id: statusId,
      name: 'Open',
      status_type: 'ticket',
      order_number: 1,
      created_by: createdByUserId,
      created_at: db.fn.now(),
      is_closed: false,
      is_default: true,
    });
    status = { status_id: statusId };
  }

  let priority = await db('priorities')
    .where({ tenant: tenantId })
    .orderBy('order_number', 'asc')
    .first<{ priority_id: string }>('priority_id');

  if (!priority?.priority_id) {
    const priorityId = uuidv4();
    await db('priorities').insert({
      tenant: tenantId,
      priority_id: priorityId,
      priority_name: 'Normal',
      created_by: createdByUserId,
      created_at: db.fn.now(),
      order_number: 10,
      item_type: 'ticket',
      color: '#64748b',
    });
    priority = { priority_id: priorityId };
  }

  return {
    boardId: board.board_id,
    statusId: status.status_id,
    priorityId: priority.priority_id,
  };
}

async function createContact(db: Knex, tenantId: string, clientId: string, fullName: string): Promise<string> {
  const contactId = uuidv4();
  await db('contacts').insert({
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
  await db('tickets').insert({
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
  await expect(page.locator('#ticket-details-container h1').first()).toBeVisible({ timeout: 30_000 });
}

async function expectPresenceForPeer(page: Page, peerName: string): Promise<void> {
  await expect(page.locator(`[data-testid="presence-user"][title="${peerName}"]`)).toHaveCount(1, {
    timeout: 20_000,
  });
  await expect(page.getByTestId('ticket-live-connection-status')).toHaveCount(0);
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

  test('T059: B saves a title change and A sees it without a reload', async ({ browser }) => {
    test.setTimeout(300_000);

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
        title: 'Original live title',
        contactId,
      });

      const pageB = await openContextWithUser(contextB, tenantData, peerUser);

      await Promise.all([
        openTicket(pageA, ticketId),
        openTicket(pageB, ticketId),
      ]);

      await Promise.all([
        expectPresenceForPeer(pageA, 'Editor Two'),
        expectPresenceForPeer(pageB, 'Editor One'),
      ]);

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
      await expect(pageA).toHaveURL(`${BASE_URL}/msp/tickets/${ticketId}`);
    } finally {
      await contextA?.close().catch(() => undefined);
      await contextB?.close().catch(() => undefined);

      if (tenantData) {
        await db('tenants').where({ tenant: tenantData.tenant.tenantId }).del().catch(() => undefined);
      }
      await db.destroy();
    }
  });
});
