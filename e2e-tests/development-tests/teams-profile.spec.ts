import { randomUUID } from 'node:crypto';
import { test, expect } from '../fixtures/emulators';
import { signIn } from '../fixtures/auth';
import { createMicrosoftProfile } from '../fixtures/microsoft-profile';
import { createProductionBrowserActors } from '../../server/test-utils/productionBrowserFixtures';

test.use({ emulatorProviders: ['msgraph'] });

test('Teams setup preserves its profile across a Graph credential outage and recovery', async ({ page, credentials, database, emulators }, testInfo) => {
  if (process.env.E2E_EDITION !== 'enterprise' || process.env.E2E_TEAMS_DEVELOPMENT !== 'true'
    || testInfo.config.metadata.releaseValidation !== false) {
    throw new Error('Requires the explicit Teams development configuration and a development app with TEAMS_EMULATOR_MODE=true');
  }
  const actors = await createProductionBrowserActors(database, { sourceEmail: credentials.email });
  const tenant = actors.primary, scope = { tenant: tenant.tenantId };
  const clientId = randomUUID(), profileName = `Teams app ${actors.runId}`;
  const clientSecret = `synthetic-teams-${actors.runId}`;
  await emulators.seed('msgraph', 'client', { clientId, clientSecret });
  try {
    await signIn(page, { email: tenant.admin.email, password: credentials.password });
    await createMicrosoftProfile(page, { name: profileName, clientId, clientSecret, capability: 'teams' });
    const profile = await database('microsoft_profiles').where({ ...scope, client_id: clientId }).first();
    expect(profile).toBeTruthy();
    await page.goto('/msp/settings?tab=integrations&category=communication');
    await page.getByRole('button', { name: 'Microsoft Teams', exact: true }).click();
    await page.locator('#teams-profile').selectOption({ label: profileName });
    await page.locator('#teams-save-draft').click();
    await expect.poll(async () => (await database('teams_integrations').where(scope).first())?.selected_profile_id).toBe(profile.profile_id);
    const saved = await database('teams_integrations').where(scope).first();

    await emulators.arm('msgraph', 'operation-fault', {
      operation: 'token', status: 503, body: { error: 'temporarily_unavailable', error_description: 'Synthetic Teams credential outage' },
    });
    await page.locator('#teams-validate-profile').click();
    const step = page.locator('#teams-wizard-step-microsoft-profile');
    await expect(step.getByText('Microsoft profile credentials are valid.', { exact: true })).toHaveCount(0);
    await expect(step.getByRole('alert')).toBeVisible();
    await expect.poll(async () => (await emulators.requests('msgraph')).requests.some((r: any) =>
      r.method === 'POST' && r.path.endsWith('/oauth2/v2.0/token') && r.status === 503)).toBe(true);
    expect((await database('teams_integrations').where(scope).first()).selected_profile_id).toBe(saved.selected_profile_id);

    await emulators.disarm('msgraph', 'operation-fault');
    await page.locator('#teams-validate-profile').click();
    await expect(step.getByText('Microsoft profile credentials are valid.', { exact: true })).toBeVisible();
    await expect.poll(async () => (await emulators.requests('msgraph')).requests.some((r: any) =>
      r.method === 'POST' && r.path.endsWith('/oauth2/v2.0/token') && r.status === 200)).toBe(true);
    await page.reload();
    await page.getByRole('button', { name: 'Microsoft Teams', exact: true }).click();
    await expect(page.locator('#teams-profile')).toHaveValue(profile.profile_id);
    expect(await database('microsoft_profiles').where({ ...scope, client_id: clientId })).toHaveLength(1);
    const retained = await database('teams_integrations').where(scope).first();
    expect(retained.selected_profile_id).toBe(saved.selected_profile_id);
    expect(retained.install_status).toBe(saved.install_status);
  } finally {
    await emulators.disarm('msgraph', 'operation-fault');
  }
});
