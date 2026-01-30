'use server';

import type { Knex } from 'knex';
import { createTenantKnex } from '@alga-psa/db';
import { StorageService } from './service';
import { StorageServiceError } from './errors';

export interface StorageServiceContext {
  tenantId: string;
  service: StorageService;
  knex: Knex;
}

export async function getStorageServiceForTenant(tenantId: string): Promise<StorageServiceContext> {
  if (!tenantId) {
    throw new StorageServiceError('VALIDATION_FAILED', 'tenantId is required');
  }

  const { knex } = await createTenantKnex(tenantId);
  const service = new StorageService(knex, tenantId);

  return {
    tenantId,
    service,
    knex,
  };
}
