'use server';

import type { Knex } from 'knex';
import { getConnection } from '@alga-psa/db/connection';
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

  const knex = await getConnection();
  const service = new StorageService(knex, tenantId);

  return {
    tenantId,
    service,
    knex,
  };
}
