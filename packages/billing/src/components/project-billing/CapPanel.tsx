'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { toast } from 'react-hot-toast';
import { currencyFractionDigits, toMinorUnits } from '@alga-psa/core';
import type { IProjectBillingConfig } from '@alga-psa/types';
import { updateProjectBillingConfig } from '../../actions/projectBillingConfigActions';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

interface CapPanelProps {
  config: IProjectBillingConfig;
  canManage: boolean;
  onChanged: () => void;
}

function centsToMajor(cents: number | null, currency: string | null): string {
  if (cents == null) return '';
  const digits = currencyFractionDigits(currency ?? 'USD');
  return (cents / Math.pow(10, digits)).toString();
}

/**
 * F122 — T&M hard budget cap: cap amount and notification thresholds. Config
 * edits go through updateProjectBillingConfig, whose
 * server-side validation (F127) surfaces here as an error toast.
 */
export default function CapPanel({ config, canManage, onChanged }: CapPanelProps) {
  const { t, i18n } = useTranslation(['features/projects', 'common']);
  const currency = config.currency;
  const [capText, setCapText] = useState(centsToMajor(config.cap_amount, currency));
  const [thresholdsText, setThresholdsText] = useState((config.cap_notify_thresholds ?? []).join(', '));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const hasCap = capText.trim() !== '';
    let capAmount: number | null = null;
    if (hasCap) {
      const major = Number(capText);
      if (!Number.isFinite(major) || major <= 0) {
        toast.error(t('billing.cap.errorAmount', 'Enter a cap greater than zero'));
        return;
      }
      capAmount = toMinorUnits(major, i18n.language, currency ?? 'USD');
    }
    const thresholds = thresholdsText
      .split(',')
      .map((token) => Number(token.trim()))
      .filter((value) => Number.isFinite(value) && value > 0 && value <= 100)
      .sort((a, b) => a - b);

    setSaving(true);
    try {
      const result = await updateProjectBillingConfig(config.config_id, {
        cap_amount: capAmount,
        cap_behavior: hasCap ? 'hard_cap' : undefined,
        cap_notify_thresholds: thresholds,
      });
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      toast.success(t('billing.cap.saved', 'Budget cap updated'));
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card id="project-billing-cap-panel" className="p-4">
      <h3 className="text-sm font-bold text-[rgb(var(--color-text-900))]">{t('billing.cap.title', 'Budget cap')}</h3>
      <p className="mt-0.5 text-xs text-[rgb(var(--color-text-500))]">
        {t('billing.cap.hint', 'Time & materials bills at rates up to an optional not-to-exceed cap.')}
      </p>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="billing-cap-amount">
            {t('billing.cap.amount', 'Cap amount ({{currency}})', { currency: currency ?? 'USD' })}
          </Label>
          <Input
            id="billing-cap-amount"
            type="number"
            min="0"
            step="0.01"
            value={capText}
            onChange={(e) => setCapText(e.target.value)}
            placeholder={t('billing.cap.noCap', 'No cap')}
            disabled={!canManage}
          />
        </div>
        <div className="rounded-md border border-[rgb(var(--color-border-200))] px-3 py-2">
          <p className="text-xs font-semibold text-[rgb(var(--color-text-700))]">
            {t('billing.cap.hard', 'Hard cap (write down)')}
          </p>
          <p className="mt-1 text-[11px] text-[rgb(var(--color-text-500))]">
            {t('billing.cap.hardHint', 'Labor and materials beyond the cap are written down automatically.')}
          </p>
        </div>
      </div>

      <div className="mt-3">
        <Label htmlFor="billing-cap-thresholds">{t('billing.cap.thresholds', 'Notify at (%)')}</Label>
        <Input
          id="billing-cap-thresholds"
          value={thresholdsText}
          onChange={(e) => setThresholdsText(e.target.value)}
          placeholder="75, 90, 100"
          disabled={!canManage || capText.trim() === ''}
        />
        <p className="mt-1 text-[11px] text-[rgb(var(--color-text-400))]">
          {t('billing.cap.thresholdsHint', 'Comma-separated percentages of the cap.')}
        </p>
      </div>

      {canManage && (
        <div className="mt-4 flex justify-end">
          <Button id="billing-cap-save" size="sm" onClick={handleSave} disabled={saving}>
            {saving ? t('billing.cap.saving', 'Saving...') : t('common:actions.save', 'Save')}
          </Button>
        </div>
      )}
    </Card>
  );
}
