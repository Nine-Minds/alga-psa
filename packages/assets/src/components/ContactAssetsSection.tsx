'use client';

import React from 'react';
import useSWR from 'swr';
import { HardDrive } from 'lucide-react';
import { BentoTile, BentoTileEmpty } from '@alga-psa/ui/components/bento';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { getContactAssignedAssets } from '../actions/assetAssignmentActions';
import { getContactSharedWorkspaces } from '../actions/assetGroupActions';
import { AssetDetailDrawerClient } from './AssetDetailDrawerClient';
import { useAssetDetailDrawer } from './shared/useAssetDetailDrawer';
import { useAssetStatusRegistry } from './shared/useAssetStatusOptions';
import { assetStatusLabel } from '../lib/assetStatus';

/**
 * FR-C6 / FR-E12: the contact page's Assets tile — what this person currently
 * holds, plus the shared workspaces they use.
 *
 * Injected into `ContactBentoLayout` through its `assetsSlot` prop: the clients
 * package cannot depend on the assets package, the same reason the create-ticket
 * href is prebuilt by the page.
 */
export function ContactAssetsSection({ contactId, id = 'contact-assets' }: { contactId: string; id?: string }) {
  const { t } = useTranslation('msp/assets');
  // F021: a custom status reads as its registry label here too, not its slug.
  const { statuses: assetStatuses } = useAssetStatusRegistry();
  // The asset opens over the contact, the mirror of the asset page's assignee
  // row: a link would have abandoned the contact being read.
  const { openAsset, drawerProps } = useAssetDetailDrawer();

  const { data: assigned } = useSWR(
    contactId ? ['contact', contactId, 'assigned-assets'] : null,
    async ([, cid]) => {
      const result = await getContactAssignedAssets(cid);
      return isActionPermissionError(result) ? [] : result;
    }
  );

  const { data: workspaces } = useSWR(
    contactId ? ['contact', contactId, 'shared-workspaces'] : null,
    async ([, cid]) => {
      const result = await getContactSharedWorkspaces(cid);
      return Array.isArray(result) ? result : [];
    }
  );

  const hasAssets = (assigned?.length ?? 0) > 0;
  const hasWorkspaces = (workspaces?.length ?? 0) > 0;

  return (
    <BentoTile
      id={`${id}-tile`}
      title={t('contactAssets.title', { defaultValue: 'Assets' })}
      icon={<HardDrive className="h-4 w-4" />}
    >
      {hasAssets ? (
        <div className="divide-y divide-[rgb(var(--color-border-100))]">
          {(assigned ?? []).map((row) => (
            <button
              key={row.assignment_id}
              id={`${id}-asset-${row.asset_id}`}
              type="button"
              onClick={() => openAsset(row.asset_id)}
              className="flex w-full items-center justify-between gap-3 py-2 text-left text-sm hover:underline"
            >
              <span className="truncate font-medium text-[rgb(var(--color-text-800))]">{row.asset_name}</span>
              <span className="flex-shrink-0 text-xs text-[rgb(var(--color-text-500))]">
                {[
                  row.asset_type,
                  row.asset_tag,
                  assetStatusLabel(t, row.asset_status, assetStatuses),
                ].filter(Boolean).join(' · ')}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <BentoTileEmpty id={`${id}-empty`}>
          {t('contactAssets.empty', { defaultValue: 'No assets assigned to this contact.' })}
        </BentoTileEmpty>
      )}

      {/* F077: the shared workspaces this contact uses. */}
      {hasWorkspaces ? (
        <div className="mt-3 border-t border-[rgb(var(--color-border-100))] pt-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-400))]">
            {t('contactAssets.sharedWorkspaces', { defaultValue: 'Shared workspaces' })}
          </div>
          <div className="divide-y divide-[rgb(var(--color-border-100))]">
            {(workspaces ?? []).map((group) => (
              <div
                key={group.group_id}
                id={`${id}-workspace-${group.group_id}`}
                className="flex items-center justify-between gap-3 py-2 text-sm"
              >
                <span className="truncate font-medium text-[rgb(var(--color-text-800))]">{group.name}</span>
                <span className="flex-shrink-0 text-xs text-[rgb(var(--color-text-500))]">
                  {[
                    group.location_name,
                    t('contactAssets.memberCount', {
                      defaultValue_one: '{{count}} asset',
                      defaultValue_other: '{{count}} assets',
                      count: group.member_count ?? 0,
                    }),
                  ].filter(Boolean).join(' · ')}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <AssetDetailDrawerClient {...drawerProps} />
    </BentoTile>
  );
}

export default ContactAssetsSection;
