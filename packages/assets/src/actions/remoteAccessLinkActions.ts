'use server';

import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import type { AssetRemoteAccessLink } from '@alga-psa/types';
import { actionError, permissionError } from '@alga-psa/ui/lib/errorHandling';
import type { AssetActionError } from './assetActionErrors';
import { hasLiteralHttpAuthority, renderRemoteAccessTemplate } from '../lib/remoteAccessTemplate';

type RemoteAccessLinkInput = Partial<AssetRemoteAccessLink> & {
  label: string;
  url_template: string;
};

async function requireManagePermission(user: Parameters<typeof hasPermission>[0]): Promise<AssetActionError | null> {
  if (!await hasPermission(user, 'system_settings', 'update')) {
    return permissionError('Permission denied: Cannot manage asset settings.', 'msp/assets:remoteAccess.errors.managePermission');
  }
  return null;
}

export const listRemoteAccessLinks = withAuth(async (user, { tenant }): Promise<AssetRemoteAccessLink[] | AssetActionError> => {
  const permissionFailure = await requireManagePermission(user);
  if (permissionFailure) return permissionFailure;
  const { knex } = await createTenantKnex();
  return tenantDb(knex, tenant)
    .table('asset_remote_access_links')
    .select('*')
    .orderBy('label');
});

function validateTemplate(template: string): AssetActionError | null {
  if (!hasLiteralHttpAuthority(template)) {
    return actionError('Template must begin with http:// or https:// and a literal host.', 'msp/assets:remoteAccess.links.errors.templateHttp');
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
    return actionError('Template contains an unsupported placeholder.', 'msp/assets:remoteAccess.links.errors.templatePlaceholder');
  }
  for (const [, scope, key] of tokens) {
    sampleContext[scope as keyof typeof sampleContext][key] = 'sample-value';
  }
  if (!renderRemoteAccessTemplate(template, sampleContext)) {
    return actionError('Template must produce a valid http or https URL.', 'msp/assets:remoteAccess.links.errors.templateUrl');
  }
  return null;
}

export const saveRemoteAccessLink = withAuth(async (
  user,
  { tenant },
  link: RemoteAccessLinkInput
): Promise<void | AssetActionError> => {
  const permissionFailure = await requireManagePermission(user);
  if (permissionFailure) return permissionFailure;
  const label = link.label.trim();
  const urlTemplate = link.url_template.trim();
  if (!label || !urlTemplate) {
    return actionError('A label and URL template are required.', 'msp/assets:remoteAccess.links.errors.required');
  }
  const validationFailure = validateTemplate(urlTemplate);
  if (validationFailure) return validationFailure;

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
): Promise<void | AssetActionError> => {
  const permissionFailure = await requireManagePermission(user);
  if (permissionFailure) return permissionFailure;
  const { knex } = await createTenantKnex();
  await tenantDb(knex, tenant)
    .table('asset_remote_access_links')
    .where({ link_id: linkId })
    .delete();
});

export interface RenderedRemoteAccessLink {
  label: string;
  url: string | null;
}

export const hasRemoteAccessLinks = withAuth(async (user, { tenant }): Promise<boolean | AssetActionError> => {
  if (!await hasPermission(user, 'asset', 'read')) {
    return permissionError('Permission denied: Cannot read assets.', 'msp/assets:remoteAccess.errors.readPermission');
  }
  const { knex } = await createTenantKnex();
  const link = await tenantDb(knex, tenant)
    .table('asset_remote_access_links')
    .select('link_id')
    .first();
  return Boolean(link);
});

export const getRemoteAccessLinksForAsset = withAuth(async (
  user,
  { tenant },
  assetId: string
): Promise<RenderedRemoteAccessLink[] | AssetActionError> => {
  if (!await hasPermission(user, 'asset', 'read')) {
    return permissionError('Permission denied: Cannot read assets.', 'msp/assets:remoteAccess.errors.readPermission');
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
  return links.map((link): RenderedRemoteAccessLink => {
    const url = renderRemoteAccessTemplate(link.url_template, {
      asset: {
        name: asset.name,
        asset_tag: asset.asset_tag,
        serial_number: asset.serial_number,
      },
      client: { name: asset.client_name ?? '' },
      field: fields,
    });
    return { label: link.label, url };
  });
});
