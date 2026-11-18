'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Package } from 'lucide-react';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getAssetInventoryProvenance,
  type AssetInventoryProvenance,
} from '../actions/assetInventoryActions';

interface AssetInventoryProvenanceSectionProps {
  assetId: string;
}

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <div className="text-xs font-medium uppercase tracking-wide text-[rgb(var(--color-text-500))]">{label}</div>
    <div className="mt-1 text-sm text-[rgb(var(--color-text-900))]">{children}</div>
  </div>
);

/**
 * Inventory provenance for a managed asset (F025): product/SKU, the serialized
 * unit, its origin sales order, and RMA history — rendered only when the asset
 * carries inventory links (service_id/stock_unit_id), absent otherwise.
 */
export const AssetInventoryProvenanceSection: React.FC<AssetInventoryProvenanceSectionProps> = ({ assetId }) => {
  const { t } = useTranslation('msp/assets');
  const { formatDate } = useFormatters();
  const shortDate = (iso: string | null): string =>
    iso ? formatDate(iso, { dateStyle: 'medium' }) : t('inventoryProvenance.emptyValue');
  const [data, setData] = useState<AssetInventoryProvenance | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAssetInventoryProvenance(assetId)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        if (!cancelled) setData(null); // decoration only — never break the asset screen
      });
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  if (!data) return null;
  const hasLinks = Boolean(data.service_id || data.unit_id || data.rma_history.length > 0);
  if (!hasLinks) return null;

  return (
    <div
      id="asset-inventory-provenance"
      className="mt-6 rounded-lg border border-[rgb(var(--color-border-200))] bg-white p-6"
    >
      <div className="mb-4 flex items-center gap-2">
        <Package className="h-5 w-5 text-[rgb(var(--color-primary-600))]" />
        <h3 className="text-sm font-semibold text-[rgb(var(--color-text-900))]">{t('inventoryProvenance.title')}</h3>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <Field label={t('inventoryProvenance.fields.product.label')}>
          {data.service_name || t('inventoryProvenance.emptyValue')}
          {data.sku ? <span className="ml-2 font-mono text-xs text-[rgb(var(--color-text-500))]">{data.sku}</span> : null}
        </Field>
        <Field label={t('inventoryProvenance.fields.serial.label')}>{data.serial_number || t('inventoryProvenance.emptyValue')}</Field>
        <Field label={t('inventoryProvenance.fields.mac.label')}>{data.mac_address || t('inventoryProvenance.emptyValue')}</Field>
        <Field label={t('inventoryProvenance.fields.originSalesOrder.label')}>
          {data.origin_so_number ? (
            <Link href="/msp/inventory/sales-orders" className="text-primary-600 hover:underline tabular-nums">
              {data.origin_so_number}
            </Link>
          ) : (
            t('inventoryProvenance.emptyValue')
          )}
        </Field>
        <Field label={t('inventoryProvenance.fields.delivered.label')}>{shortDate(data.delivered_at)}</Field>
      </div>

      {data.rma_history.length > 0 && (
        <div className="mt-5">
          <div className="text-xs font-medium uppercase tracking-wide text-[rgb(var(--color-text-500))]">
            {t('inventoryProvenance.rmaHistory.title')}
          </div>
          <ul className="mt-2 space-y-1" id="asset-provenance-rma-history">
            {data.rma_history.map((rma) => (
              <li key={rma.rma_id} className="flex items-center gap-3 text-sm text-[rgb(var(--color-text-700))]">
                <span className="font-medium">{rma.rma_number || t('inventoryProvenance.rmaLabel')}</span>
                <span className="rounded bg-[rgb(var(--color-border-100))] px-1.5 py-0.5 text-xs">
                  {t(`enums.rmaStatus.${rma.status}`, { defaultValue: String(rma.status).replace(/_/g, ' ') })}
                </span>
                <span className="text-xs text-[rgb(var(--color-text-500))]">{shortDate(rma.created_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default AssetInventoryProvenanceSection;
