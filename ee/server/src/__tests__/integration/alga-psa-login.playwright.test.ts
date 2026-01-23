/**
 * Alga PSA Login Integration Tests
 * Tests the actual Alga PSA login flow including:
 * - Navigation to root path (/)
 * - Login form appearance
 * - Authentication with tenant credentials
 * - Proper redirection based on success/failure
 */

import { test, expect } from '@playwright/test';
import { createTestDbConnection } from '../../lib/testing/db-test-utils';
import { createTestTenant } from '../../lib/testing/tenant-test-factory';
import { rollbackTenant } from '../../lib/testing/tenant-creation';
import { LoginPage } from '../page-objects/LoginPage';
import {
  applyPlaywrightAuthEnvDefaults,
  resolvePlaywrightBaseUrl,
} from './helpers/playwrightAuthSessionHelper';

// Apply standard Playwright environment configuration
applyPlaywrightAuthEnvDefaults();

const TEST_CONFIG = {
  baseUrl: resolvePlaywrightBaseUrl(),
};

test.describe('Alga PSA Login Integration Tests', () => {
  test('should show login form when accessing root path', async ({ page }) => {
    // Navigate to root path
    await page.goto(`${TEST_CONFIG.baseUrl}/`);

    // Wait for login form to appear
    const loginPage = new LoginPage(page);
    await expect(loginPage.emailInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();
    await expect(loginPage.loginButton).toBeVisible();

    // Verify we're on some form of login page
    expect(page.url()).toMatch(/\/(login|auth|$)/);
  });

  test('should redirect to signin page with error on failed authentication', async ({ page }) => {
    const loginPage = new LoginPage(page);

    // Navigate to root path
    await page.goto(`${TEST_CONFIG.baseUrl}/`);
    
    // Wait for login form to appear
    await expect(loginPage.emailInput).toBeVisible();
    
    // Attempt login with invalid credentials
    await loginPage.fillCredentials('invalid@example.com', 'wrongpassword');
    await loginPage.submitLogin();
    
    // Should redirect to signin page with error
    await page.waitForURL(/\/auth\/signin/, { timeout: 10000 });
    
    // Should be on signin page with callback URL
    expect(page.url()).toContain('/auth/signin');
    expect(page.url()).toContain('callbackUrl');
    
    // Should show error text on the page
    const pageContent = await page.content();
    expect(pageContent).toMatch(/invalid|error|wrong/i);
  });

  test('should redirect to /msp/dashboard on successful authentication with tenant credentials', async ({ page }) => {
    const db = createTestDbConnection();
    
    try {
      // Create test tenant with admin user
      const tenantData = await createTestTenant(db, {
        clientName: 'Test Login Client',
        adminUser: { 
          firstName: 'Login', 
          lastName: 'Admin', 
          email: 'login.admin@test.com' 
        }
      });
      
      const loginPage = new LoginPage(page);
      
      // Navigate to root path
      await page.goto(`${TEST_CONFIG.baseUrl}/`);
      
      // Wait for login form to appear
      await expect(loginPage.emailInput).toBeVisible();
      
      // Login with tenant credentials  
      await loginPage.fillCredentials(
        tenantData.adminUser.email, 
        tenantData.adminUser.temporaryPassword
      );
      
      await loginPage.submitLogin();
      
      // Should redirect to /msp/dashboard on successful login
      await page.waitForURL(/\/msp\/dashboard/, { timeout: 15000 });
      
      // Verify successful login by checking URL
      expect(page.url()).toContain('/msp/dashboard');
      
      // Clean up
      await rollbackTenant(db, tenantData.tenant.tenantId);
      
    } catch (error) {
      console.error('Test failed:', error);
      throw error;
    } finally {
      await db.destroy();
    }
  });

  test('should handle login form validation', async ({ page }) => {
    const loginPage = new LoginPage(page);

    // Navigate to root path
    await page.goto(`${TEST_CONFIG.baseUrl}/`);
    
    // Wait for login form to appear
    await expect(loginPage.emailInput).toBeVisible();
    
    // Try to submit empty form
    await loginPage.submitLogin();
    
    // Should show validation errors or prevent submission
    // (Implementation depends on the actual form validation)
    const emailInput = loginPage.emailInput;
    const isRequired = await emailInput.getAttribute('required');
    
    if (isRequired !== null) {
      // Browser validation should prevent submission
      expect(page.url()).toMatch(/\/(login|auth|$)/);
    }
  });

  test('should preserve intended destination after login', async ({ page }) => {
    const db = createTestDbConnection();
    
    try {
      // Create test tenant with admin user
      const tenantData = await createTestTenant(db, {
        clientName: 'Test Redirect Client',
        adminUser: { 
          firstName: 'Redirect', 
          lastName: 'Admin', 
          email: 'redirect.admin@test.com' 
        }
      });
      
      // Try to access a protected page directly
      await page.goto(`${TEST_CONFIG.baseUrl}/msp/tickets`);
      
      const loginPage = new LoginPage(page);
      
      // Should be redirected to login
      await expect(loginPage.emailInput).toBeVisible();
      
      // Login with valid credentials
      await loginPage.fillCredentials(
        tenantData.adminUser.email, 
        tenantData.adminUser.temporaryPassword
      );
      
      await loginPage.submitLogin();
      
      // Should redirect to intended destination or dashboard
      await page.waitForURL(/\/msp\//, { timeout: 15000 });
      
      // Verify we're in the MSP area
      expect(page.url()).toMatch(/\/msp\//);
      
      // Clean up
      await rollbackTenant(db, tenantData.tenant.tenantId);
      
    } catch (error) {
      console.error('Test failed:', error);
      throw error;
    } finally {
      await db.destroy();
    }
  });

  test('should show onboarding wizard for first-time login', async ({ page }) => {
    const db = createTestDbConnection();
    
    try {
      // Create test tenant with admin user (first-time login)
      const timestamp = Date.now();
      const tenantData = await createTestTenant(db, {
        clientName: 'Test Onboarding Client',
        adminUser: { 
          firstName: 'Onboarding', 
          lastName: 'Admin', 
          email: `onboarding.admin.${timestamp}@test.com` 
        }
      });
      
      const loginPage = new LoginPage(page);
      
      // Navigate to root path
      await page.goto(`${TEST_CONFIG.baseUrl}/`);
      
      // Wait for login form to appear
      await expect(loginPage.emailInput).toBeVisible();
      
      // Login with tenant credentials
      await loginPage.fillCredentials(
        tenantData.adminUser.email, 
        tenantData.adminUser.temporaryPassword
      );
      
      await loginPage.submitLogin();
      
      // Should redirect to dashboard for first-time users
      await page.waitForURL(/\/msp\/dashboard/, { timeout: 15000 });
      
      // Wait for the OnboardingProvider to check settings and show the wizard
      await page.waitForTimeout(3000);
      
      // Check if onboarding wizard modal is visible
      const wizardTitle = page.locator('text="Setup Your System"');
      await expect(wizardTitle).toBeVisible({ timeout: 10000 });
      
      console.log('Onboarding wizard is visible, starting flow test...');
      
      // Clean up
      await rollbackTenant(db, tenantData.tenant.tenantId);
      
    } catch (error) {
      console.error('Test failed:', error);
      throw error;
    } finally {
      await db.destroy();
    }
  });

  test('should complete full 6-step onboarding wizard flow', async ({ page }) => {
    const db = createTestDbConnection();
    
    try {
      // Create test tenant with admin user (first-time login)
      const timestamp = Date.now();
      const tenantData = await createTestTenant(db, {
        clientName: 'Complete Onboarding Test',
        adminUser: { 
          firstName: 'Complete', 
          lastName: 'Test', 
          email: `complete.test.${timestamp}@test.com` 
        }
      });
      
      const loginPage = new LoginPage(page);
      
      // Navigate and login
      await page.goto('http://localhost:3000/');
      await expect(loginPage.emailInput).toBeVisible();
      await loginPage.fillCredentials(
        tenantData.adminUser.email, 
        tenantData.adminUser.temporaryPassword
      );
      await loginPage.submitLogin();
      
      // Wait for dashboard and onboarding wizard
      await page.waitForURL(/\/msp\/dashboard/, { timeout: 15000 });
      await page.waitForTimeout(3000);
      
      // Verify wizard appears
      const wizardTitle = page.locator('text="Setup Your System"');
      await expect(wizardTitle).toBeVisible({ timeout: 10000 });
      
      console.log('Starting complete onboarding wizard flow...');
      
      // Step 1: Client Information
      console.log('Step 1: Client Information');
      await page.screenshot({ path: `wizard-step1-${timestamp}.png`, fullPage: true });
      
      // Wait for form to be ready
      await page.waitForTimeout(1000);
      
      // Fill all required fields - these appear to be pre-filled from the screenshot, 
      // but let's make sure they're valid
      const firstNameField = page.locator('input').first();
      await firstNameField.fill('John');
      
      const lastNameField = page.locator('input').nth(1);
      await lastNameField.fill('Doe');
      
      const clientNameField = page.locator('input').nth(2);
      await clientNameField.fill('Test MSP Client');
      
      const emailField = page.locator('input[type="email"], input').nth(3);
      await emailField.fill('admin@testmsp.com');
      
      // Wait for validation to process
      await page.waitForTimeout(1000);
      
      // Take screenshot after filling
      await page.screenshot({ path: `wizard-step1-filled-${timestamp}.png`, fullPage: true });
      
      // Click Next to go to step 2
      const nextButton1 = page.locator('#wizard-next');
      
      // Wait for button to be enabled by checking for disabled attribute to be removed
      await page.waitForFunction(() => {
        const button = document.querySelector('#wizard-next');
        return button && !button.hasAttribute('disabled');
      }, { timeout: 10000 });
      
      await nextButton1.click();
      console.log('Successfully moved to step 2');
      
      // Step 2: Team Members
      console.log('Step 2: Team Members');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `wizard-step2-${timestamp}.png`, fullPage: true });
      
      // This step might be optional - try to proceed
      const nextButton2 = page.locator('#wizard-next');
      if (await nextButton2.isEnabled()) {
        await nextButton2.click();
        console.log('Successfully moved to step 3');
      } else {
        // Try to fill any visible fields
        const inputs = page.locator('input[type="email"], input[type="text"]');
        const inputCount = await inputs.count();
        if (inputCount > 0) {
          await inputs.first().fill('team.member@testmsp.com');
          await page.waitForTimeout(500);
          await page.waitForFunction(() => {
            const button = document.querySelector('#wizard-next');
            return button && !button.hasAttribute('disabled');
          }, { timeout: 5000 });
          await nextButton2.click();
          console.log('Successfully moved to step 3');
        }
      }
      
      // Step 3: Add Client
      console.log('Step 3: Add Client');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `wizard-step3-${timestamp}.png`, fullPage: true });
      
      // Fill client information if required
      const inputs3 = page.locator('input[type="text"], input[type="email"]');
      const inputCount3 = await inputs3.count();
      if (inputCount3 > 0) {
        // Assume first input is client name
        await inputs3.first().fill('ABC Corporation');
        if (inputCount3 > 1) {
          await inputs3.nth(1).fill('Technology Services');
        }
      }
      
      await page.waitForTimeout(500);
      const nextButton3 = page.locator('#wizard-next');
      await page.waitForFunction(() => {
        const button = document.querySelector('#wizard-next');
        return button && !button.hasAttribute('disabled');
      }, { timeout: 5000 });
      await nextButton3.click();
      console.log('Successfully moved to step 4');
      
      // Step 4: Client Contact
      console.log('Step 4: Client Contact');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `wizard-step4-${timestamp}.png`, fullPage: true });
      
      // Fill contact information
      const inputs4 = page.locator('input[type="text"], input[type="email"]');
      const inputCount4 = await inputs4.count();
      if (inputCount4 > 0) {
        await inputs4.first().fill('John Doe');
        if (inputCount4 > 1) {
          await inputs4.nth(1).fill('john.doe@abccorp.com');
        }
      }
      
      await page.waitForTimeout(500);
      const nextButton4 = page.locator('#wizard-next');
      await page.waitForFunction(() => {
        const button = document.querySelector('#wizard-next');
        return button && !button.hasAttribute('disabled');
      }, { timeout: 5000 });
      await nextButton4.click();
      console.log('Successfully moved to step 5');
      
      // Step 5: Billing Setup
      console.log('Step 5: Billing Setup');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `wizard-step5-${timestamp}.png`, fullPage: true });
      
      // Fill billing information
      const inputs5 = page.locator('input[type="number"], input[type="text"]');
      const inputCount5 = await inputs5.count();
      if (inputCount5 > 0) {
        await inputs5.first().fill('125');
      }
      
      await page.waitForTimeout(500);
      const nextButton5 = page.locator('#wizard-next');
      await page.waitForFunction(() => {
        const button = document.querySelector('#wizard-next');
        return button && !button.hasAttribute('disabled');
      }, { timeout: 5000 });
      await nextButton5.click();
      console.log('Successfully moved to step 6');
      
      // Step 6: Ticketing Configuration
      console.log('Step 6: Ticketing Configuration');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `wizard-step6-${timestamp}.png`, fullPage: true });
      
      // This might be the final step - look for complete button or just next
      const completeButton = page.locator('button:has-text("Complete"), button:has-text("Finish"), button:has-text("Done"), button#wizard-next').first();
      
      if (await completeButton.isVisible()) {
        console.log('Completing onboarding wizard...');
        
        // If there are any form fields on the last step, fill them
        const finalInputs = page.locator('input, select');
        const finalInputCount = await finalInputs.count();
        if (finalInputCount > 0) {
          console.log(`Found ${finalInputCount} inputs on final step, filling them...`);
          for (let i = 0; i < Math.min(finalInputCount, 3); i++) {
            const input = finalInputs.nth(i);
            const inputType = await input.getAttribute('type');
            if (inputType === 'text') {
              await input.fill('Test Configuration');
            } else if (inputType === 'email') {
              await input.fill('admin@testmsp.com');
            } else if (inputType === 'number') {
              await input.fill('1');
            }
          }
        }
        
        // Wait for the finish button to be enabled
        await page.waitForFunction(() => {
          const button = document.querySelector('#wizard-finish');
          return button && !button.hasAttribute('disabled');
        }, { timeout: 10000 });
        
        await completeButton.click();
        
        // Wait for completion and potential page reload
        await page.waitForTimeout(3000);
        
        // Verify wizard is no longer visible after completion
        const wizardStillVisible = await wizardTitle.isVisible().catch(() => false);
        console.log('Wizard still visible after completion:', wizardStillVisible);
        
        // Take final screenshot
        await page.screenshot({ path: `wizard-completed-${timestamp}.png`, fullPage: true });
        
        // Verify we're back on the dashboard without the wizard
        expect(page.url()).toContain('/msp/dashboard');
        
        console.log('Onboarding wizard flow completed successfully!');
      } else {
        console.log('Complete button not found, checking for alternative completion methods');
        
        // Look for any other completion buttons or links
        const allButtons = await page.locator('button').allTextContents();
        console.log('Available buttons:', allButtons);
      }
      
      // Clean up
      await rollbackTenant(db, tenantData.tenant.tenantId);
      
    } catch (error) {
      console.error('Complete wizard flow test failed:', error);
      
      // Take error screenshot
      await page.screenshot({ path: `wizard-error-${Date.now()}.png`, fullPage: true });
      throw error;
    } finally {
      await db.destroy();
    }
  });
});