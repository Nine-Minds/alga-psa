'use client';

import React from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { HardDrive } from 'lucide-react';
import { BentoTile, BentoTileEmpty } from '@alga-psa/ui/components/bento';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { getContactAssignedAssets } from '../actions/assetAssignmentActions';

/**
 * FR-C6: the contact page's Assets tile — what this person currently holds.
 * The Shared workspaces list lands with the groups UI (FR-E12).
 *
 * Injected into `ContactBentoLayout` through its `assetsSlot` prop: the clients
 * package cannot depend on the assets package, the same reason the create-ticket
 * href is prebuilt by the page.
 */
export function ContactAssetsSection({ contactId, id = 'contact-assets' }: { contactId: string; id?: string }) {
  const { t } = useTranslation('msp/assets');

  const { data: assigned } = useSWR(
    contactId ? ['contact', contactId, 'assigned-assets'] : null,
    async ([, cid]) => {
      const result = await getContactAssignedAssets(cid);
      return isActionPermissionError(result) ? [] : result;
    }
  );

  const hasAssets = (assigned?.length ?? 0) > 0;

  return (
    <BentoTile
      id={`${id}-tile`}
      title={t('contactAssets.title', { defaultValue: 'Assets' })}
      icon={<HardDrive className="h-4 w-4" />}
    >
      {hasAssets ? (
        <div className="divide-y divide-[rgb(var(--color-border-100))]">
          {(assigned ?? []).map((row) => (
            <Link
              key={row.assignment_id}
              id={`${id}-asset-${row.asset_id}`}
              href={`/msp/assets/${row.asset_id}`}
              className="flex items-center justify-between gap-3 py-2 text-sm hover:underline"
            >
              <span className="truncate font-medium text-[rgb(var(--color-text-800))]">{row.asset_name}</span>
              <span className="flex-shrink-0 text-xs text-[rgb(var(--color-text-500))]">
                {[row.asset_type, row.asset_tag, row.asset_status].filter(Boolean).join(' · ')}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <BentoTileEmpty id={`${id}-empty`}>
          {t('contactAssets.empty', { defaultValue: 'No assets assigned to this contact.' })}
        </BentoTileEmpty>
      )}

    </BentoTile>
  );
}

export default ContactAssetsSection;
