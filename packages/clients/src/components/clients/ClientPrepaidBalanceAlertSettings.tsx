'use client';

import React, { useEffect, useState } from 'react';
import { Text } from '@radix-ui/themes';
import { Input } from '@alga-psa/ui/components/Input';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Label } from '@alga-psa/ui/components/Label';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { CURRENCY_OPTIONS, currencyFractionDigits } from '@alga-psa/core';
import { useFeatureFlag } from '@alga-psa/ui/hooks/useFeatureFlag';
import toast from 'react-hot-toast';
import {
  getErrorMessage,
  handleError,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getPrepaidBalanceAlertSettingsAsync,
  updatePrepaidBalanceAlertSettingsAsync,
  type PrepaidBalanceAlertSettingsInput,
} from '../../lib/billingHelpers';

const PREPAID_BALANCE_ALERT_FLAG = 'release-v1.5-feature';

interface ClientPrepaidBalanceAlertSettingsProps {
  clientId: string;
  defaultCurrencyCode?: string | null;
}

type SettingsLoadState = 'not-loaded' | 'loading' | 'loaded' | 'failed';

const isReturnedActionError = (value: unknown) =>
  isActionMessageError(value) || isActionPermissionError(value);

const isUsableSettingsResult = (value: unknown): value is {
  prepaidCreditAlertThreshold: number | null;
  prepaidCreditAlertCurrencyCode: string | null;
  bucketUsageAlertPercent: number | null;
  notifyClientOnPrepaidAlert: boolean;
  defaultCurrencyCode?: string;
} => {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  const threshold = result.prepaidCreditAlertThreshold;
  const currency = result.prepaidCreditAlertCurrencyCode;
  const bucketPercent = result.bucketUsageAlertPercent;
  const defaultCurrency = result.defaultCurrencyCode;

  const validThreshold =
    threshold === null || (typeof threshold === 'number' && Number.isInteger(threshold) && threshold > 0);
  const validCurrency = currency === null || (typeof currency === 'string' && /^[A-Z]{3}$/.test(currency));
  const validBucketPercent =
    bucketPercent === null ||
    (typeof bucketPercent === 'number' && Number.isInteger(bucketPercent) && bucketPercent >= 1 && bucketPercent <= 100);
  const validDefaultCurrency =
    defaultCurrency === undefined || (typeof defaultCurrency === 'string' && /^[A-Z]{3}$/.test(defaultCurrency));

  return (
    validThreshold &&
    validCurrency &&
    (threshold === null) === (currency === null) &&
    validBucketPercent &&
    typeof result.notifyClientOnPrepaidAlert === 'boolean' &&
    validDefaultCurrency
  );
};

/**
 * Per-client prepaid balance alert policy. Fully gated behind
 * `release-v1.5-feature`: while the flag is loading, unavailable, or disabled
 * the card renders nothing (no skeleton, spacer, or altered tab markup).
 * Saving only persists the policy; the daily 09:00 UTC scan evaluates it.
 */
