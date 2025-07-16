'use server'

import { Knex as KnexType } from 'knex';
import { headers } from 'next/headers';
import { getTenantForCurrentRequest, getTenantFromHeaders } from '../tenant.js';
import { getConnection } from './db.js'; // Use the tenant-scoped connection function
import { getKnexConfig } from './knexfile.js';
import { AsyncLocalStorage } from 'async_hooks';

const tenantContext = new AsyncLocalStorage<string>();

// Interface simplified as tenant identification is separate now
interface DbConnection {
    knex: KnexType;
}

/**
 * Retrieves the shared Knex instance.
 * Tenant context must be managed separately, typically using runWithTenant.
 * @deprecated Prefer using runWithTenant which handles context and provides the Knex instance. Direct use might bypass context setting.
 */
// Remove getKnexInstance as it's no longer relevant with tenant-scoped pools
// export async function getKnexInstance(): Promise<DbConnection> { ... }

/**
 * Utility function to get the current tenant ID based on context, session, or headers.
 * This can be used by callers before using runWithTenant if needed.
 */
export async function getCurrentTenantId(): Promise<string | null> {
    let tenant: string | null = null;

    // Try to get tenant from context first
    tenant = tenantContext.getStore() || null;

    // If no tenant in context, try session
    if (!tenant) {
        try {
            tenant = await getTenantForCurrentRequest();
        } catch (e) {
            // console.warn('Failed to get tenant from session:', e); // Reduce noise
        }
    }

    // If still no tenant, try headers
    if (!tenant) {
        try {
            const headersList = await headers();
            tenant = getTenantFromHeaders(headersList);
        } catch (e) {
            // console.warn('Failed to get tenant from headers:', e); // Reduce noise
        }
    }
    return tenant;
}

/**
 * @deprecated Use runWithTenant for proper tenant context management with the shared pool.
 * This function provides backward compatibility for code still expecting the old { knex, tenant } structure.
 * It retrieves the shared Knex instance and identifies the current tenant.
 */
export async function createTenantKnex(): Promise<{ knex: KnexType; tenant: string | null }> {
    try {
        // Get the tenant-specific Knex instance
        const tenant = await getCurrentTenantId();
        const knex = await getConnection(tenant);
        // Tenant ID is already fetched above
        // Add a warning to encourage migration
        return { knex, tenant };
        // Remove the temporary fix attempt from the previous step as it's handled by afterCreate now
    } catch (error) {
        console.error('Failed in compatibility createTenantKnex:', error);
        throw new Error(`Failed in compatibility createTenantKnex: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Runs a function with the given tenant set in the async context
 * All database operations within the callback will use this tenant
 */
export async function runWithTenant<T>(tenant: string, fn: () => Promise<T>): Promise<T> {
    return tenantContext.run(tenant, fn);
}

/**
 * Gets the tenant from the current async context
 */
export async function getTenantContext(): Promise<string | undefined> {
    return tenantContext.getStore();
}
