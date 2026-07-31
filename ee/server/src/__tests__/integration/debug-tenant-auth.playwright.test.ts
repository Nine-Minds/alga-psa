/**
 * Debug test to check tenant context in authentication
 */

import { test } from '@playwright/test';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../lib/testing/db-test-utils';
import { createTestTenant } from '../../lib/testing/tenant-test-factory';
import { rollbackTenant } from '../../lib/testing/tenant-creation';

const DEBUG_TENANT_DISCOVERY = '__debug_tenant_auth_discovery__';

function tenantTable<Row extends object = Record<string, any>>(db: Knex, tenantId: string, table: string) {
  return tenantDb(db, tenantId).table<Row>(table);
}

function discoveryTable<Row extends object = Record<string, any>>(db: Knex, table: string, reason: string) {
  return tenantDb(db, DEBUG_TENANT_DISCOVERY).unscoped<Row>(table, reason);
}

test('debug tenant context in authentication', async ({ page }) => {
  const db = createTestDbConnection();
  
  try {
    // Create test tenant with admin user
    const tenantData = await createTestTenant(db, {
      clientName: 'Debug Tenant Client',
      adminUser: { 
        firstName: 'Debug', 
        lastName: 'Tenant', 
        email: 'debug.tenant@test.com' 
      }
    });
    
    console.log('Created tenant:', tenantData.tenant.tenantId);
    
    // Check if there are other users with the same email in different tenants
    const allUsersWithEmail = await discoveryTable(db, 'users', 'debug tenant auth searches users across tenants for duplicate login emails')
      .where('email', tenantData.adminUser.email)
      .select('user_id', 'email', 'tenant', 'user_type', 'is_inactive');
    
    console.log('All users with this email:', allUsersWithEmail);
    
    // Check if there are other users with similar email patterns
    const similarEmails = await discoveryTable(db, 'users', 'debug tenant auth searches users across tenants for related debug email fixtures')
      .where('email', 'like', '%debug%')
      .select('user_id', 'email', 'tenant', 'user_type', 'is_inactive');
      
    console.log('Similar debug emails:', similarEmails);
    
    // Check tenant context by looking at tenant table
    const tenantInfo = await tenantTable(db, tenantData.tenant.tenantId, 'tenants')
      .first() as { tenant: string; tenant_name: string; created_at: string } | undefined;
      
    console.log('Tenant info:', tenantInfo);
    
    // Check what the default tenant is in the system
    const allTenants = await discoveryTable(db, 'tenants', 'debug tenant auth lists seeded tenants to inspect default tenant ordering')
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
    const requests: { url: string; method: string; postData: string | null }[] = [];
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
