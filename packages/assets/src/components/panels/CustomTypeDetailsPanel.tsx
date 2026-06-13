'use client';

import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@alga-psa/ui/components/Card';
import type { Asset, AssetTypeField } from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { isBuiltinAssetTypeSlug } from '../../lib/assetTypeAttributes';
import { useAssetTypeRegistry } from '../shared/useAssetTypeOptions';

interface CustomTypeDetailsPanelProps {
  asset: Asset;
}

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const HTTP_URL_PATTERN = /^https?:\/\//i;

function hasDisplayValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

function renderFieldValue(field: AssetTypeField, value: unknown, t: TranslateFn): React.ReactNode {
  switch (field.kind) {
    case 'boolean':
      return Boolean(value)
        ? t('customTypeDetailsPanel.values.yes', { defaultValue: 'Yes' })
        : t('customTypeDetailsPanel.values.no', { defaultValue: 'No' });
    case 'date': {
      const raw = String(value);
      // Date-only values parse as local midnight so the displayed day never
      // shifts across timezones.
      const date = DATE_ONLY_PATTERN.test(raw) ? new Date(`${raw}T00:00:00`) : new Date(raw);
      return Number.isFinite(date.getTime()) ? date.toLocaleDateString() : raw;
    }
    case 'url': {
      const href = String(value);
      if (!HTTP_URL_PATTERN.test(href)) {
        return href;
      }
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary-600 hover:text-primary-700 hover:underline break-all"
        >
          {href}
        </a>
      );
    }
    case 'number':
    case 'select':
    case 'text':
    default:
      return String(value);
  }
}

/**
 * F312: read-only schema panel for a custom-type asset. Renders the type's
 * fields_schema rows with the asset's attributes[key] values; built-ins,
 * unregistered slugs, empty schemas, and value-less assets render nothing
 * (data-presence gate, like HuduDocumentationCard).
 */
export const CustomTypeDetailsPanel: React.FC<CustomTypeDetailsPanelProps> = ({ asset }) => {
  const { t } = useTranslation('msp/assets');
  const isCustom = !isBuiltinAssetTypeSlug(asset.asset_type);
  const entries = useAssetTypeRegistry(isCustom);

  if (!isCustom) {
    return null;
  }

  const entry = entries?.find(
    (candidate) => candidate.slug === asset.asset_type && !candidate.is_builtin
  );
  if (!entry || entry.fields_schema.length === 0) {
    return null;
  }

  const attributes: Record<string, unknown> = asset.attributes ?? {};
  const rows = entry.fields_schema
    .map((field) => ({ field, value: attributes[field.key] }))
    .filter(({ value }) => hasDisplayValue(value));

  if (rows.length === 0) {
    return null;
  }

  return (
    <Card id="custom-type-details-card" className="bg-white">
      <CardHeader>
        <CardTitle>
          {t('customTypeDetailsPanel.title', {
            defaultValue: '{{name}} Details',
            name: entry.name,
          })}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          {rows.map(({ field, value }) => (
            <div
              key={field.key}
              id={`custom-type-field-${field.key}`}
              className="flex items-start gap-2 min-h-[24px]"
            >
              <span className="text-sm font-bold text-gray-700 w-32 shrink-0">{field.label}:</span>
              <span className="text-sm text-gray-900 flex-1 break-words">
                {renderFieldValue(field, value, t)}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
