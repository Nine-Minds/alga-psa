'use client';

import React from 'react';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Button } from '@alga-psa/ui/components/Button';
import toast from 'react-hot-toast';
import { getErrorMessage, handleError, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { DEFAULT_PAYMENT_TERMS, isPaymentTerms, type PaymentTerms } from '@alga-psa/shared/billingClients/paymentPreferences';
import { getDefaultBillingSettings, updateDefaultBillingSettings } from '../../../actions/billingSettingsActions';
import { paymentTermsOptions } from '@alga-psa/shared/billingClients/paymentPreferenceOptions';

/**
 * Tenant default payment terms: used for new invoices when neither the client
 * nor its billing profile holds a recognised term. Not set resolves to Net 30,
 * so the select shows `defaultPaymentTerms ?? 'net_30'`.
 *
 * Saves only its own key (partial-update contract). Changing the default never
 * rewrites existing clients, profiles or issued invoices.
 */
const DefaultPaymentTermsSettings = (): React.JSX.Element => {
  const { t } = useTranslation('msp/billing-settings');
  const { t: tBilling } = useTranslation('features/billing');
  const [terms, setTerms] = React.useState<PaymentTerms>(DEFAULT_PAYMENT_TERMS);
  const [loadError, setLoadError] = React.useState(false);

  React.useEffect(() => {
    // The load can settle after the section unmounts (tab switch, navigation); drop it then.
    let cancelled = false;
    const loadSettings = async () => {
      try {
        const settings = await getDefaultBillingSettings();
        if (cancelled) return;
        if (isActionPermissionError(settings) || isActionMessageError(settings)) {
          handleError(new Error(getErrorMessage(settings)), t('general.paymentTerms.errors.load', { defaultValue: 'Failed to load settings' }));
          setLoadError(true);
          return;
        }
        setTerms(settings.defaultPaymentTerms ?? DEFAULT_PAYMENT_TERMS);
      } catch (error) {
        if (cancelled) return;
        setLoadError(true);
        handleError(error, t('general.paymentTerms.errors.load', { defaultValue: 'Failed to load settings' }));
      }
    };
    void loadSettings();
    return () => {
      cancelled = true;
    };
    // Load once: `t` identity may change per render and must not re-trigger the load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    try {
      const result = await updateDefaultBillingSettings({ defaultPaymentTerms: terms });
      if (isActionPermissionError(result) || isActionMessageError(result)) {
        handleError(new Error(getErrorMessage(result)), t('general.paymentTerms.errors.save', { defaultValue: 'Failed to save settings' }));
        return;
      }
      if ('actionError' in result) {
        handleError(result.actionError, t('general.paymentTerms.errors.invalid', { defaultValue: 'Choose a valid payment term.' }));
        return;
      }
      if (result.success) {
        toast.success(t('general.paymentTerms.toast.updated', { defaultValue: 'Default payment terms have been updated.' }));
      }
    } catch (error) {
      handleError(error, t('general.paymentTerms.errors.save', { defaultValue: 'Failed to save settings' }));
    }
  };

  return (
    <div className="space-y-3">
      <CustomSelect
        id="default-payment-terms-select"
        data-automation-id="default-payment-terms-select"
        label={t('general.paymentTerms.fields.terms.label', { defaultValue: 'Payment terms' })}
        options={paymentTermsOptions(tBilling)}
        value={terms}
        onValueChange={(value) => {
          if (isPaymentTerms(value)) setTerms(value);
        }}
        disabled={loadError}
      />
      <p className="text-sm text-muted-foreground">
        {t('general.paymentTerms.fields.terms.help', {
          defaultValue: 'Applies to new invoices only. Existing invoices and clients that already have their own terms keep them.',
        })}
      </p>
      <Button id="save-default-payment-terms" data-automation-id="save-default-payment-terms" onClick={save} disabled={loadError}>
        {t('general.paymentTerms.actions.save', { defaultValue: 'Save' })}
      </Button>
    </div>
  );
};

export default DefaultPaymentTermsSettings;
