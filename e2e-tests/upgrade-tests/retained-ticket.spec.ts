import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import knex from 'knex';
import { signIn, readSession } from '../fixtures/auth';

test('upgraded tenants retain ticket writes and reject other-tenant record access', async ({ browser, baseURL }) => {
  if (process.env.E2E_DATABASE_ISOLATED !== 'true' || !process.env.UPGRADE_FIXTURE_PATH || !process.env.E2E_DB_NAME?.startsWith('upgrade_')) {
    throw new Error('Requires an isolated upgraded database and UPGRADE_FIXTURE_PATH from the upgrade runner');
  }
  const fixture = JSON.parse(readFileSync(process.env.UPGRADE_FIXTURE_PATH, 'utf8'));
  expect(fixture.baseline).toBe('v1.5.0');
  expect(fixture.identities).toHaveLength(2);
  const db = knex({ client: 'pg', connection: { host: process.env.E2E_DB_HOST, port: Number(process.env.E2E_DB_PORT),
    database: process.env.E2E_DB_NAME, user: process.env.E2E_DB_USER, password: process.env.E2E_DB_PASSWORD } });
  try {
    for (const [index, actor] of fixture.identities.entries()) {
      const other = fixture.identities[1 - index];
      const context = await browser.newContext({ baseURL });
      try {
        const page = await context.newPage();
        await signIn(page, { email: actor.email, password: process.env.E2E_USER_PASSWORD! });
        expect(await readSession(context.request)).toMatchObject({ id: actor.userId, tenant: actor.tenant });
        const ticket = await db('tickets').where({ tenant: actor.tenant, ticket_number: 'UPGRADE-1' }).first();
        expect(ticket.title).toBe(`Retained ${actor.label} ticket`);
        await page.goto(`/msp/tickets/${ticket.ticket_id}`);
        await expect(page.getByText(ticket.title, { exact: true }).locator('visible=true').first()).toBeVisible();
        const changeTitle = async (title: string) => {
          await page.getByRole('button', { name: 'Edit title', exact: true }).click();
          const input = page.locator('input[id$="-title-input"]');
          await input.fill(title);
          await input.press('Enter');
          const [request] = await Promise.all([
            page.waitForRequest(request => request.method() === 'POST' && Boolean(request.headers()['next-action'])
              && Boolean(request.postData()?.includes(ticket.ticket_id)) && Boolean(request.postData()?.includes(title))),
            page.getByRole('button', { name: /^Save Changes/ }).click(),
          ]);
          await expect.poll(async () => (await db('tickets').where({ tenant: actor.tenant, ticket_id: ticket.ticket_id }).first()).title).toBe(title);
          await page.reload();
          await expect(page.getByText(title, { exact: true }).locator('visible=true').first()).toBeVisible();
          return request;
        };
        const savedTitle = `${ticket.title} updated after upgrade`;
        const saveRequest = await changeTitle(savedTitle);
        await changeTitle(ticket.title);
        const otherTicket = await db('tickets').where({ tenant: other.tenant, ticket_number: 'UPGRADE-1' }).first();
        const originalBody = saveRequest.postData()!;
        const forbiddenBody = originalBody.replaceAll(ticket.ticket_id, otherTicket.ticket_id)
          .replace(savedTitle, 'Forbidden upgrade ticket edit');
        expect(forbiddenBody).not.toBe(originalBody);
        expect(forbiddenBody).toContain(otherTicket.ticket_id);
        const rejected = await context.request.post(saveRequest.url(), {
          headers: { 'next-action': saveRequest.headers()['next-action'],
            'content-type': saveRequest.headers()['content-type'], origin: new URL(baseURL!).origin },
          data: forbiddenBody,
        });
        expect(rejected.status()).toBe(200);
        expect(await rejected.text()).toMatch(/not found|does not belong/i);
        expect(await db('tickets').where({ tenant: other.tenant, ticket_id: otherTicket.ticket_id }).first()).toEqual(otherTicket);
        await page.goto(`/msp/tickets/${otherTicket.ticket_id}`);
        await expect(page.locator('#ticket-error-message')).toContainText(/not found/i);
        await expect(page.getByText(otherTicket.title, { exact: true })).toHaveCount(0);
        await page.goto(`/msp/clients/${actor.billing.clientId}`);
        await expect(page.getByRole('heading', { name: /Invoice ticket acceptance/ }).first()).toBeVisible();
        await page.goto(`/msp/clients/${other.billing.clientId}`);
        await expect(page.getByRole('heading', { name: '404 - Page Not Found', exact: true })).toBeVisible();
        await expect(page.getByText(`Retained ${other.label} ticket`, { exact: true })).toHaveCount(0);
      } finally { await context.close(); }
    }
  } finally { await db.destroy(); }
});
