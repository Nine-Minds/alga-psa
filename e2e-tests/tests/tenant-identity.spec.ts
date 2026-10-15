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


test('a technician cannot elevate its own role through an administrator action', async ({ page, browser, baseURL, actors, credentials, database }) => {
  const tenant = actors.primary;
  const scope = { tenant: tenant.tenantId };
  const roles = await database('roles').where(scope);
  const adminRole = roles.find(role => role.role_name === 'Admin' && role.msp);
  const technicianRole = roles.find(role => role.role_name === 'Technician' && role.msp);
  expect(adminRole).toBeDefined();
  expect(technicianRole).toBeDefined();
  await signIn(page, { email: tenant.admin.email, password: credentials.password });
  await page.goto('/msp/settings/users');
  await page.locator(`#user-actions-menu-${tenant.admin.userId}`).click();
  await page.locator(`#edit-user-menu-item-${tenant.admin.userId}`).click();
  await page.getByRole('combobox').filter({ hasText: 'Select role to add' }).click();
  await page.getByRole('option', { name: 'Technician', exact: true }).click();
  const [roleRequest] = await Promise.all([
    page.waitForRequest(request => request.method() === 'POST'
      && Boolean(request.headers()['next-action'])
      && Boolean(request.postData()?.includes(tenant.admin.userId))
      && Boolean(request.postData()?.includes(technicianRole.role_id))),
    page.locator('#add-role-btn').click(),
  ]);
  await expect(page.locator(`#remove-role-${technicianRole.role_id}`)).toBeVisible();
  expect(await database('user_roles').where({ ...scope, user_id: tenant.admin.userId, role_id: technicianRole.role_id }))
    .toHaveLength(1);
  const before = await database('user_roles').where(scope).orderBy(['user_id', 'role_id']);

  const staff = await browser.newContext({ baseURL });
  try {
    const staffPage = await staff.newPage();
    await signIn(staffPage, { email: tenant.technician.email, password: credentials.password });
    expect(await readSession(staff.request)).toMatchObject({ id: tenant.technician.userId, tenant: tenant.tenantId });
    // Use the action ID and serialization emitted by the shipped admin UI, with
    // the technician's own session and a request to assign itself the Admin role.
    const original = roleRequest.postData()!;
    const attempted = original.replace(tenant.admin.userId, tenant.technician.userId)
      .replace(technicianRole.role_id, adminRole.role_id);
    expect(attempted).not.toBe(original);
    const result = await staff.request.post(roleRequest.url(), {
      headers: {
        'next-action': roleRequest.headers()['next-action'],
        'content-type': roleRequest.headers()['content-type'],
        origin: new URL(baseURL!).origin,
      },
      data: attempted,
    });
    expect(result.status()).toBe(200);
    expect(await result.text()).toContain('msp/settings:errors.roles.changePermission');
    expect(await database('user_roles').where(scope).orderBy(['user_id', 'role_id'])).toEqual(before);
    expect(await database('user_roles').where({ ...scope, user_id: tenant.technician.userId, role_id: adminRole.role_id }))
      .toEqual([]);
  } finally {
    await staff.close();
    await page.locator(`#remove-role-${technicianRole.role_id}`).click();
    await expect(page.locator(`#remove-role-${technicianRole.role_id}`)).toHaveCount(0);
  }
});
