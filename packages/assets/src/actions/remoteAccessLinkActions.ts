'use server';

import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import type { AssetRemoteAccessLink } from '@alga-psa/types';
import { hasLiteralHttpAuthority, renderRemoteAccessTemplate } from '../lib/remoteAccessTemplate';

type RemoteAccessLinkInput = Partial<AssetRemoteAccessLink> & {
  label: string;
  url_template: string;
};

async function requireManagePermission(user: Parameters<typeof hasPermission>[0]): Promise<void> {
  if (!await hasPermission(user, 'system_settings', 'update')) {
    throw new Error('Permission denied: Cannot manage asset settings.');
  }
}

export const listRemoteAccessLinks = withAuth(async (user, { tenant }): Promise<AssetRemoteAccessLink[]> => {
  await requireManagePermission(user);
  const { knex } = await createTenantKnex();
  return tenantDb(knex, tenant)
    .table('asset_remote_access_links')
    .select('*')
    .orderBy('label');
});

function validateTemplate(template: string): void {
  if (!hasLiteralHttpAuthority(template)) {
    throw new Error('Template must begin with http:// or https:// and a literal host.');
  }
  const sampleContext = {
    asset: {} as Record<string, unknown>,
    client: {} as Record<string, unknown>,
    field: {} as Record<string, unknown>,
  };
  const tokenPattern = /\{(asset|client|field)\.([a-zA-Z0-9_-]+)\}/g;
  const tokens = [...template.matchAll(tokenPattern)];
  const residue = template.replace(tokenPattern, '');
  if (/[{}]/.test(residue)) {
    throw new Error('Template contains an unsupported placeholder.');
  }
  for (const [, scope, key] of tokens) {
    sampleContext[scope as keyof typeof sampleContext][key] = 'sample-value';
  }
  if (!renderRemoteAccessTemplate(template, sampleContext)) {
    throw new Error('Template must produce a valid http or https URL.');
  }
}

export const saveRemoteAccessLink = withAuth(async (
  user,
  { tenant },
  link: RemoteAccessLinkInput
): Promise<void> => {
  await requireManagePermission(user);
  const label = link.label.trim();
  const urlTemplate = link.url_template.trim();
  if (!label || !urlTemplate) {
    throw new Error('A label and URL template are required.');
  }
  validateTemplate(urlTemplate);

  const { knex } = await createTenantKnex();
  const db = tenantDb(knex, tenant);
  const values = {
    label,
    url_template: urlTemplate,
    updated_at: knex.fn.now(),
  };

  if (link.link_id) {
    await db.table('asset_remote_access_links').where({ link_id: link.link_id }).update(values);
    return;
  }
  await db.table('asset_remote_access_links').insert({ ...values, tenant });
});

export const deleteRemoteAccessLink = withAuth(async (
  user,
  { tenant },
  linkId: string
): Promise<void> => {
  await requireManagePermission(user);
  const { knex } = await createTenantKnex();
  await tenantDb(knex, tenant)
    .table('asset_remote_access_links')
    .where({ link_id: linkId })
    .delete();
});

export interface RenderedRemoteAccessLink {
  label: string;
  url: string;
}

export const getRemoteAccessLinksForAsset = withAuth(async (
  user,
  { tenant },
  assetId: string
): Promise<RenderedRemoteAccessLink[]> => {
  if (!await hasPermission(user, 'asset', 'read')) {
    throw new Error('Permission denied: Cannot read assets.');
  }
  const { knex } = await createTenantKnex();
  const db = tenantDb(knex, tenant);
  const assetQuery = db.table('assets')
    .select(['assets.asset_type', 'assets.name', 'assets.asset_tag', 'assets.serial_number', 'assets.attributes', 'clients.client_name']);
  // pattern tenant-safe-client-join — tenantJoin scopes client rows to the same tenant as the asset.
  db.tenantJoin(assetQuery, 'clients', 'clients.client_id', 'assets.client_id', { type: 'left' });
  const asset = await assetQuery
    .where({ 'assets.asset_id': assetId })
    .first();
  if (!asset) return [];

  const links = await db.table('asset_remote_access_links')
    .orderBy('label');
  const fields = asset.attributes && typeof asset.attributes === 'object' ? asset.attributes : {};
  const rendered = links.map((link): RenderedRemoteAccessLink | null => {
    const url = renderRemoteAccessTemplate(link.url_template, {
      asset: {
        name: asset.name,
        asset_tag: asset.asset_tag,
        serial_number: asset.serial_number,
      },
      client: { name: asset.client_name ?? '' },
      field: fields,
    });
    return url ? { label: link.label, url } : null;
  });
  if (rendered.some((link) => link === null)) {
    throw new Error('One or more remote access links could not be rendered.');
  }
  return rendered.filter((link): link is RenderedRemoteAccessLink => link !== null);
});
