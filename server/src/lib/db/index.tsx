'use server'

import { Knex as KnexType } from 'knex';
import knexfile from './knexfile';
import { getTenantForCurrentRequest, getTenantFromHeaders } from '../tenant';
import { getConnection } from './db';
import { headers } from 'next/headers';
import { AsyncLocalStorage } from 'async_hooks';

const tenantContext = new AsyncLocalStorage<string>();

interface TenantConnection {
    knex: KnexType;
    tenant?: string | null;
}

export async function createTenantKnex(): Promise<TenantConnection> {
    const environment = process.env.NODE_ENV === 'test' ? 'development' : (process.env.NODE_ENV || 'development');
    const config = knexfile[environment as keyof typeof knexfile] as KnexType.Config;
    if (!config) {
        throw new Error(`Invalid environment: ${environment}`);
    }

    let tenant: string | null = null;

    // Try to get tenant from context first
    tenant = tenantContext.getStore() || null;

    // If no tenant in context, try session
    if (!tenant) {
        try {
            tenant = await getTenantForCurrentRequest();
        } catch (e) {
            console.warn('Failed to get tenant from session:', e);
        }
    }

    // If still no tenant, try headers
    if (!tenant) {
        try {
            const headersList = headers();
            tenant = getTenantFromHeaders(headersList);
        } catch (e) {
            console.warn('Failed to get tenant from headers:', e);
        }
    }

    // Get database connection
    try {
        const knex = await getConnection(tenant);
        return { knex, tenant };
    } catch (error) {
        console.error('Failed to create database connection:', error);
        throw new Error(`Failed to create database connection: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
