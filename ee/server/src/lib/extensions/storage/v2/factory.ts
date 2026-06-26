'use server';

import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { getConnection } from '@/lib/db/db';
import { ExtensionStorageServiceV2 } from './service';
import { StorageServiceError } from './errors';

interface InstallRow {
  id: string;
  tenant_id: string;
  is_enabled?: boolean;
  status?: string | null;
}

export interface StorageServiceContext {
  tenantId: string;
  installId: string;
  service: ExtensionStorageServiceV2;
  knex: Knex;
}

export async function getStorageServiceForInstall(installId: string): Promise<StorageServiceContext> {
  if (!installId) {
    throw new StorageServiceError('VALIDATION_FAILED', 'installId is required');
  }

  const knex = await getConnection();
  // Explicit unscoped probe: storage callers only pass installId, so this read
  // discovers the tenant before the tenant facade can be constructed.
  const install = await tenantDb(knex, 'tenant-discovery')
    .unscoped<InstallRow>('tenant_extension_install', 'discover tenant for extension storage install')
    .where({ id: installId })
    .first(['id', 'tenant_id', 'is_enabled', 'status']);

  if (!install) {
    throw new StorageServiceError('NOT_FOUND', 'extension install not found');
  }

  if (install.is_enabled === false || (install.status && install.status !== 'enabled')) {
    throw new StorageServiceError('UNAUTHORIZED', 'extension install is disabled');
  }

  const service = new ExtensionStorageServiceV2(knex, install.tenant_id, install.id);

  return {
    tenantId: install.tenant_id,
    installId: install.id,
    service,
    knex,
  };
}