const ClientPrepaidBalanceAlertSettings: React.FC<ClientPrepaidBalanceAlertSettingsProps> = ({
  clientId,
  defaultCurrencyCode,
}) => {
  const { t } = useTranslation('msp/clients');
  const { enabled, loading } = useFeatureFlag(PREPAID_BALANCE_ALERT_FLAG, { defaultValue: false });

  const [settingsLoadState, setSettingsLoadState] = useState<SettingsLoadState>('not-loaded');
  const [loadedClientId, setLoadedClientId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [creditEnabled, setCreditEnabled] = useState(false);
  const [creditAmount, setCreditAmount] = useState('');
  const [creditCurrency, setCreditCurrency] = useState(defaultCurrencyCode || 'USD');
  const [bucketEnabled, setBucketEnabled] = useState(false);
  const [bucketPercent, setBucketPercent] = useState('');
  const [notifyClient, setNotifyClient] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ credit?: string; bucket?: string }>({});

  useEffect(() => {
    if (!clientId) {
      setLoadedClientId(null);
      setSettingsLoadState('failed');
      return;
    }
    // Keep the card busy while the flag itself is still resolving so a user
    // cannot Save empty defaults in the window before the async fetch runs.
    if (loading) {
      setLoadedClientId(null);
      setSettingsLoadState('not-loaded');
      return;
    }
    if (!enabled) {
      setLoadedClientId(null);
      setSettingsLoadState('not-loaded');
      return;
    }
    let cancelled = false;
    setLoadedClientId(null);
    setSettingsLoadState('loading');
    (async () => {
      try {
        const result = await getPrepaidBalanceAlertSettingsAsync(clientId);
        if (cancelled) return;
        if (isReturnedActionError(result)) {
          handleError(result, t('clientPrepaidBalanceAlertSettings.loadError', { defaultValue: 'Failed to load settings' }));
          setLoadedClientId(null);
          setSettingsLoadState('failed');
          return;
        }
        if (!isUsableSettingsResult(result)) {
          handleError(
            new Error('Prepaid balance alert settings returned an unusable result'),
            t('clientPrepaidBalanceAlertSettings.loadError', { defaultValue: 'Failed to load settings' })
          );
          setLoadedClientId(null);
          setSettingsLoadState('failed');
          return;
        }
        const hasPolicy =
          result.prepaidCreditAlertThreshold != null || result.bucketUsageAlertPercent != null;
        // Minor-unit conversion must use the saved alert currency (which may
        // have a different fraction digit count than the client default, e.g.
        // JPY 0 vs USD 2); otherwise the displayed value corrupts on re-save.
        const alertCurrency =
          result.prepaidCreditAlertCurrencyCode || result.defaultCurrencyCode || defaultCurrencyCode || 'USD';
        const fractionDigits = currencyFractionDigits(alertCurrency);
        setCreditEnabled(result.prepaidCreditAlertThreshold != null);
        setCreditAmount(
          result.prepaidCreditAlertThreshold != null
            ? (result.prepaidCreditAlertThreshold / 10 ** fractionDigits).toFixed(fractionDigits)
            : ''
        );
        setCreditCurrency(alertCurrency);
        setBucketEnabled(result.bucketUsageAlertPercent != null);
        setBucketPercent(result.bucketUsageAlertPercent != null ? String(result.bucketUsageAlertPercent) : '');
        setNotifyClient(result.notifyClientOnPrepaidAlert && hasPolicy);
        setLoadedClientId(clientId);
        setSettingsLoadState('loaded');
      } catch (error) {
        if (!cancelled) {
          handleError(error, t('clientPrepaidBalanceAlertSettings.loadError', { defaultValue: 'Failed to load settings' }));
          setLoadedClientId(null);
          setSettingsLoadState('failed');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, loading, clientId]);

  if (loading || !enabled) {
    return null;
  }

  const parseCreditMinorUnits = (): number | null => {
    if (!creditEnabled) return null;
    const value = parseFloat(creditAmount);
    if (!Number.isFinite(value) || value <= 0) return null;
    const fractionDigits = currencyFractionDigits(creditCurrency);
    const minorUnits = Math.round(value * 10 ** fractionDigits);
    return minorUnits > 0 ? minorUnits : null;
  };

  const validate = (): boolean => {
    const errors: { credit?: string; bucket?: string } = {};
    if (creditEnabled) {
      const minorUnits = parseCreditMinorUnits();
      if (minorUnits == null) {
        errors.credit = t('clientPrepaidBalanceAlertSettings.creditAmountError', {
          defaultValue: 'Enter a positive credit threshold',
        });
      }
    }
    if (bucketEnabled) {
      const value = bucketPercent.trim();
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 100) {
        errors.bucket = t('clientPrepaidBalanceAlertSettings.percentRangeError', {
          defaultValue: 'Enter a whole number from 1 to 100',
        });
      }
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const isBucketPercentValid =
    !bucketEnabled ||
    (/^\d+$/.test(bucketPercent.trim()) && Number(bucketPercent) >= 1 && Number(bucketPercent) <= 100);
  const formIsValid = (!creditEnabled || parseCreditMinorUnits() != null) && isBucketPercentValid;
  const showCreditError = creditEnabled && creditAmount.trim() !== '' && parseCreditMinorUnits() == null;
  const showBucketError = bucketEnabled && bucketPercent.trim() !== '' && !isBucketPercentValid;
  const settingsLoadedForClient = settingsLoadState === 'loaded' && loadedClientId === clientId;

  const handleSave = async () => {
    if (!settingsLoadedForClient || saving || !formIsValid || !validate()) return;
    setSaving(true);
    try {
      const input: PrepaidBalanceAlertSettingsInput = {
        clientId,
        prepaidCreditAlertThreshold: parseCreditMinorUnits(),
        prepaidCreditAlertCurrencyCode: creditEnabled ? creditCurrency : null,
        bucketUsageAlertPercent: bucketEnabled ? parseInt(bucketPercent, 10) : null,
        // Client opt-in only makes sense while at least one alert type is
        // enabled; the server also forces this off when both are disabled.
        notifyClientOnPrepaidAlert: anyAlertEnabled && notifyClient,
      };
      const result = await updatePrepaidBalanceAlertSettingsAsync(input);
      if (isReturnedActionError(result)) {
        throw result;
      }
      toast.success(t('clientPrepaidBalanceAlertSettings.saveSuccess', { defaultValue: 'Prepaid balance alert settings saved' }));
    } catch (error) {
      const message =
        getErrorMessage(error) ||
        t('clientPrepaidBalanceAlertSettings.saveError', { defaultValue: 'Failed to save settings' });
      handleError(error, message);
    } finally {
      setSaving(false);
    }
  };

  const anyAlertEnabled = creditEnabled || bucketEnabled;

  if (!settingsLoadedForClient) {
    return (
      <div className="mt-6">
        <div>
          <Text as="div" size="3" mb="4" weight="medium" className="text-gray-900">
            {t('clientPrepaidBalanceAlertSettings.title', { defaultValue: 'Prepaid Balance Alerts' })}
          </Text>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t('clientPrepaidBalanceAlertSettings.scheduleHelp', {
                defaultValue: 'Checks run daily at 09:00 UTC. Saving does not send anything immediately.',
              })}
            </p>
            {settingsLoadState === 'failed' && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {t('clientPrepaidBalanceAlertSettings.loadError', {
                  defaultValue: 'Failed to load prepaid balance alert settings',
                })}
              </p>
            )}
            <Button id="save-prepaid-balance-alert-settings" disabled>
              {t('clientPrepaidBalanceAlertSettings.save', { defaultValue: 'Save' })}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <div>
        <Text as="div" size="3" mb="4" weight="medium" className="text-gray-900">
          {t('clientPrepaidBalanceAlertSettings.title', { defaultValue: 'Prepaid Balance Alerts' })}
        </Text>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t('clientPrepaidBalanceAlertSettings.scheduleHelp', {
              defaultValue: 'Checks run daily at 09:00 UTC. Saving does not send anything immediately.',
            })}
          </p>

          {/* Credit alert controls */}
          <div className="flex items-center space-x-2">
            <Switch
              id="enable-prepaid-credit-alert"
              checked={creditEnabled}
              onCheckedChange={(checked) => {
                setCreditEnabled(checked);
                setFieldErrors((prev) => ({ ...prev, credit: undefined }));
              }}
            />
            <div className="space-y-1">
              <Label htmlFor="enable-prepaid-credit-alert">
                {t('clientPrepaidBalanceAlertSettings.creditSwitch', { defaultValue: 'Prepaid credit alerts' })}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t('clientPrepaidBalanceAlertSettings.creditSwitchHelp', {
                  defaultValue: 'Alert when available prepaid credit drops below the configured threshold',
                })}
              </p>
            </div>
          </div>

          {creditEnabled && (
            <div className="ml-8 space-y-3">
              <div className="space-y-2">
                <Label htmlFor="prepaid-credit-threshold">
                  {t('clientPrepaidBalanceAlertSettings.creditThreshold', { defaultValue: 'Credit threshold' })}
                </Label>
                <Input
                  id="prepaid-credit-threshold"
                  type="number"
                  min="0"
                  step="0.01"
                  value={creditAmount}
                  onChange={(e) => {
                    setCreditAmount(e.target.value);
                    setFieldErrors((prev) => ({ ...prev, credit: undefined }));
                  }}
                  className="max-w-xs"
                  placeholder={t('clientPrepaidBalanceAlertSettings.creditThresholdPlaceholder', { defaultValue: 'e.g. 500.00' })}
                />
                <p className="text-sm text-muted-foreground">
                  {t('clientPrepaidBalanceAlertSettings.creditThresholdHelp', {
                    defaultValue: 'Remaining prepaid credit that triggers an alert',
                  })}
                </p>
                {(fieldErrors.credit || showCreditError) && (
                  <p className="text-sm text-red-600">
                    {fieldErrors.credit || t('clientPrepaidBalanceAlertSettings.creditAmountError', {
                      defaultValue: 'Enter a positive credit threshold',
                    })}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <CustomSelect
                  label={t('clientPrepaidBalanceAlertSettings.creditCurrency', { defaultValue: 'Currency' })}
                  value={creditCurrency}
                  onValueChange={setCreditCurrency}
                  options={CURRENCY_OPTIONS}
                />
              </div>
            </div>
          )}

          {/* Bucket alert controls */}
          <div className="flex items-center space-x-2">
            <Switch
              id="enable-prepaid-bucket-alert"
              checked={bucketEnabled}
              onCheckedChange={(checked) => {
                setBucketEnabled(checked);
                setFieldErrors((prev) => ({ ...prev, bucket: undefined }));
              }}
            />
            <div className="space-y-1">
              <Label htmlFor="enable-prepaid-bucket-alert">
                {t('clientPrepaidBalanceAlertSettings.bucketSwitch', { defaultValue: 'Bucket usage alerts' })}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t('clientPrepaidBalanceAlertSettings.bucketSwitchHelp', {
                  defaultValue: 'Alert when a prepaid hour bucket reaches the configured consumption',
                })}
              </p>
            </div>
          </div>

          {bucketEnabled && (
            <div className="ml-8 space-y-2">
              <Label htmlFor="prepaid-bucket-percent">
                {t('clientPrepaidBalanceAlertSettings.bucketPercent', { defaultValue: 'Consumption threshold (%)' })}
              </Label>
              <Input
                id="prepaid-bucket-percent"
                type="number"
                min="1"
                max="100"
                step="1"
                value={bucketPercent}
                onChange={(e) => {
                  setBucketPercent(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, bucket: undefined }));
                }}
                className="max-w-xs"
                placeholder={t('clientPrepaidBalanceAlertSettings.bucketPercentPlaceholder', { defaultValue: 'e.g. 80' })}
              />
              <p className="text-sm text-muted-foreground">
                {t('clientPrepaidBalanceAlertSettings.bucketPercentHelp', {
                  defaultValue: 'Percentage of bucket capacity that triggers an alert',
                })}
              </p>
              {(fieldErrors.bucket || showBucketError) && (
                <p className="text-sm text-red-600">
                  {fieldErrors.bucket || t('clientPrepaidBalanceAlertSettings.percentRangeError', {
                    defaultValue: 'Enter a whole number from 1 to 100',
                  })}
                </p>
              )}
            </div>
          )}

          {/* Client routing opt-in */}
          <div className={anyAlertEnabled ? 'flex items-center space-x-2' : 'flex items-center space-x-2 opacity-50 pointer-events-none'}>
            <Switch
              id="prepaid-alert-notify-client"
              checked={notifyClient && anyAlertEnabled}
              onCheckedChange={setNotifyClient}
              disabled={!anyAlertEnabled}
            />
            <div className="space-y-1">
              <Label htmlFor="prepaid-alert-notify-client">
                {t('clientPrepaidBalanceAlertSettings.notifyClient', { defaultValue: 'Also email the client billing recipient' })}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t('clientPrepaidBalanceAlertSettings.notifyClientHelp', {
                  defaultValue: 'Sends the alert to the client\u2019s canonical invoice billing recipient',
                })}
              </p>
            </div>
          </div>

          <div>
            <Button
              id="save-prepaid-balance-alert-settings"
              onClick={handleSave}
              disabled={saving || !settingsLoadedForClient || !formIsValid}
            >
              {saving
                ? t('common.actions.saving', { defaultValue: 'Saving...' })
                : t('clientPrepaidBalanceAlertSettings.save', { defaultValue: 'Save' })}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClientPrepaidBalanceAlertSettings;
