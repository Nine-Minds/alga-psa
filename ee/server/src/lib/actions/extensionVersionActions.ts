'use server'

import { createTenantKnex } from '@/lib/db'
import { withAuth, hasPermission } from '@alga-psa/auth'

export interface ExtensionVersionListItem {
  versionId: string
  version: string
  publishedAt: Date
  contentHash: string | null
  installed: boolean
}

/**
 * Fetch all published versions for a registry extension in the current tenant context.
 * Rows are returned newest-first and include an installed marker for the tenant's current install.
 */
export const fetchExtensionVersions = withAuth(async (user, { tenant }, extensionId: string): Promise<ExtensionVersionListItem[]> => {
  const { knex } = await createTenantKnex()

  if (user.user_type === 'client') throw new Error('Insufficient permissions')
  const allowed = await hasPermission(user, 'extension', 'read', knex)
  if (!allowed) throw new Error('Insufficient permissions')

  const versions = await knex('extension_version')
    .where({ registry_id: extensionId })
    .select(['id', 'version', 'created_at'])
    .orderBy([{ column: 'created_at', order: 'desc' }, { column: 'id', order: 'desc' }])

  if (versions.length === 0) {
    return []
  }

  const versionIds = versions.map((row: any) => String(row.id))
  const bundles = await knex('extension_bundle')
    .whereIn('version_id', versionIds)
    .select(['version_id', 'content_hash', 'created_at'])
    .orderBy([
      { column: 'version_id', order: 'asc' },
      { column: 'created_at', order: 'desc' },
      { column: 'content_hash', order: 'desc' },
    ])

  const latestBundleByVersion = new Map<string, string>()
  for (const row of bundles as Array<{ version_id: string; content_hash: string }>) {
    const versionId = String(row.version_id)
    if (!latestBundleByVersion.has(versionId)) {
      latestBundleByVersion.set(versionId, String(row.content_hash))
    }
  }

  const install = await knex('tenant_extension_install')
    .where({ tenant_id: tenant, registry_id: extensionId })
    .first(['version_id'])
  const installedVersionId = install?.version_id ? String(install.version_id) : null

  return versions.map((row: any) => {
    const versionId = String(row.id)
    const publishedAt = row.created_at instanceof Date ? row.created_at : new Date(row.created_at ?? Date.now())
    return {
      versionId,
      version: String(row.version),
      publishedAt,
      contentHash: latestBundleByVersion.get(versionId) ?? null,
      installed: installedVersionId === versionId,
    }
  })
})
