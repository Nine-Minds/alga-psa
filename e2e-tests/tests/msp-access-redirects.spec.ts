import { test, expect, readSession, signInPortal } from '../fixtures/auth';

test('an authenticated portal user reaches their dashboard from the MSP dashboard without a redirect loop', async ({ page, actors, credentials }, testInfo) => {
  const tenant = actors.primary;
  const actor = tenant.portal;
  await signInPortal(page, { email: actor.email, password: credentials.password }, tenant.tenantId);
  const identity = { id: actor.userId, email: actor.email, tenant: tenant.tenantId, user_type: 'client' };
  expect(await readSession(page.request)).toEqual(identity);

  const redirects: Array<{ from: string; to: string }> = [];
  const navigations: string[] = [];
  page.on('response', response => {
    if (!response.request().isNavigationRequest() || response.status() < 300 || response.status() >= 400) return;
    const location = response.headers().location;
    if (location) redirects.push({ from: new URL(response.url()).pathname, to: new URL(location, response.url()).pathname });
  });
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) navigations.push(new URL(frame.url()).pathname);
  });

  try {
    await page.goto('/msp/dashboard');
    await expect(page).toHaveURL(/\/client-portal\/dashboard(?:[/?#]|$)/);
    const greeting = page.getByRole('heading', { level: 2, name: /Good (morning|afternoon|evening), primary!/ });
    await expect(greeting).toBeVisible();
    expect(redirects).toContainEqual({ from: '/msp/dashboard', to: '/client-portal/dashboard' });
    expect(redirects.filter(({ to }) => to === '/msp/dashboard')).toEqual([]);
    expect(navigations.filter(path => path === '/msp/dashboard')).toHaveLength(0);
    expect(navigations.some(path => path.startsWith('/auth/'))).toBe(false);
    expect(await readSession(page.request)).toEqual(identity);
    await page.reload();
    await expect(greeting).toBeVisible();
    expect(await readSession(page.request)).toEqual(identity);
  } finally {
    await testInfo.attach('portal-dashboard-redirects', {
      body: JSON.stringify({ redirects, navigations }, null, 2), contentType: 'application/json',
    });
  }
});
