import { test, expect, readSession, signInPortal, submitPortalCredentials } from '../fixtures/auth';

for (const [tenantKey, actorKey] of [
  ['primary', 'portal'], ['primary', 'siblingPortal'], ['secondary', 'portal'],
] as const) {
  test(`${tenantKey} ${actorKey} signs in with its own portal identity and cannot enter the MSP client page`, async ({ page, actors, credentials }) => {
    const tenant = actors[tenantKey];
    const actor = tenant[actorKey];
    await signInPortal(page, { email: actor.email, password: credentials.password }, tenant.tenantId);
    const identity = { id: actor.userId, email: actor.email, tenant: tenant.tenantId, user_type: 'client' };
    expect(await readSession(page.request)).toEqual(identity);
    // The personalized heading appears after authenticated dashboard actions finish.
    const greeting = page.getByRole('heading', { level: 2, name: new RegExp(`Good (morning|afternoon|evening), ${tenantKey}!`) });
    await expect(greeting).toBeVisible();
    await page.reload();
    await expect(greeting).toBeVisible();
    expect(await readSession(page.request)).toEqual(identity);

    await page.goto(`/msp/clients/${tenant.clients.primary.id}`);
    await expect(page).toHaveURL(/\/client-portal\/dashboard(?:[/?#]|$)/);
    await expect(greeting).toBeVisible();
    await expect(page.getByRole('heading', { name: tenant.clients.primary.name, exact: true })).toHaveCount(0);
    expect(await readSession(page.request)).toEqual(identity);
  });
}

test('valid portal credentials for another tenant are rejected by the requested tenant sign-in', async ({ page, actors, credentials }) => {
  await submitPortalCredentials(page, { email: actors.primary.portal.email, password: credentials.password }, actors.secondary.tenantId);
  await expect(page.getByText('Invalid email or password', { exact: true })).toBeVisible();
  expect(await readSession(page.request)).toBeUndefined();
});
