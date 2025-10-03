/**
 * Debug test to see exact login error messages
 */

import { test } from '@playwright/test';
import { createTestDbConnection } from '../../lib/testing/db-test-utils';
import { createTestTenant } from '../../lib/testing/tenant-test-factory';
import { rollbackTenant } from '../../lib/testing/tenant-creation';

test('debug exact login error messages', async ({ page }) => {
  const db = createTestDbConnection();
  
  try {
    // Create test tenant with admin user
    const tenantData = await createTestTenant(db, {
      clientName: 'Debug Error Client',
      adminUser: { 
        firstName: 'Debug', 
        lastName: 'Error', 
        email: 'debug.error@test.com' 
      }
    });
    
    console.log('Created tenant:', tenantData.tenant.tenantId);
    
    // Also check what was actually created in the database
    const dbUser = await db('users')
      .where('email', tenantData.adminUser.email)
      .first() as { 
        user_id: string; 
        email: string; 
        is_active: boolean; 
        is_inactive: boolean;
        tenant: string;
        hashed_password: string;
        user_type: string;
      } | undefined;
    
    console.log('User in database:', {
      user_id: dbUser?.user_id,
      email: dbUser?.email,
      is_active: dbUser?.is_active,
      is_inactive: dbUser?.is_inactive,
      tenant: dbUser?.tenant,
      hashed_password_length: dbUser?.hashed_password?.length,
      hashed_password_starts_with: dbUser?.hashed_password?.substring(0, 20),
      user_type: dbUser?.user_type
    });
    
    // Navigate and login
    await page.goto('/');
    await page.waitForSelector('#msp-email-field');
    
    // Fill credentials and submit
    await page.fill('#msp-email-field', tenantData.adminUser.email);
    await page.fill('#msp-password-field', tenantData.adminUser.temporaryPassword);
    await page.click('#msp-sign-in-button');
    
    // Wait for response
    await page.waitForTimeout(3000);
    
    // Check for any error text more specifically
    const errorSelectors = [
      'text=Invalid email or password',
      'text=Invalid',
      'text=error',
      'text=Error',
      'text=failed',
      'text=wrong',
      '[role="alert"]',
      '.error-message',
      '.alert-error'
    ];
    
    for (const selector of errorSelectors) {
      const elements = await page.locator(selector).all();
      if (elements.length > 0) {
        for (let i = 0; i < elements.length; i++) {
          const text = await elements[i].textContent();
          const isVisible = await elements[i].isVisible();
          console.log(`Error element (${selector}): visible=${isVisible}, text="${text}"`);
        }
      }
    }
    
    // Check URL parameters for any error info
    const url = page.url();
    console.log('Final URL:', url);
    
    if (url.includes('error=')) {
      const urlParams = new URL(url).searchParams;
      console.log('URL error parameter:', urlParams.get('error'));
    }
    
    // Clean up
    await rollbackTenant(db, tenantData.tenant.tenantId);
    
  } catch (error) {
    console.error('Test failed:', error);
    throw error;
  } finally {
    await db.destroy();
  }
});