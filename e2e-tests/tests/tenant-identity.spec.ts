import { test, expect, readSession, signIn } from '../fixtures/auth';

for (const tenantKey of ['primary', 'secondary'] as const) {
  test(`${tenantKey} tenant admin sees its client after reload and cannot read another tenant's client`, async ({ page, actors, credentials, database }) => {
    const tenant = actors[tenantKey];
    const other = actors[tenantKey === 'primary' ? 'secondary' : 'primary'];
    await signIn(page, { email: tenant.admin.email, password: credentials.password });
    expect(await readSession(page.request)).toEqual({ id: tenant.admin.userId, email: tenant.admin.email, tenant: tenant.tenantId, user_type: 'internal' });

    await page.goto(`/msp/clients/${tenant.clients.primary.id}`);
    await expect(page.getByRole('heading', { name: tenant.clients.primary.name, exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: tenant.clients.primary.name, exact: true })).toBeVisible();

    await page.goto(`/msp/clients/${other.clients.primary.id}`);
    await expect(page.getByRole('heading', { name: '404 - Page Not Found', exact: true })).toBeVisible();
    await expect(page.getByText(other.clients.primary.name, { exact: true })).toHaveCount(0);
    expect(await readSession(page.request)).toMatchObject({ id: tenant.admin.userId, tenant: tenant.tenantId });
    expect(await database('clients').where({ tenant: other.tenantId, client_id: other.clients.primary.id }).first())
      .toMatchObject({ client_name: other.clients.primary.name, is_inactive: false });
  });
}

test('a technician signs in with its own identity and can read its tenant client', async ({ page, actors, credentials }) => {
  const { technician, clients, tenantId } = actors.primary;
  await signIn(page, { email: technician.email, password: credentials.password });
  expect(await readSession(page.request)).toEqual({ id: technician.userId, email: technician.email, tenant: tenantId, user_type: 'internal' });
  await page.goto(`/msp/clients/${clients.primary.id}`);
  await expect(page.getByRole('heading', { name: clients.primary.name, exact: true })).toBeVisible();
});
