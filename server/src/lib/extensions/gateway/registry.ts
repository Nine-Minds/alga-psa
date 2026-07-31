import { getAdminConnection } from '@alga-psa/db/admin';
import { tenantDb } from '@alga-psa/db';

export interface TenantInstallInfo {
  install_id: string;
  version_id: string;
  tenant_id: string;
}

export async function getTenantInstall(tenantId: string, extensionId: string): Promise<TenantInstallInfo | null> {
  // Attempts to read from EE registry tables. If tables are absent, returns null gracefully.
  try {
    const knex = await getAdminConnection();
    const row = await tenantDb(knex, tenantId)
      .table('tenant_extension_install as ti')
      .select({
        install_id: 'ti.id',
        version_id: 'ti.version_id',
        tenant_id: 'ti.tenant_id',
      })
      .where('ti.registry_id', extensionId)
      .andWhere('ti.is_enabled', true)
      .first();
    if (!row) return null;
    return { install_id: row.install_id, version_id: row.version_id, tenant_id: row.tenant_id };
  } catch (_e) {
    return null;
  }
}

export async function resolveVersion(
  install: TenantInstallInfo
): Promise<{ content_hash: string; version_id: string; install_id: string }> {
  // Given a version_id, resolve the active content_hash from extension_bundle.
  try {
    const knex = await getAdminConnection();
    const row = await tenantDb(knex, install.tenant_id)
      .table('extension_bundle as eb')
      .select({ content_hash: 'eb.content_hash' })
      .where('eb.version_id', install.version_id)
      .orderBy('eb.created_at', 'desc')
      .first();
    if (!row) {
      return { install_id: install.install_id, version_id: install.version_id, content_hash: '' };
    }
    return { install_id: install.install_id, version_id: install.version_id, content_hash: row.content_hash };
  } catch (_e) {
    return { install_id: install.install_id, version_id: install.version_id, content_hash: '' };
  }
}
