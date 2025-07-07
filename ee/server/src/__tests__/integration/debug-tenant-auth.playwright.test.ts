/**
 * Debug test to check tenant context in authentication
 */

import { test, expect } from '@playwright/test';
import { createTestDbConnection } from '../../lib/testing/db-test-utils';
import { createTestTenant } from '../../lib/testing/tenant-test-factory';
import { rollbackTenant } from '../../lib/testing/tenant-creation';

test('debug tenant context in authentication', async ({ page }) => {
  const db = createTestDbConnection();
  
  try {
    // Create test tenant with admin user
    const tenantData = await createTestTenant(db, {
      companyName: 'Debug Tenant Company',
      adminUser: { 
        firstName: 'Debug', 
        lastName: 'Tenant', 
        email: 'debug.tenant@test.com' 
      }
    });
    
    console.log('Created tenant:', tenantData.tenant.tenantId);
    
    // Check if there are other users with the same email in different tenants
    const allUsersWithEmail = await db('users')
      .where('email', tenantData.adminUser.email)
      .select('user_id', 'email', 'tenant', 'user_type', 'is_inactive');
    
    console.log('All users with this email:', allUsersWithEmail);
    
    // Check if there are other users with similar email patterns
    const similarEmails = await db('users')
      .where('email', 'like', '%debug%')
      .select('user_id', 'email', 'tenant', 'user_type', 'is_inactive');
      
    console.log('Similar debug emails:', similarEmails);
    
    // Check tenant context by looking at tenant table
    const tenantInfo = await db('tenants')
      .where('tenant', tenantData.tenant.tenantId)
      .first();
      
    console.log('Tenant info:', tenantInfo);
    
    // Check what the default tenant is in the system
    const allTenants = await db('tenants')
      .select('tenant', 'tenant_name', 'created_at')
      .orderBy('created_at', 'asc')
      .limit(5);
      
    console.log('All tenants (first 5):', allTenants);
    
    // Try authentication by checking if we can trace the tenant context issue
    await page.goto('/');
    await page.waitForSelector('#msp-email-field');
    
    // Check if there are any tenant-related elements on the page
    const pageContent = await page.content();
    const tenantMatches = pageContent.match(/tenant[^"]*[a-f0-9-]{36}/gi);
    if (tenantMatches) {
      console.log('Tenant references on page:', tenantMatches);
    }
    
    // Try to login and see if we can get more detailed error info
    await page.fill('#msp-email-field', tenantData.adminUser.email);
    await page.fill('#msp-password-field', tenantData.adminUser.temporaryPassword);
    
    // Listen for network requests to see authentication calls
    const requests: any[] = [];
    page.on('request', request => {
      if (request.url().includes('auth') || request.url().includes('signin')) {
        requests.push({
          url: request.url(),
          method: request.method(),
          postData: request.postData()
        });
      }
    });
    
    await page.click('#msp-sign-in-button');
    await page.waitForTimeout(3000);
    
    console.log('Authentication requests:', requests);
    
    // Clean up
    await rollbackTenant(db, tenantData.tenant.tenantId);
    
  } catch (error) {
    console.error('Test failed:', error);
    throw error;
  } finally {
    await db.destroy();
  }
});