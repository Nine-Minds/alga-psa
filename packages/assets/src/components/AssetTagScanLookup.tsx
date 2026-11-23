'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@alga-psa/ui/components/Input';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { completeScannedAssetReservation, findAssetByScannedTag } from '../actions/assetNumberingActions';

/** Resume label-first intake from a printed tag. Hardware scanners type the tag and press Enter. */
export function AssetTagScanLookup({ onOpened }: { onOpened?: () => void }) {
  const { t } = useTranslation('msp/assets');
  const router = useRouter();
  const [tag, setTag] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const open = (assetId: string) => { onOpened?.(); router.push(`/msp/assets/${assetId}`); };
  const find = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!tag.trim() || busy) return;
    setBusy(true); setMessage('');
    try {
      const result = await findAssetByScannedTag(tag);
      if (result.kind === 'asset') open(result.asset.asset_id);
      else if (result.kind === 'ambiguous') setMessage(t('scanLookup.ambiguous'));
      else if (result.kind === 'reservation') {
        const asset = await completeScannedAssetReservation(result.reservation.reservation_id);
        open(asset.asset_id);
      }
      else setMessage(t('scanLookup.notFound'));
    } catch {
      setMessage(t('scanLookup.failed'));
    } finally { setBusy(false); }
  };
  return <form onSubmit={(event) => void find(event)} className="space-y-4" aria-label={t('scanLookup.title')}>
    <p className="text-sm text-[rgb(var(--color-text-600))]">{t('scanLookup.help')}</p>
    <Input id="asset-tag-scan-input" label={t('scanLookup.input')} value={tag} onChange={(event) => setTag(event.target.value)} autoComplete="off" autoFocus />
    {message && <p role="status" className="text-sm text-[rgb(var(--color-text-600))]">{message}</p>}
    <div className="flex justify-end">
      <Button id="asset-tag-scan-submit" type="submit" disabled={busy || !tag.trim()}>{busy ? t('scanLookup.loading') : t('scanLookup.find')}</Button>
    </div>
  </form>;
}
