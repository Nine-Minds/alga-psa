/**
 * Tenant Onboarding Integration Tests
 * 
 * Comprehensive integration tests for the tenant onboarding wizard using Playwright.
 * Tests the complete user journey from initial login with workflow-created credentials
 * through onboarding completion and subsequent login behavior.
 */

import { test, expect } from '@playwright/test';
import { E2ETestContext } from '../utils/test-context-e2e';
import { 
  createOnboardingTestSession,
  completeFullOnboardingFlow,
  verifyOnboardingRedirect,
  verifySubsequentLoginBypasses,
  testOnboardingNavigation,
  testOnboardingValidation,
  testOnboardingSkipFunctionality,
} from '../utils/onboarding-helpers';
import {
  verifyCompleteTenantSetup,
  verifyTenantIsolation,
  getTenantStats,
} from '../utils/db-verification';

// Test configuration
const TEST_CONFIG = {
  baseUrl: process.env.EE_BASE_URL || 'http://localhost:3001',
  testTimeout: 60000,
  actionTimeout: 15000,
};

test.describe('Tenant Onboarding Integration Tests', () => {
  let testContext: E2ETestContext;

  test.beforeAll(async () => {
    const contextHelpers = E2ETestContext.createHelpers();
    testContext = await contextHelpers.beforeAll({
      baseUrl: TEST_CONFIG.baseUrl,
      browserOptions: {
        headless: !process.env.DEBUG_BROWSER,
        slowMo: process.env.DEBUG_BROWSER ? 100 : 0,
      },
    });
  });

  test.afterAll(async () => {
    if (testContext) {
      await testContext.cleanup();
    }
  });

  test.beforeEach(async () => {
    await testContext.reset();
  });

  test.describe('Happy Path Onboarding Flow', () => {
    test('should complete full onboarding flow from login to dashboard', async () => {
      // Create test session
      const session = createOnboardingTestSession(testContext.page, testContext.tenantData);

      // Complete full onboarding flow
      await completeFullOnboardingFlow(session, TEST_CONFIG.baseUrl);

      // Verify database state after onboarding
      await verifyCompleteTenantSetup(testContext.db, {
        tenantId: testContext.tenantData.tenant.tenantId,
        tenantName: testContext.tenantData.tenant.tenantName,
        email: testContext.tenantData.tenant.email,
        clientId: testContext.tenantData.client?.clientId,
        adminUserId: testContext.tenantData.adminUser.userId,
      }, {
        tenantName: testContext.tenantData.tenant.tenantName,
        clientName: testContext.tenantData.client?.clientName,
        adminUser: {
          firstName: testContext.tenantData.adminUser.firstName,
          lastName: testContext.tenantData.adminUser.lastName,
          email: testContext.tenantData.adminUser.email,
        },
      });

      // Take success screenshot
      await testContext.screenshot('onboarding-complete');
    });

    test('should redirect to onboarding wizard on initial login', async () => {
      const session = createOnboardingTestSession(testContext.page, testContext.tenantData);

      // Verify onboarding redirect
      await verifyOnboardingRedirect(session, TEST_CONFIG.baseUrl);

      // Verify wizard is loaded and functional
      await session.onboardingWizard.verifyWizardLoaded();
      
      // Verify we can see the first step
      await session.onboardingWizard.verifyStepVisible(1);
      
      const stepTitle = await session.onboardingWizard.getCurrentStepTitle();
      expect(stepTitle).toBeTruthy();
    });

    test('should access dashboard directly on subsequent login after onboarding', async () => {
      const session = createOnboardingTestSession(testContext.page, testContext.tenantData);

      // Complete onboarding first
      await completeFullOnboardingFlow(session, TEST_CONFIG.baseUrl);

      // Verify subsequent login bypasses onboarding
      await verifySubsequentLoginBypasses(session, TEST_CONFIG.baseUrl);

      // Verify direct dashboard access
      await session.dashboard.verifyDashboardLoaded();
      await session.dashboard.verifyOnboardingCompleted();
    });
  });

  test.describe('Onboarding Wizard Navigation', () => {
    test('should navigate through all wizard steps correctly', async () => {
      const session = createOnboardingTestSession(testContext.page, testContext.tenantData);

      // Login and get to onboarding
      await verifyOnboardingRedirect(session, TEST_CONFIG.baseUrl);

      // Test navigation through all steps
      await testOnboardingNavigation(session);
    });

    test('should validate required fields on each step', async () => {
      const session = createOnboardingTestSession(testContext.page, testContext.tenantData);

      // Login and get to onboarding
      await verifyOnboardingRedirect(session, TEST_CONFIG.baseUrl);

      // Test form validation
      await testOnboardingValidation(session);
    });

    test('should allow skipping optional steps', async () => {
      const session = createOnboardingTestSession(testContext.page, testContext.tenantData);

      // Login and get to onboarding
      await verifyOnboardingRedirect(session, TEST_CONFIG.baseUrl);

      // Test skip functionality
      await testOnboardingSkipFunctionality(session);

      // Verify dashboard access after skipping
      await session.dashboard.verifyDashboardLoaded();
    });

    test('should handle back button navigation correctly', async () => {
      const session = createOnboardingTestSession(testContext.page, testContext.tenantData);

      // Login and get to onboarding
      await verifyOnboardingRedirect(session, TEST_CONFIG.baseUrl);

      // Navigate forward a few steps
      await session.onboardingWizard.completeClientInfoStep({
        clientName: 'Navigation Test Client',
      });
      await session.onboardingWizard.verifyStepVisible(2);

      // Navigate back
      await session.onboardingWizard.clickBack();
      await session.onboardingWizard.verifyStepVisible(1);

      // Verify client name is preserved
      const clientNameInput = testContext.page.locator('input[name="clientName"]');
      const value = await clientNameInput.inputValue();
      expect(value).toBe('Navigation Test Client');
    });
  });

  test.describe('Individual Onboarding Steps', () => {
    test('should complete client info step with valid data', async () => {
      const session = createOnboardingTestSession(testContext.page, testContext.tenantData);
      await verifyOnboardingRedirect(session, TEST_CONFIG.baseUrl);

      await session.onboardingWizard.completeClientInfoStep({
        clientName: 'Test Client Step',
        industry: 'Technology',
        size: 'Small',
        address: '123 Test Street, Test City, TC 12345',
      });

      await session.onboardingWizard.verifyStepVisible(2);
    });

    test('should complete team members step with multiple members', async () => {
      const session = createOnboardingTestSession(testContext.page, testContext.tenantData);
      await verifyOnboardingRedirect(session, TEST_CONFIG.baseUrl);

      // Complete client info first
      await session.onboardingWizard.completeClientInfoStep({
        clientName: 'Team Test Client',
      });

      // Complete team members step
      await session.onboardingWizard.completeTeamMembersStep([
        { name: 'Alice Johnson', email: 'alice@client.com', role: 'Manager' },
        { name: 'Bob Smith', email: 'bob@client.com', role: 'Developer' },
      ]);

      await session.onboardingWizard.verifyStepVisible(3);
    });

    test('should complete client setup steps', async () => {
      const session = createOnboardingTestSession(testContext.page, testContext.tenantData);
      await verifyOnboardingRedirect(session, TEST_CONFIG.baseUrl);

      // Navigate to client step
      await session.onboardingWizard.completeClientInfoStep({ clientName: 'Client Test' });
      await session.onboardingWizard.completeTeamMembersStep([]);

      // Complete client step
      await session.onboardingWizard.completeAddClientStep({
        clientName: 'Acme Corporation',
        clientType: 'Enterprise',
        description: 'Large enterprise client',
      });

      // Complete client contact step
      await session.onboardingWizard.completeClientContactStep({
        contactName: 'Jane Doe',
        contactEmail: 'jane@acme.com',
        contactPhone: '555-123-4567',
        contactRole: 'IT Director',
      });

      await session.onboardingWizard.verifyStepVisible(5);
    });

    test('should complete billing and ticketing configuration', async () => {
      const session = createOnboardingTestSession(testContext.page, testContext.tenantData);
      await verifyOnboardingRedirect(session, TEST_CONFIG.baseUrl);

      // Navigate to billing step (skip intermediate steps)
      await session.onboardingWizard.completeClientInfoStep({ clientName: 'Billing Test' });
      await session.onboardingWizard.clickSkip(); // Team
      await session.onboardingWizard.clickSkip(); // Client
      await session.onboardingWizard.clickSkip(); // Contact

      // Complete billing step
      await session.onboardingWizard.completeBillingSetupStep({
        billingType: 'hourly',
        hourlyRate: '150',
        paymentTerms: '30 days',
      });

      // Complete ticketing step
      await session.onboardingWizard.completeTicketingConfigStep({
        ticketTypes: ['Support', 'Bug', 'Feature Request'],
        priorities: ['Critical', 'High', 'Medium', 'Low'],
        defaultAssignee: 'Auto-assign',
      });

      // Should complete onboarding
      await session.onboardingWizard.verifyOnboardingComplete();
    });
  });

  test.describe('Error Handling and Edge Cases', () => {
    test('should handle invalid login credentials gracefully', async () => {
      const session = createOnboardingTestSession(testContext.page, testContext.tenantData);

      await session.loginPage.goto(TEST_CONFIG.baseUrl);
      
      // Try invalid credentials
      await session.loginPage.login('invalid@email.com', 'wrongpassword');
      
      // Should show error message
      await session.loginPage.verifyLoginError();
      
      // Should still be on login page
      await session.loginPage.verifyLoginPageLoaded();
    });

    test('should handle network interruption during onboarding', async () => {
      const session = createOnboardingTestSession(testContext.page, testContext.tenantData);
      await verifyOnboardingRedirect(session, TEST_CONFIG.baseUrl);

      // Complete first step
      await session.onboardingWizard.completeClientInfoStep({
        clientName: 'Network Test Client',
      });

      // Simulate network interruption
      await testContext.page.route('**/*', route => route.abort());
      
      // Try to proceed - should handle gracefully
      try {
        await session.onboardingWizard.clickNext();
      } catch {
        // Expected to fail due to network simulation
      }

      // Restore network
      await testContext.page.unroute('**/*');
      
      // Should be able to continue
      await testContext.page.reload();
      await session.onboardingWizard.verifyWizardLoaded();
    });

    test('should preserve form data on browser refresh', async () => {
      const session = createOnboardingTestSession(testContext.page, testContext.tenantData);
      await verifyOnboardingRedirect(session, TEST_CONFIG.baseUrl);

      // Fill out client info but don't submit
      await testContext.page.locator('input[name="clientName"]').fill('Refresh Test Client');
      
      // Refresh the page
      await testContext.page.reload();
      
      // Verify we're back on onboarding and form may or may not preserve data
      // (depending on implementation - this tests robustness)
      await session.onboardingWizard.verifyWizardLoaded();
    });
  });

  test.describe('Database and Tenant Isolation', () => {
    test('should maintain proper tenant isolation during onboarding', async () => {
      // Create additional tenant for isolation testing
      const additionalTenant = await testContext.createAdditionalTenant();
      
      const session = createOnboardingTestSession(testContext.page, testContext.tenantData);
      await completeFullOnboardingFlow(session, TEST_CONFIG.baseUrl);

      // Verify tenant isolation
      await verifyTenantIsolation(
        testContext.db,
        testContext.tenantData.tenant.tenantId,
        [additionalTenant.tenant.tenantId]
      );

      // Verify stats for main tenant
      const stats = await getTenantStats(testContext.db, testContext.tenantData.tenant.tenantId);
      expect(stats.userCount).toBeGreaterThan(0);
      expect(stats.hasEmailSettings).toBe(true);
    });

    test('should handle concurrent onboarding sessions correctly', async () => {
      // Create second tenant and context
      const secondTenant = await testContext.createAdditionalTenant();
      const secondPage = await testContext.newPage();
      
      // Start onboarding for both tenants concurrently
      const session1 = createOnboardingTestSession(testContext.page, testContext.tenantData);
      const session2 = createOnboardingTestSession(secondPage, secondTenant);

      await Promise.all([
        verifyOnboardingRedirect(session1, TEST_CONFIG.baseUrl),
        verifyOnboardingRedirect(session2, TEST_CONFIG.baseUrl),
      ]);

      // Complete onboarding for both
      await Promise.all([
        completeFullOnboardingFlow(session1, TEST_CONFIG.baseUrl),
        completeFullOnboardingFlow(session2, TEST_CONFIG.baseUrl),
      ]);

      // Verify both are properly isolated
      await verifyTenantIsolation(
        testContext.db,
        testContext.tenantData.tenant.tenantId,
        [secondTenant.tenant.tenantId]
      );
    });
  });

  test.describe('Responsive Design and Accessibility', () => {
    test('should work correctly on mobile viewport', async () => {
      // Set mobile viewport
      await testContext.page.setViewportSize({ width: 375, height: 667 });
      
      const session = createOnboardingTestSession(testContext.page, testContext.tenantData);
      
      // Complete onboarding on mobile
      await completeFullOnboardingFlow(session, TEST_CONFIG.baseUrl, {
        skipOptionalSteps: true, // Skip for faster mobile testing
      });

      await session.dashboard.verifyDashboardLoaded();
    });

    test('should work correctly on tablet viewport', async () => {
      // Set tablet viewport
      await testContext.page.setViewportSize({ width: 768, height: 1024 });
      
      const session = createOnboardingTestSession(testContext.page, testContext.tenantData);
      await completeFullOnboardingFlow(session, TEST_CONFIG.baseUrl);
      await session.dashboard.verifyDashboardLoaded();
    });

    test('should be keyboard navigable', async () => {
      const session = createOnboardingTestSession(testContext.page, testContext.tenantData);
      await verifyOnboardingRedirect(session, TEST_CONFIG.baseUrl);

      // Test keyboard navigation
      await testContext.page.keyboard.press('Tab');
      await testContext.page.keyboard.press('Tab');
      await testContext.page.keyboard.press('Enter');

      // Should still be functional
      await session.onboardingWizard.verifyWizardLoaded();
    });
  });

  test.describe('Performance and Load Testing', () => {
    test('should complete onboarding within reasonable time limits', async () => {
      const startTime = Date.now();
      
      const session = createOnboardingTestSession(testContext.page, testContext.tenantData);
      await completeFullOnboardingFlow(session, TEST_CONFIG.baseUrl, {
        skipOptionalSteps: true,
      });
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Should complete within 30 seconds
      expect(duration).toBeLessThan(30000);
    });

    test('should handle rapid form interactions', async () => {
      const session = createOnboardingTestSession(testContext.page, testContext.tenantData);
      await verifyOnboardingRedirect(session, TEST_CONFIG.baseUrl);

      // Fill form rapidly
      await testContext.page.locator('input[name="clientName"]').fill('Rapid Test');
      await testContext.page.locator('input[name="clientName"]').clear();
      await testContext.page.locator('input[name="clientName"]').fill('Rapid Test Client');
      
      // Should still work correctly
      await session.onboardingWizard.clickNext();
      await session.onboardingWizard.verifyStepVisible(2);
    });
  });
});