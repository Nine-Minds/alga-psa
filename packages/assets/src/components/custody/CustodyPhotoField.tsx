'use client';

import React from 'react';
import { Label } from '@alga-psa/ui/components/Label';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { custodyPhotosWithinLimit } from '../../lib/custody/photoLimits';

export function CustodyPhotoField({ id, photos, onChange }: { id: string; photos: File[]; onChange: (files: File[]) => void }) {
  const { t } = useTranslation('msp/assets');
  return <div>
    <Label htmlFor={id}>{t('custody.receiveEquipment.photos', { defaultValue: 'Photos (optional)' })}</Label>
    <input id={id} type="file" accept="image/*" multiple className="block w-full text-sm" onChange={e => onChange(Array.from(e.target.files ?? []))} />
    <p className="mt-1 text-xs text-[rgb(var(--color-text-400))]">{t('custody.photos.limit', { defaultValue: 'Up to 20 photos, 10 MB total. Photos are hidden from clients.' })}</p>
    {!custodyPhotosWithinLimit(photos) && <p role="alert" className="text-sm text-destructive">{t('custody.photos.tooLarge', { defaultValue: 'Choose at most 20 photos totalling no more than 10 MB.' })}</p>}
  </div>;
}
