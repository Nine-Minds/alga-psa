import type { Page } from '@playwright/test';
import { expect } from './auth';

export async function createMicrosoftProfile(page: Page, input: {
  name: string; clientId: string; clientSecret: string; capability: 'calendar' | 'email' | 'teams';
}) {
  await page.goto('/msp/settings?tab=integrations&category=providers');
  await page.locator('#provider-credentials-microsoft-tab').click();
  await expect(page.locator('#microsoft-advanced-app-toggle')).toBeVisible();
  if (!(await page.locator('#microsoft-settings-add-profile').isVisible())) {
    await page.locator('#microsoft-advanced-app-toggle').click();
  }
  await page.locator('#microsoft-settings-add-profile').click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#microsoft-profile-display-name').fill(input.name);
  await dialog.locator('#microsoft-profile-client-id').fill(input.clientId);
  await dialog.locator('#microsoft-profile-client-secret').fill(input.clientSecret);
  await dialog.locator('#microsoft-profile-tenant-id').fill('common');
  for (const capability of ['msp_sso', 'email', 'calendar', 'teams']) {
    const checkbox = dialog.locator(`#microsoft-profile-capability-${capability}`);
    if (await checkbox.count()) await checkbox.setChecked(capability === input.capability);
  }
  await dialog.locator('#microsoft-profile-save').click();
  await expect(dialog).toBeHidden();
}
