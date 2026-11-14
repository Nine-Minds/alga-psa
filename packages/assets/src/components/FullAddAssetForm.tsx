'use client';

import Link from 'next/link';
import AssetForm from './AssetForm';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

/** Full intake composes the same registry, custom-field validation, ownership,
 * assignment, and procurement controls used by the existing asset editor. */
export default function FullAddAssetForm() {
  const { t } = useTranslation('msp/assets');
  return <main className="mx-auto max-w-5xl space-y-4 p-6">
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-semibold">{t('fullIntake.title')}</h1>
        <p className="text-sm text-[rgb(var(--color-text-600))]">{t('fullIntake.description')}</p>
      </div>
      <Link href="/msp/assets" className="text-sm underline">{t('fullIntake.back')}</Link>
    </div>
    <AssetForm createMode />
  </main>;
}
