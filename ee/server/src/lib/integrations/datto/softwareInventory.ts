import { tenantScopedTable } from './db';

export function normalizeSoftwareName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s.+-]/g, '');
}

export async function findOrCreateSoftwareCatalogEntry(
  knex: any,
  tenant: string,
  input: { name: string; publisher?: string | null }
): Promise<string> {
  const normalizedName = normalizeSoftwareName(input.name);
  const publisher = input.publisher ? String(input.publisher).trim() : null;

  const existing = await tenantScopedTable(knex, 'software_catalog', tenant)
    .where({ normalized_name: normalizedName, publisher })
    .first(['software_id']);
  if (existing?.software_id) return existing.software_id;

  const [row] = await tenantScopedTable(knex, 'software_catalog', tenant)
    .insert({
      tenant,
      name: input.name.trim(),
      normalized_name: normalizedName,
      publisher,
      category: 'application',
      software_type: 'application',
      is_managed: false,
      is_security_relevant: false,
    })
    .returning(['software_id']);

  return row.software_id;
}

export async function syncAssetSoftwareList(
  knex: any,
  tenant: string,
  assetId: string,
  softwareList: Array<{ name: string; version?: string | null; publisher?: string | null; installPath?: string | null }>,
  syncTimestamp: Date = new Date()
): Promise<{ installed: number; uninstalled: number; catalogCreated: number }> {
  const stats = { installed: 0, uninstalled: 0, catalogCreated: 0 };

  const currentSoftware = await tenantScopedTable(knex, 'asset_software', tenant)
    .where({ asset_id: assetId, is_current: true })
    .select('software_id');
  const currentSoftwareIds = new Set<string>(
    currentSoftware.map((s: { software_id: unknown }) => String(s.software_id))
  );

  const seenSoftwareIds = new Set<string>();

  for (const sw of softwareList) {
    if (!sw?.name) continue;

    const softwareId = await findOrCreateSoftwareCatalogEntry(knex, tenant, {
      name: sw.name,
      publisher: sw.publisher || null,
    });

    seenSoftwareIds.add(softwareId);

    const existing = await tenantScopedTable(knex, 'asset_software', tenant)
      .where({ asset_id: assetId, software_id: softwareId })
      .first();

    if (existing) {
      const updateData: Record<string, any> = {
        last_seen_at: syncTimestamp,
        version: sw.version || existing.version,
        install_path: sw.installPath || existing.install_path,
      };

      if (!existing.is_current) {
        updateData.is_current = true;
        updateData.uninstalled_at = null;
        stats.installed += 1;
      }

      await tenantScopedTable(knex, 'asset_software', tenant)
        .where({ asset_id: assetId, software_id: softwareId })
        .update(updateData);
    } else {
      await tenantScopedTable(knex, 'asset_software', tenant).insert({
        tenant,
        asset_id: assetId,
        software_id: softwareId,
        version: sw.version || null,
        install_path: sw.installPath || null,
        first_seen_at: syncTimestamp,
        last_seen_at: syncTimestamp,
        is_current: true,
      });
      stats.installed += 1;
      stats.catalogCreated += 1;
    }
  }

  for (const softwareId of currentSoftwareIds) {
    if (!seenSoftwareIds.has(softwareId)) {
      await tenantScopedTable(knex, 'asset_software', tenant)
        .where({ asset_id: assetId, software_id: softwareId, is_current: true })
        .update({ is_current: false, uninstalled_at: syncTimestamp });
      stats.uninstalled += 1;
    }
  }

  return stats;
}

// Name the Tactical action and the NinjaOne sync already use for this helper.
export const syncAssetSoftwareToNormalizedTables = syncAssetSoftwareList;
