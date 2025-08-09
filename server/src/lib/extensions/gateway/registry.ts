import { createTenantKnex } from 'server/src/lib/db';

export interface TenantInstallInfo {
  version_id: string;
  content_hash: string; // sha256:...
}

export async function getTenantInstall(tenantId: string, extensionId: string): Promise<TenantInstallInfo | null> {
  // Attempts to read from EE registry tables. If tables are absent, returns null gracefully.
  try {
    const { knex } = await createTenantKnex();
    const row = await knex
      .select({ version_id: 'version_id', content_hash: 'content_hash' })
      .from('tenant_extension_install')
      .where({ tenant_id: tenantId, registry_id: extensionId })
      .andWhere({ status: 'active' })
      .first();
    if (!row) return null;
    return { version_id: row.version_id, content_hash: row.content_hash };
  } catch (_e) {
    return null;
  }
}

export async function resolveVersion(install: TenantInstallInfo): Promise<{ content_hash: string; version_id: string }> {
  return { content_hash: install.content_hash, version_id: install.version_id };
}

