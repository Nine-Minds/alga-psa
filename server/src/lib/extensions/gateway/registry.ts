import { getAdminConnection } from '@alga-psa/shared/db/admin';

export interface TenantInstallInfo {
  version_id: string;
}

export async function getTenantInstall(tenantId: string, extensionId: string): Promise<TenantInstallInfo | null> {
  // Attempts to read from EE registry tables. If tables are absent, returns null gracefully.
  try {
    const knex = await getAdminConnection();
    const row = await knex
      .select({ version_id: 'ti.version_id' })
      .from({ ti: 'tenant_extension_install' })
      .where({ 'ti.tenant_id': tenantId, 'ti.registry_id': extensionId })
      .andWhere({ 'ti.is_enabled': true })
      .first();
    if (!row) return null;
    return { version_id: row.version_id };
  } catch (_e) {
    return null;
  }
}

export async function resolveVersion(install: TenantInstallInfo): Promise<{ content_hash: string; version_id: string }> {
  // Given a version_id, resolve the active content_hash from extension_bundle.
  try {
    const knex = await getAdminConnection();
    const row = await knex
      .select({ content_hash: 'eb.content_hash' })
      .from({ eb: 'extension_bundle' })
      .where({ 'eb.version_id': install.version_id })
      .orderBy('eb.created_at', 'desc')
      .first();
    if (!row) {
      return { version_id: install.version_id, content_hash: '' };
    }
    return { version_id: install.version_id, content_hash: row.content_hash };
  } catch (_e) {
    return { version_id: install.version_id, content_hash: '' };
  }
}
