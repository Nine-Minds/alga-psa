/**
 * Onboarding test helpers
 * Utility functions for onboarding wizard integration tests
 */

import { Page, expect } from '@playwright/test';
import { LoginPage } from '../page-objects/LoginPage';
import { OnboardingWizard } from '../page-objects/OnboardingWizard';
import { Dashboard } from '../page-objects/Dashboard';
import type { TenantTestData } from '../../lib/testing/tenant-test-factory';

export interface OnboardingTestSession {
  loginPage: LoginPage;
  onboardingWizard: OnboardingWizard;
  dashboard: Dashboard;
  tenantData: TenantTestData;
}

/**
 * Initialize onboarding test session with page objects
 */
export function createOnboardingTestSession(
  page: Page,
  tenantData: TenantTestData
): OnboardingTestSession {
  return {
    loginPage: new LoginPage(page),
    onboardingWizard: new OnboardingWizard(page),
    dashboard: new Dashboard(page),
    tenantData,
  };
}

/**
 * Perform login with tenant credentials
 */
export async function loginWithTenantCredentials(
  session: OnboardingTestSession,
  baseUrl?: string
): Promise<void> {
  const { loginPage, tenantData } = session;
  
  // Navigate to login page
  await loginPage.goto(baseUrl);
  
  // Verify login page is loaded
  await loginPage.verifyLoginPageLoaded();
  
  // Login with tenant admin credentials
  await loginPage.loginAndWaitForNavigation(
    tenantData.adminUser.email,
    tenantData.adminUser.temporaryPassword
  );
}

/**
 * Complete onboarding wizard with default test data
 */
export async function completeOnboardingWizard(
  session: OnboardingTestSession,
  options: {
    skipOptionalSteps?: boolean;
    customData?: Record<string, any>;
  } = {}
): Promise<void> {
  const { onboardingWizard, tenantData } = session;
  const { skipOptionalSteps = false, customData = {} } = options;

  // Verify onboarding wizard is loaded
  await onboardingWizard.verifyWizardLoaded();

  // Complete the wizard with tenant-specific data
  await onboardingWizard.completeOnboardingFlow({
    clientName: tenantData.client?.clientName || tenantData.tenant.tenantName,
    skipOptionalSteps,
    ...customData,
  });

  // Verify onboarding completion
  await onboardingWizard.verifyOnboardingComplete();
}

/**
 * Verify user is redirected to onboarding on first login
 */
export async function verifyOnboardingRedirect(
  session: OnboardingTestSession,
  baseUrl?: string
): Promise<void> {
  await loginWithTenantCredentials(session, baseUrl);
  
  // Should be redirected to onboarding
  await session.onboardingWizard.verifyWizardLoaded();
}

/**
 * Verify dashboard access after onboarding completion
 */
export async function verifyDashboardAccess(
  session: OnboardingTestSession
): Promise<void> {
  const { dashboard, tenantData } = session;

  // Verify dashboard is loaded
  await dashboard.verifyDashboardLoaded();
  
  // Verify user is logged in
  await dashboard.verifyUserLoggedIn(tenantData.adminUser.firstName);
  
  // Verify onboarding is completed
  await dashboard.verifyOnboardingCompleted();
  
  // Verify basic dashboard functionality
  await dashboard.verifyDashboardWidgets();
  await dashboard.verifyNavigationMenu();
}

/**
 * Complete full onboarding flow from login to dashboard
 */
export async function completeFullOnboardingFlow(
  session: OnboardingTestSession,
  baseUrl?: string,
  options: {
    skipOptionalSteps?: boolean;
    customOnboardingData?: Record<string, any>;
  } = {}
): Promise<void> {
  // Step 1: Login with tenant credentials
  await loginWithTenantCredentials(session, baseUrl);
  
  // Step 2: Complete onboarding wizard
  await completeOnboardingWizard(session, options);
  
  // Step 3: Verify dashboard access
  await verifyDashboardAccess(session);
}

/**
 * Verify subsequent login bypasses onboarding
 */
