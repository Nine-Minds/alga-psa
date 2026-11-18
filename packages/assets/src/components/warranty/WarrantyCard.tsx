'use client';

import React from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { recordPath } from '@alga-psa/types';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { BentoLabelValue, BentoTile, BentoTileEmpty } from '@alga-psa/ui/components/bento';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getCurrentDateInUserTimeZone } from '@alga-psa/core';
import { getAssetWarrantySummary } from '../../actions/assetWarrantyActions';
import { canStartWarrantyClaim, classifyWarrantyEnd, humanizeRmaStatus } from './warrantyDisplay';

/**
 * Asset detail "Warranty" card (C5): warranty end, vendor, ownership, claim history, and the entry points
 * to the RMA page. Renders nothing when the summary is unavailable (no permission or unreadable asset).
 */
export function WarrantyCard({ id, assetId }: { id: string; assetId: string }) {
  const { t } = useTranslation('msp/assets');
  const { formatDate } = useFormatters();
  const { data } = useSWR(['asset', assetId, 'warranty'], async ([, aid]) => {
    try {
      return (await getAssetWarrantySummary(aid as string)) ?? null;
    } catch {
      return null; // decoration only: never break the asset screen
    }
  });
  if (!data) return null;

  const status = (s: string) => t(`enums.rmaStatus.${s}`, { defaultValue: humanizeRmaStatus(s) });
  const expiry = classifyWarrantyEnd(data.warranty_end_date, getCurrentDateInUserTimeZone());
  const canStart = canStartWarrantyClaim(data);
  const open = data.open_claim;
  const endLabel = data.warranty_end_date
    ? formatDate(`${data.warranty_end_date}T12:00:00`, { dateStyle: 'medium' })
    : undefined;

  return (
    <BentoTile
      id={id}
      title={t('warranty.card.title', { defaultValue: 'Warranty' })}
      icon={<ShieldCheck className="h-4 w-4" />}
    >
      <div className="space-y-1.5 text-sm">
        <BentoLabelValue
          label={t('warranty.card.warrantyEnd', { defaultValue: 'Warranty ends' })}
          value={
            endLabel ? (
              <span className="inline-flex items-center gap-2">
                <span>{endLabel}</span>
                {expiry === 'expired' && (
                  <Badge id={`${id}-expiry-badge`} variant="error" size="sm">
                    {t('warranty.card.expired', { defaultValue: 'Expired' })}
                  </Badge>
                )}
                {expiry === 'expiring' && (
                  <Badge id={`${id}-expiry-badge`} variant="warning" size="sm">
                    {t('warranty.card.expiringSoon', { defaultValue: 'Expiring soon' })}
                  </Badge>
                )}
              </span>
            ) : undefined
          }
        />
        <BentoLabelValue label={t('warranty.card.vendor', { defaultValue: 'Vendor' })} value={data.vendor_name ?? undefined} />
        <BentoLabelValue
          label={t('warranty.card.ownership', { defaultValue: 'Ownership' })}
          value={
            data.ownership === 'msp'
              ? t('warranty.card.ownershipMsp', { defaultValue: 'MSP-owned' })
              : t('warranty.card.ownershipClient', { defaultValue: 'Client-owned' })
          }
        />
      </div>

      <div className="mt-3 border-t border-[rgb(var(--color-border-100))] pt-3">
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-[rgb(var(--color-text-500))]">
          {t('warranty.card.claims', { defaultValue: 'Warranty claims' })}
        </div>
        {data.claims.length === 0 ? (
          <BentoTileEmpty id={`${id}-no-claims`}>
            {t('warranty.card.noClaims', { defaultValue: 'No warranty claims yet.' })}
          </BentoTileEmpty>
        ) : (
          <ul id={`${id}-claims`} className="space-y-1">
            {data.claims.map((claim) => (
              <li key={claim.rma_id} id={`${id}-claim-${claim.rma_id}`} className="flex items-center gap-2 text-sm">
                <Link
                  id={`${id}-claim-link-${claim.rma_id}`}
                  href={recordPath('rma', claim.rma_id)}
                  className="font-medium text-[rgb(var(--color-primary-600))] hover:underline"
                >
                  {claim.rma_number}
                </Link>
                <Badge variant={claim.status === 'closed' ? 'default-muted' : 'info'} size="sm">
                  {status(claim.status)}
                </Badge>
                <span className="ml-auto flex-shrink-0 whitespace-nowrap text-xs text-[rgb(var(--color-text-400))]">
                  {formatDate(claim.opened_at, { dateStyle: 'medium' })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {(open || canStart) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {open && (
            <Button asChild id={`${id}-open-rma`} variant="outline" size="sm">
              <Link href={recordPath('rma', open.rma_id)}>{t('warranty.card.openRma', { defaultValue: 'Open RMA' })}</Link>
            </Button>
          )}
          {canStart && (
            <Button asChild id={`${id}-start-claim`} variant="default" size="sm">
              <Link href={`/msp/inventory/rma?assetId=${encodeURIComponent(assetId)}`}>
                {t('warranty.card.startClaim', { defaultValue: 'Start warranty claim' })}
              </Link>
            </Button>
          )}
        </div>
      )}
    </BentoTile>
  );
}
