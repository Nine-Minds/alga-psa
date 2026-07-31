'use client';

import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@alga-psa/ui/components/Card';
import type { Asset } from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface HuduDocumentationCardProps {
  asset: Asset;
}

interface HuduFieldEntry {
  label: string;
  value: unknown;
}

/**
 * Read-only "Hudu Documentation" card for the asset detail overview.
 *
 * Renders the label/value pairs the Hudu integration copied into
 * `asset.attributes.hudu_fields` (position order preserved at write time).
 * Pure data-presence gate: the data only exists if the EE integration wrote
 * it, so there is no flag check and no EE import — missing/empty fields
 * render nothing.
 */
export const HuduDocumentationCard: React.FC<HuduDocumentationCardProps> = ({ asset }) => {
  const { t } = useTranslation('msp/assets');

  const attributes = asset.attributes;
  const rawFields = attributes?.hudu_fields;
  const fields: HuduFieldEntry[] = Array.isArray(rawFields)
    ? rawFields.filter((field): field is HuduFieldEntry => typeof (field as HuduFieldEntry)?.label === 'string')
    : [];

  if (fields.length === 0) {
    return null;
  }

  const syncedAt = typeof attributes?.hudu_synced_at === 'string' ? attributes.hudu_synced_at : null;

  return (
    <Card id="hudu-doc-card" className="bg-white">
      <CardHeader>
        <CardTitle>{t('huduDocumentationCard.title', { defaultValue: 'Hudu Documentation' })}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          {fields.map((field, idx) => (
            <div key={`${field.label}-${idx}`} id={`hudu-doc-field-${idx}`} className="flex items-start gap-2 min-h-[24px]">
              <span className="text-sm font-bold text-gray-700 w-32 shrink-0">{field.label}:</span>
              <span className="text-sm text-gray-900 flex-1 whitespace-pre-wrap break-words">
                {field.value === null || field.value === undefined || field.value === ''
                  ? t('common.states.na', { defaultValue: 'N/A' })
                  : String(field.value)}
              </span>
            </div>
          ))}
        </div>
        {syncedAt && (
          <p className="text-xs text-gray-400 mt-3">
            {t('huduDocumentationCard.syncedAt', {
              defaultValue: 'Last synced from Hudu: {{value}}',
              value: new Date(syncedAt).toLocaleString(),
            })}
          </p>
        )}
      </CardContent>
    </Card>
  );
};