export async function verifySubsequentLoginBypasses(
  session: OnboardingTestSession,
  baseUrl?: string
): Promise<void> {
  const { loginPage, dashboard, tenantData } = session;

  // Logout first
  await dashboard.logout();
  
  // Login again
  await loginPage.goto(baseUrl);
  await loginPage.loginAndWaitForNavigation(
    tenantData.adminUser.email,
    tenantData.adminUser.temporaryPassword
  );
  
  // Should go directly to dashboard, not onboarding
  await dashboard.verifyDashboardLoaded();
  await dashboard.verifyOnboardingCompleted();
}

/**
 * Test onboarding wizard navigation
 */
export async function testOnboardingNavigation(
  session: OnboardingTestSession
): Promise<void> {
  const { onboardingWizard } = session;

  await onboardingWizard.verifyWizardLoaded();

  // Test forward navigation
  const totalSteps = await onboardingWizard.getTotalSteps();
  for (let step = 1; step <= totalSteps; step++) {
    await onboardingWizard.verifyStepVisible(step);
    
    if (step < totalSteps) {
      // Skip or fill required fields for navigation
      const currentTitle = await onboardingWizard.getCurrentStepTitle();
      if (currentTitle.toLowerCase().includes('client')) {
        // Fill required client info
        await onboardingWizard.page.locator('input[name="clientName"]').fill('Test Client');
      }
      
      try {
        await onboardingWizard.clickNext();
      } catch {
        // If required fields prevent navigation, skip
        await onboardingWizard.clickSkip();
      }
    }
  }

  // Test backward navigation
  for (let step = totalSteps - 1; step >= 1; step--) {
    await onboardingWizard.clickBack();
    await onboardingWizard.verifyStepVisible(step);
  }
}

/**
 * Test onboarding form validation
 */
export async function testOnboardingValidation(
  session: OnboardingTestSession
): Promise<void> {
  const { onboardingWizard } = session;

  await onboardingWizard.verifyWizardLoaded();

  // Test required field validation on client info step
  await onboardingWizard.verifyStepVisible(1);
  
  // Try to proceed without filling required fields
  await onboardingWizard.clickNext();
  
  // Should still be on step 1 due to validation
  await onboardingWizard.verifyStepVisible(1);
  
  // Verify validation messages appear
  const validationMessages = onboardingWizard.page.locator('.error, .invalid, [aria-invalid="true"]');
  await expect(validationMessages.first()).toBeVisible();
}

/**
 * Test onboarding skip functionality
 */
export async function testOnboardingSkipFunctionality(
  session: OnboardingTestSession
): Promise<void> {
  const { onboardingWizard } = session;

  await onboardingWizard.verifyWizardLoaded();

  // Complete required steps and skip optional ones
  await onboardingWizard.completeOnboardingFlow({
    clientName: 'Skip Test Client',
    skipOptionalSteps: true,
  });

  await onboardingWizard.verifyOnboardingComplete();
}

/**
 * Capture onboarding wizard screenshots for debugging
 */
export async function captureOnboardingScreenshots(
  session: OnboardingTestSession,
  testName: string
): Promise<void> {
  const { onboardingWizard } = session;
  
  const totalSteps = await onboardingWizard.getTotalSteps();
  
  for (let step = 1; step <= totalSteps; step++) {
    await onboardingWizard.navigateToStep(step);
    await onboardingWizard.page.screenshot({
      path: `screenshots/${testName}-step-${step}.png`,
      fullPage: true,
    });
  }
}

/**
 * Verify onboarding wizard responsive design
 */
export async function testOnboardingResponsive(
  session: OnboardingTestSession,
  viewports: Array<{ width: number; height: number; name: string }>
): Promise<void> {
  const { onboardingWizard } = session;

  for (const viewport of viewports) {
    await onboardingWizard.page.setViewportSize(viewport);
    await onboardingWizard.verifyWizardLoaded();
    
    // Verify basic navigation works at this viewport
    const totalSteps = await onboardingWizard.getTotalSteps();
    if (totalSteps > 1) {
      await onboardingWizard.clickNext();
      await onboardingWizard.clickBack();
    }
  }
}

/**
 * Cleanup function for test session
 */
export async function cleanupTestSession(
  session: OnboardingTestSession
): Promise<void> {
  try {
    // Logout if still logged in
    if (await session.dashboard.logoutButton.isVisible()) {
      await session.dashboard.logout();
    }
  } catch (error) {
    // Ignore logout errors in cleanup
    console.warn('Error during test session cleanup:', error);
  }
}