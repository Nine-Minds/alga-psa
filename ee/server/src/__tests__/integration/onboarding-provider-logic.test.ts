import { test, expect } from '@playwright/test';
import { createOnboardingTestSession } from '../utils/onboarding-helpers';
import { createTestTenant, type TenantTestOptions } from '../../lib/testing/tenant-test-factory';
import { verifyTenantSettings } from '../utils/db-verification';
import { createTestDbConnection } from '../../lib/testing/db-test-utils';

test.describe('Onboarding Provider Logic Tests', () => {
  let db: any;

  test.beforeAll(async () => {
    db = createTestDbConnection();
  });

  test.afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  test('should not show onboarding wizard when tenant settings do not exist', async ({ page }) => {
    // Create a tenant without initializing tenant_settings
    const tenantData = await createTestTenant(db);
    
    // Create session and login
    const session = createOnboardingTestSession(page, tenantData);
    await session.loginPage.login(tenantData.adminUser.email, tenantData.adminUser.temporaryPassword);
    
    // Wait for dashboard to load (should not show onboarding wizard)
    await session.dashboard.verifyDashboardLoaded();
    
    // Verify onboarding wizard is not present
    const onboardingDialog = page.locator('[data-testid="onboarding-wizard"]');
    await expect(onboardingDialog).not.toBeVisible();
  });

  test('should not show onboarding wizard when only one setting exists', async ({ page }) => {
    // Create a tenant and manually set only onboarding_completed
    const tenantData = await createTestTenant(db);
    
    // Manually insert partial tenant settings (only onboarding_completed)
    await db('tenant_settings').insert({
      tenant: tenantData.tenant.tenantId,
      onboarding_completed: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });
    
    // Create session and login
    const session = createOnboardingTestSession(page, tenantData);
    await session.loginPage.login(tenantData.adminUser.email, tenantData.adminUser.temporaryPassword);
    
    // Wait for dashboard to load (should not show onboarding wizard)
    await session.dashboard.verifyDashboardLoaded();
    
    // Verify onboarding wizard is not present
    const onboardingDialog = page.locator('[data-testid="onboarding-wizard"]');
    await expect(onboardingDialog).not.toBeVisible();
  });

  test('should show onboarding wizard when both settings exist and are false', async ({ page }) => {
    // Create a tenant with proper tenant settings initialization
    const tenantData = await createTestTenant(db, {
      initializeTenantSettings: true,
      onboardingCompleted: false,
      onboardingSkipped: false
    });
    
    // Create session and login
    const session = createOnboardingTestSession(page, tenantData);
    await session.loginPage.login(tenantData.adminUser.email, tenantData.adminUser.temporaryPassword);
    
    // Verify onboarding wizard is shown
    const onboardingDialog = page.locator('[data-testid="onboarding-wizard"]');
    await expect(onboardingDialog).toBeVisible();
    
    // Verify the wizard has the expected title
    const wizardTitle = page.locator('[data-testid="wizard-title"]');
    await expect(wizardTitle).toContainText('Setup Your System');
  });

  test('should not show onboarding wizard when onboarding is completed', async ({ page }) => {
    // Create a tenant with onboarding completed
    const tenantData = await createTestTenant(db, {
      initializeTenantSettings: true,
      onboardingCompleted: true,
      onboardingSkipped: false
    });
    
    // Create session and login
    const session = createOnboardingTestSession(page, tenantData);
    await session.loginPage.login(tenantData.adminUser.email, tenantData.adminUser.temporaryPassword);
    
    // Wait for dashboard to load
    await session.dashboard.verifyDashboardLoaded();
    
    // Verify onboarding wizard is not present
    const onboardingDialog = page.locator('[data-testid="onboarding-wizard"]');
    await expect(onboardingDialog).not.toBeVisible();
  });

  test('should not show onboarding wizard when onboarding is skipped', async ({ page }) => {
    // Create a tenant with onboarding skipped
    const tenantData = await createTestTenant(db, {
      initializeTenantSettings: true,
      onboardingCompleted: false,
      onboardingSkipped: true
    });
    
    // Create session and login
    const session = createOnboardingTestSession(page, tenantData);
    await session.loginPage.login(tenantData.adminUser.email, tenantData.adminUser.temporaryPassword);
    
    // Wait for dashboard to load
    await session.dashboard.verifyDashboardLoaded();
    
    // Verify onboarding wizard is not present
    const onboardingDialog = page.locator('[data-testid="onboarding-wizard"]');
    await expect(onboardingDialog).not.toBeVisible();
  });

  test('should verify tenant settings are properly created by temporal workflow', async ({ page }) => {
    // Create a tenant using the standard temporal workflow
    const tenantData = await createTestTenant(db);
    
    // Verify tenant settings were created with correct values
    await verifyTenantSettings(db, tenantData.tenant.tenantId, {
      onboarding_completed: false,
      onboarding_skipped: false,
      onboarding_data: null
    });
    
    // Create session and login
    const session = createOnboardingTestSession(page, tenantData);
    await session.loginPage.login(tenantData.adminUser.email, tenantData.adminUser.temporaryPassword);
    
    // Since settings exist and both are false, onboarding should show
    const onboardingDialog = page.locator('[data-testid="onboarding-wizard"]');
    await expect(onboardingDialog).toBeVisible();
  });

  test('should handle malformed tenant settings gracefully', async ({ page }) => {
    // Create a tenant and insert malformed settings
    const tenantData = await createTestTenant(db);
    
    // Insert settings with null values for boolean fields
    await db('tenant_settings').insert({
      tenant: tenantData.tenant.tenantId,
      onboarding_completed: null,
      onboarding_skipped: null,
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });
    
    // Create session and login
    const session = createOnboardingTestSession(page, tenantData);
    await session.loginPage.login(tenantData.adminUser.email, tenantData.adminUser.temporaryPassword);
    
    // Should not show onboarding wizard due to malformed data
    await session.dashboard.verifyDashboardLoaded();
    
    const onboardingDialog = page.locator('[data-testid="onboarding-wizard"]');
    await expect(onboardingDialog).not.toBeVisible();
  });
});