'use client';

import React from 'react';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Button } from '@alga-psa/ui/components/Button';
import toast from 'react-hot-toast';
import { getErrorMessage, handleError, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getDefaultBillingSettings, updateDefaultBillingSettings } from '../../../actions/billingSettingsActions';
import { DEFAULT_QUOTE_VALIDITY_DAYS, MAX_QUOTE_VALIDITY_DAYS, MIN_QUOTE_VALIDITY_DAYS } from '../../../constants/billing';

const QuoteSettings = (): React.JSX.Element => {
  const { t } = useTranslation('msp/billing-settings');
  const [days, setDays] = React.useState(String(DEFAULT_QUOTE_VALIDITY_DAYS));
  const [loadError, setLoadError] = React.useState(false);
  const valid = /^\d+$/.test(days) && Number(days) >= MIN_QUOTE_VALIDITY_DAYS && Number(days) <= MAX_QUOTE_VALIDITY_DAYS;

  React.useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await getDefaultBillingSettings();
        if (isActionPermissionError(settings) || isActionMessageError(settings)) {
          handleError(new Error(getErrorMessage(settings)), t('general.quotes.errors.load', { defaultValue: 'Failed to load settings' }));
          setLoadError(true);
          return;
        }
        setDays(String(settings.defaultQuoteValidityDays ?? DEFAULT_QUOTE_VALIDITY_DAYS));
      } catch (error) {
        setLoadError(true);
        handleError(error, t('general.quotes.errors.load', { defaultValue: 'Failed to load settings' }));
      }
    };
    void loadSettings();
  }, [t]);

  const save = async () => {
    if (!valid) return;
    try {
      const result = await updateDefaultBillingSettings({ defaultQuoteValidityDays: Number(days) });
      if (isActionPermissionError(result) || isActionMessageError(result)) {
        handleError(new Error(getErrorMessage(result)), t('general.quotes.errors.save', { defaultValue: 'Failed to save settings' }));
        return;
      }
      if ('actionError' in result) {
        handleError(result.actionError, t('general.quotes.errors.range', { defaultValue: 'Enter a whole number from 1 to 365.' }));
        return;
      }
      if (result.success) toast.success(t('general.quotes.toast.updated', { defaultValue: 'Quote settings have been updated.' }));
    } catch (error) {
      handleError(error, t('general.quotes.errors.save', { defaultValue: 'Failed to save settings' }));
    }
  };

  return <div className="space-y-3">
    <div className="space-y-2">
      <Label htmlFor="default-quote-validity-days">{t('general.quotes.fields.validityDays.label', { defaultValue: 'Default validity period (days)' })}</Label>
      <Input id="default-quote-validity-days" data-automation-id="default-quote-validity-days" type="number" min={MIN_QUOTE_VALIDITY_DAYS} max={MAX_QUOTE_VALIDITY_DAYS} step="1" value={days} onChange={(event) => setDays(event.target.value)} className="max-w-xs" aria-invalid={!valid} />
      <p className="text-sm text-muted-foreground">{t('general.quotes.fields.validityDays.help', { defaultValue: 'New quotes are valid for this many days.' })}</p>
    </div>
    <Button id="save-default-quote-validity-days" data-automation-id="save-default-quote-validity-days" onClick={save} disabled={!valid || loadError}>{t('general.quotes.actions.save', { defaultValue: 'Save' })}</Button>
  </div>;
};

export default QuoteSettings;
