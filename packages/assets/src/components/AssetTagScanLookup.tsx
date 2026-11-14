'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@alga-psa/ui/components/Input';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { completeScannedAssetReservation, findAssetByScannedTag } from '../actions/assetNumberingActions';

export function AssetTagScanLookup() {
  const { t } = useTranslation('msp/assets');
  const router = useRouter();
  const [tag, setTag] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const find = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!tag.trim() || busy) return;
    setBusy(true); setMessage('');
    try {
      const result = await findAssetByScannedTag(tag);
      if (result.kind === 'asset') router.push(`/msp/assets/${result.asset.asset_id}`);
      else if (result.kind === 'ambiguous') setMessage(t('scanLookup.ambiguous'));
      else if (result.kind === 'reservation') {
        const asset = await completeScannedAssetReservation(result.reservation.reservation_id);
        router.push(`/msp/assets/${asset.asset_id}`);
      }
      else setMessage(t('scanLookup.notFound'));
    } catch {
      setMessage(t('scanLookup.failed'));
    } finally { setBusy(false); }
  };
  return <form onSubmit={(event) => void find(event)} className="flex flex-wrap items-center gap-2 rounded-md border p-3" aria-label={t('scanLookup.title')}>
    <label htmlFor="asset-tag-scan-input" className="text-sm font-medium">{t('scanLookup.input')}</label>
    <Input id="asset-tag-scan-input" value={tag} onChange={(event) => setTag(event.target.value)} autoComplete="off" className="max-w-sm" />
    <Button id="asset-tag-scan-submit" type="submit" disabled={busy || !tag.trim()}>{busy ? t('scanLookup.loading') : t('scanLookup.find')}</Button>
    {message && <p role="status" className="basis-full text-sm text-[rgb(var(--color-text-600))">{message}</p>}
  </form>;
}
