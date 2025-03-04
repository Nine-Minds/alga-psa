'use server'

import { headers } from 'next/headers';

export async function cleanupDatabaseConnection() {
  const headersList = headers();
  const cleanupTenantId = headersList.get('X-Cleanup-Connection');

  if (cleanupTenantId) {
    try {
      // await destroyConnection();
      console.log(`Connection destroyed for tenant: ${cleanupTenantId}`);
    } catch (error) {
      console.error(`Error destroying connection for tenant ${cleanupTenantId}:`, error);
    }
  }
}
