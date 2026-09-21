'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@alga-psa/ui/components/Card';
import { Label } from '@alga-psa/ui/components/Label';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Info } from 'lucide-react';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  handleError,
  isActionMessageError,
  isActionPermissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { ITaxRate } from '@alga-psa/types';
import { getTaxRates } from '../../../actions/taxRateActions';
import {
  getTenantTaxSettings,
  updateDefaultTaxRateSetting,
} from '../../../actions/taxSettingsActions';

const UNSET_VALUE = '__no_default__';

type ReturnedActionError = ActionMessageError | ActionPermissionError;
const isReturnedActionError = (value: unknown): value is ReturnedActionError =>
  isActionMessageError(value) || isActionPermissionError(value);

interface DefaultTaxRateSettingsProps {
  isReadOnly?: boolean;
  settingsRevision?: number;
  onSettingsChanged?: () => void;
}

export function DefaultTaxRateSettings({
  isReadOnly = false,
  settingsRevision = 0,
  onSettingsChanged,
}: DefaultTaxRateSettingsProps) {
  const { t } = useTranslation('msp/billing-settings');
  const [taxRates, setTaxRates] = useState<ITaxRate[]>([]);
  const [selectedId, setSelectedId] = useState<string>(UNSET_VALUE);
  const [savedId, setSavedId] = useState<string>(UNSET_VALUE);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isInvalid, setIsInvalid] = useState(false);

  const fetchState = useCallback(async () => {
    setIsLoading(true);
    try {
      const [rates, settings] = await Promise.all([getTaxRates(), getTenantTaxSettings()]);
      if (isReturnedActionError(rates)) {
        handleError(rates, t('tax.defaultRate.errors.load', { defaultValue: 'Failed to load tax rates.' }));
        return;
      }
      if (isReturnedActionError(settings)) {
        handleError(settings, t('tax.defaultRate.errors.load', { defaultValue: 'Failed to load tax rates.' }));
        return;
      }
      setTaxRates(rates.filter((rate) => rate.is_active !== false));
      const stored = settings?.default_tax_rate_id ?? null;
      setIsInvalid(Boolean(settings?.default_tax_rate_invalid));
      setSelectedId(stored ?? UNSET_VALUE);
      setSavedId(stored ?? UNSET_VALUE);
    } catch (err) {
      handleError(err, t('tax.defaultRate.errors.load', { defaultValue: 'Failed to load tax rates.' }));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void fetchState();
  }, [fetchState]);

  useEffect(() => {
    if (settingsRevision > 0) {
      void fetchState();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsRevision]);

  const options = useMemo(() => {
    const rateOptions = taxRates.map((rate) => {
      const description = rate.description || rate.region_code;
      const percentage = Number(rate.tax_percentage);
      const label = `${description} — ${Number.isFinite(percentage) ? percentage.toFixed(2) : '0.00'}% (${rate.region_code})`;
      return { value: rate.tax_rate_id, label };
    });
    return [
      {
        value: UNSET_VALUE,
        label: t('tax.defaultRate.options.none', {
          defaultValue: 'No default (leave catalog items non-taxable unless set)',
        }),
      },
      ...rateOptions,
    ];
  }, [taxRates, t]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const result = await updateDefaultTaxRateSetting(selectedId === UNSET_VALUE ? null : selectedId);
      if (isReturnedActionError(result)) {
        handleError(result);
        return;
      }
      setSavedId(selectedId);
      setIsInvalid(false);
      toast.success(t('tax.defaultRate.toast.saved', { defaultValue: 'Default tax rate saved.' }));
      onSettingsChanged?.();
    } catch (err) {
      handleError(err, t('tax.defaultRate.errors.save', { defaultValue: 'Failed to save the default tax rate.' }));
    } finally {
      setIsSaving(false);
    }
  };

  const hasChanges = selectedId !== savedId;

  if (isLoading) {
    return (
      <Card id="default-tax-rate-settings-card">
        <CardHeader>
          <CardTitle>{t('tax.defaultRate.title', { defaultValue: 'Default Tax Rate' })}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center p-4 text-muted-foreground">
            {t('tax.defaultRate.loading', { defaultValue: 'Loading tax rates...' })}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card id="default-tax-rate-settings-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {t('tax.defaultRate.title', { defaultValue: 'Default Tax Rate' })}
          <Tooltip
            content={t('tax.defaultRate.tooltip', {
              defaultValue:
                'New clients and, when no rate is chosen, new products and services inherit this rate. It does not change existing assignments or issued invoices.',
            })}
          >
            <Info className="h-4 w-4 text-muted-foreground cursor-help" />
          </Tooltip>
        </CardTitle>
        <CardDescription>
          {t('tax.defaultRate.description', {
            defaultValue:
              'Choose the regional rate that new clients, products, and services should inherit.',
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isInvalid && (
          <Alert variant="destructive" showIcon>
            <AlertDescription>
              {t('tax.defaultRate.invalid', {
                defaultValue:
                  'The saved default tax rate is no longer usable (inactive, expired, or its region is inactive). Choose a replacement rate.',
              })}
            </AlertDescription>
          </Alert>
        )}

        {taxRates.length === 0 && (
          <Alert variant="info" showIcon>
            <AlertDescription>
              {t('tax.defaultRate.empty', {
                defaultValue:
                  'No active tax rates yet. Create a region and an active rate below, then choose it here.',
              })}
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <Label htmlFor="default-tax-rate-select" className="text-sm font-medium">
            {t('tax.defaultRate.field.label', { defaultValue: 'Default tax rate' })}
          </Label>
          <CustomSelect
            id="default-tax-rate-select"
            value={selectedId}
            onValueChange={(value) => setSelectedId(value || UNSET_VALUE)}
            options={options}
            disabled={isReadOnly}
          />
          <p className="text-xs text-muted-foreground">
            {t('tax.defaultRate.help', {
              defaultValue:
                'Clearing this setting means no default is applied — it does not make every client tax-exempt. Existing client and catalog assignments remain authoritative.',
            })}
          </p>
        </div>

        {!isReadOnly && (
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button
              id="save-default-tax-rate-button"
              onClick={handleSave}
              disabled={isSaving || !hasChanges}
            >
              {isSaving
                ? t('tax.defaultRate.actions.saving', { defaultValue: 'Saving...' })
                : t('tax.defaultRate.actions.save', { defaultValue: 'Save Default Rate' })}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default DefaultTaxRateSettings;
