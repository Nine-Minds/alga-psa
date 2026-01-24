/**
 * Managed Domain Service Registry
 *
 * Registration pattern for ManagedDomainService to avoid circular dependency.
 * The integrations package registers its implementation at startup.
 */

import type { Knex } from 'knex';
import type { DnsLookupResult } from '@alga-psa/types';

export interface ManagedDomainServiceLike {
  createDomain: (options: { domain: string; region?: string }) => Promise<{
    providerDomainId: string;
    status: string;
    dnsRecords: any[];
  }>;
  checkDomainStatus: (identifier: { domain?: string; providerDomainId?: string }) => Promise<{
    provider: any;
    dnsLookup: DnsLookupResult[];
    providerDomainId: string;
  }>;
  activateDomain: (domain: string) => Promise<void>;
  deleteDomain: (domain: string) => Promise<void>;
  startDomainVerification?: (domainId: string) => Promise<any>;
}

export interface ManagedDomainServiceFactory {
  forTenant: (options: { tenantId: string; knex: Knex }) => ManagedDomainServiceLike;
}

let registeredFactory: ManagedDomainServiceFactory | null = null;

/**
 * Register the ManagedDomainService factory (called by integrations package at startup)
 */
export function registerManagedDomainService(factory: ManagedDomainServiceFactory): void {
  registeredFactory = factory;
}

/**
 * Get the registered ManagedDomainService factory
 * Returns null if not registered (CE mode)
 */
export function getManagedDomainServiceFactory(): ManagedDomainServiceFactory | null {
  return registeredFactory;
}

/**
 * Reset the registry (for testing)
 */
export function resetManagedDomainRegistry(): void {
  registeredFactory = null;
}
