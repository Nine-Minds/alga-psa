'use client';

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@alga-psa/ui/components/Card';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  handleError,
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import {
  applyCatalogTaxRateBackfill,
  previewCatalogTaxRateBackfill,
  type CatalogTaxRateBackfillPreview,
} from '../../../actions/taxSettingsActions';

export function CatalogTaxRateBackfill() {
  const { t } = useTranslation('msp/billing-settings');
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<CatalogTaxRateBackfillPreview | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const loadPreview = async () => {
    setIsLoading(true);
    setError(null);
    // Clear any previous preview/selection up front so a failed reload cannot
    // leave stale, hidden selections submittable.
    setPreview(null);
    setExcluded(new Set());
    try {
      const result = await previewCatalogTaxRateBackfill();
      if (isActionPermissionError(result)) {
        handleError(result.permissionError);
        return;
      }
      if (isActionMessageError(result)) {
        setError(getErrorMessage(result));
        return;
      }
      setPreview(result);
      setExcluded(new Set());
    } catch (err) {
      handleError(err, t('tax.backfill.errors.preview', { defaultValue: 'Failed to load the backfill preview.' }));
    } finally {
      setIsLoading(false);
    }
  };

  const open = async () => {
    setIsOpen(true);
    await loadPreview();
  };

  const eligibleIds = preview
    ? preview.items.filter((item) => !excluded.has(item.service_id)).map((item) => item.service_id)
    : [];

  const toggle = (serviceId: string) => {
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(serviceId)) next.delete(serviceId);
      else next.add(serviceId);
      return next;
    });
  };

  const handleApply = async () => {
    if (!preview) return;
    setIsApplying(true);
    setError(null);
    try {
      const result = await applyCatalogTaxRateBackfill(eligibleIds, preview.default_tax_rate_id);
      if (isActionPermissionError(result)) {
        handleError(result.permissionError);
        return;
      }
      if (isActionMessageError(result)) {
        setError(getErrorMessage(result));
        return;
      }
      toast.success(
        t('tax.backfill.toast.applied', {
          defaultValue: 'Applied the default tax rate to {{changed}} item(s); {{skipped}} skipped.',
          changed: result.changed,
          skipped: result.skipped,
        }),
      );
      await loadPreview();
    } catch (err) {
      handleError(err, t('tax.backfill.errors.apply', { defaultValue: 'Failed to apply the default tax rate.' }));
    } finally {
      setIsApplying(false);
    }
  };

  const targetLabel = preview?.default_tax_rate
    ? `${preview.default_tax_rate.description || preview.default_tax_rate.region_code} — ${Number(
        preview.default_tax_rate.tax_percentage,
      ).toFixed(2)}%`
    : '';

  const footer = (
    <div className="flex justify-end gap-2">
      <Button id="cancel-catalog-tax-backfill-button" variant="ghost" onClick={() => setIsOpen(false)}>
        {t('common.actions.cancel', { defaultValue: 'Cancel' })}
      </Button>
      <Button
        id="apply-catalog-tax-backfill-button"
        onClick={handleApply}
        disabled={isApplying || isLoading || Boolean(error) || !preview || eligibleIds.length === 0}
      >
        {isApplying
          ? t('tax.backfill.actions.applying', { defaultValue: 'Applying...' })
          : t('tax.backfill.actions.apply', { defaultValue: 'Apply to selected' })}
      </Button>
    </div>
  );

  return (
    <>
      <Card id="catalog-tax-rate-backfill-card">
        <CardHeader>
          <CardTitle>
            {t('tax.backfill.title', { defaultValue: 'Apply default to existing products and services' })}
          </CardTitle>
          <CardDescription>
            {t('tax.backfill.description', {
              defaultValue:
                'Fill the tax rate on existing products and services that currently have none. This changes future billing taxability and does not rewrite issued invoices.',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button id="preview-catalog-tax-backfill-button" variant="outline" onClick={open}>
            {t('tax.backfill.actions.preview', { defaultValue: 'Preview affected items…' })}
          </Button>
        </CardContent>
      </Card>

      <Dialog
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={t('tax.backfill.dialog.title', { defaultValue: 'Apply default tax rate to existing items' })}
        className="max-w-2xl"
        footer={footer}
      >
        <DialogContent>
          {isLoading ? (
            <div className="p-4 text-center text-muted-foreground">
              {t('tax.backfill.loading', { defaultValue: 'Loading affected items...' })}
            </div>
          ) : error ? (
            <Alert variant="destructive" showIcon>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : preview && preview.items.length === 0 ? (
            <Alert variant="info" showIcon>
              <AlertDescription>
                {t('tax.backfill.empty', {
                  defaultValue: 'No products or services currently have an unset tax rate.',
                })}
              </AlertDescription>
            </Alert>
          ) : preview ? (
            <div className="space-y-4">
              <Alert variant="warning" showIcon>
                <AlertDescription>
                  {t('tax.backfill.warning', {
                    defaultValue:
                      'A NULL tax rate may mean intentionally non-taxable, not just unset. Review the list and clear any item you want to leave alone.',
                  })}
                </AlertDescription>
              </Alert>
              <p className="text-sm">
                {t('tax.backfill.target', {
                  defaultValue: 'Target default: {{rate}}',
                  rate: targetLabel,
                })}
              </p>
              <p className="text-sm text-muted-foreground">
                {t('tax.backfill.count', {
                  defaultValue: '{{selected}} of {{total}} item(s) selected.',
                  selected: eligibleIds.length,
                  total: preview.items.length,
                })}
              </p>
              <div className="max-h-[45vh] overflow-y-auto rounded border border-[rgb(var(--color-border-200))]">
                {preview.items.map((item) => (
                  <label
                    key={item.service_id}
                    className="flex items-center gap-3 border-b border-[rgb(var(--color-border-200))] px-3 py-2 last:border-b-0"
                  >
                    <Checkbox
                      id={`catalog-tax-backfill-${item.service_id}`}
                      checked={!excluded.has(item.service_id)}
                      onChange={() => toggle(item.service_id)}
                    />
                    <span className="text-sm">
                      <span className="font-medium">{item.service_name}</span>
                      <span className="ml-2 text-muted-foreground">({item.item_kind})</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default CatalogTaxRateBackfill;
