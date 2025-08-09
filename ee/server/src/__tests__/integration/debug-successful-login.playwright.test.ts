/**
 * Debug test for successful login with tenant credentials
 */

import { test, expect } from '@playwright/test';
import { createTestDbConnection } from '../../lib/testing/db-test-utils';
import { createTestTenant } from '../../lib/testing/tenant-test-factory';
import { rollbackTenant } from '../../lib/testing/tenant-creation';

test('debug successful login attempt', async ({ page }) => {
  const db = createTestDbConnection();
  
  try {
    // Create test tenant with admin user
    console.log('Creating test tenant...');
    const tenantData = await createTestTenant(db, {
      companyName: 'Debug Login Company',
      adminUser: { 
        firstName: 'Debug', 
        lastName: 'Admin', 
        email: 'debug.admin@test.com' 
      }
    });
    
    console.log('Test tenant created:', {
      tenantId: tenantData.tenant.tenantId,
      email: tenantData.adminUser.email,
      tempPassword: tenantData.adminUser.temporaryPassword
    });
    
    // Navigate to root path
    await page.goto('/');
    
    // Wait for login form to appear
    await page.waitForSelector('#msp-email-field');
    
    // Fill credentials
    console.log('Filling login credentials...');
    await page.fill('#msp-email-field', tenantData.adminUser.email);
    await page.fill('#msp-password-field', tenantData.adminUser.temporaryPassword);
    
    // Take screenshot before login
    await page.screenshot({ path: 'debug-before-success-login.png', fullPage: true });
    
    // Click login button
    console.log('Clicking login button...');
    await page.click('#msp-sign-in-button');
    
    // Wait a bit for response
    await page.waitForTimeout(5000);
    
    // Take screenshot after login attempt
    await page.screenshot({ path: 'debug-after-success-login.png', fullPage: true });
    
    // Check current URL
    console.log('URL after login attempt:', page.url());
    
    // Check for any visible text on the page
    const pageText = await page.textContent('body');
    console.log('Page text (first 500 chars):', pageText?.substring(0, 500));
    
    // Look for specific error or success indicators
    const hasError = await page.locator('text=error').count() > 0;
    const hasInvalid = await page.locator('text=Invalid').count() > 0;
    const hasDashboard = await page.locator('text=Dashboard').count() > 0;
    
    console.log('Page indicators:', { hasError, hasInvalid, hasDashboard });
    
    // Clean up
    await rollbackTenant(db, tenantData.tenant.tenantId);
    
  } catch (error) {
    console.error('Test failed:', error);
    throw error;
  } finally {
    await db.destroy();
  }
});