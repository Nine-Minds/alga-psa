'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Save } from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Switch } from '@alga-psa/ui/components/Switch';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { RmmProvider } from '@alga-psa/types';
import {
  getRmmIntegrationStatuses,
  updateRmmDeviceSyncSettings,
  type RmmIntegrationStatus,
} from '../../../actions/integrations/rmmIntegrationStatusActions';

/**
 * Providers with a device sync strategy the rmm-device-sync job can drive.
 * Every other provider gets no control at all rather than one that saves a
 * setting nothing reads.
 */
export const DEVICE_SYNC_SUPPORTED_PROVIDERS: readonly RmmProvider[] = ['ninjaone', 'levelio'];

export function supportsScheduledDeviceSync(provider: RmmProvider): boolean {
  return DEVICE_SYNC_SUPPORTED_PROVIDERS.includes(provider);
}

// Kept in step with the clamp in rmmIntegrationStatusActions by hand: that
// module is 'use server', so a client component cannot import its constants.
export const DEVICE_SYNC_MIN_MINUTES = 15;
export const DEVICE_SYNC_MAX_MINUTES = 1440;
export const DEVICE_SYNC_DEFAULT_MINUTES = 60;

export interface RmmDeviceSyncSettingsProps {
  provider: RmmProvider;
  /** Supplied by callers that already loaded statuses; otherwise loaded here. */
  status?: RmmIntegrationStatus;
  onSaved?: () => void;
}

export function RmmDeviceSyncSettings({ provider, status, onSaved }: RmmDeviceSyncSettingsProps) {
  const { t } = useTranslation('msp/integrations');
  const { formatDate } = useFormatters();

  const [loadedStatus, setLoadedStatus] = useState<RmmIntegrationStatus | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [intervalInput, setIntervalInput] = useState(String(DEVICE_SYNC_DEFAULT_MINUTES));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const effectiveStatus = status ?? loadedStatus;

  const loadStatus = useCallback(async () => {
    try {
      const result = await getRmmIntegrationStatuses();
      setLoadedStatus(result.success ? result.statuses?.[provider] ?? null : null);
    } catch {
      setLoadedStatus(null);
    }
  }, [provider]);

  useEffect(() => {
    if (!supportsScheduledDeviceSync(provider) || status) return;
    void loadStatus();
  }, [loadStatus, provider, status]);

  // Adopt the saved values when they change. Keyed on the values rather than on
  // the status object so a caller re-rendering with a fresh object does not
  // discard an edit in progress.
  const savedEnabled = effectiveStatus?.deviceSyncEnabled ?? false;
  const savedInterval = effectiveStatus?.deviceSyncIntervalMinutes ?? DEVICE_SYNC_DEFAULT_MINUTES;
  useEffect(() => {
    setEnabled(savedEnabled);
    setIntervalInput(String(savedInterval));
  }, [savedEnabled, savedInterval]);

  const parsedInterval = Number.parseInt(intervalInput, 10);
  const intervalIsValid =
    Number.isFinite(parsedInterval) &&
    parsedInterval >= DEVICE_SYNC_MIN_MINUTES &&
    parsedInterval <= DEVICE_SYNC_MAX_MINUTES;

  const handleSave = async () => {
    if (!intervalIsValid) return;
    setIsSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await updateRmmDeviceSyncSettings({
        provider,
        enabled,
        intervalMinutes: parsedInterval,
      });
      if (!result.success) {
        setError(
          result.error ||
            t('integrations.rmm.deviceSync.errors.saveFailed', {
              defaultValue: 'Unable to save the device sync schedule.',
            })
        );
        return;
      }
      if (typeof result.intervalMinutes === 'number') {
        setIntervalInput(String(result.intervalMinutes));
      }
      setSuccess(
        t('integrations.rmm.deviceSync.success.saved', {
          defaultValue: 'Device sync schedule saved. The scheduler applies it within a few minutes.',
        })
      );
      if (!status) await loadStatus();
      onSaved?.();
    } catch {
      setError(
        t('integrations.rmm.deviceSync.errors.saveFailed', {
          defaultValue: 'Unable to save the device sync schedule.',
        })
      );
    } finally {
      setIsSaving(false);
    }
  };

  // Nothing to schedule until the integration row exists, and nothing worth
  // showing before the status that decides the toggle position has loaded.
  if (!supportsScheduledDeviceSync(provider) || !effectiveStatus) return null;

  const dateTimeOptions: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };

  return (
    <Card id={`${provider}-device-sync-settings`}>
      <CardHeader>
        <CardTitle>
          {t('integrations.rmm.deviceSync.title', { defaultValue: 'Scheduled device sync' })}
        </CardTitle>
        <CardDescription>
          {t('integrations.rmm.deviceSync.description', {
            defaultValue:
              'Refresh this device inventory on a schedule instead of waiting for someone to run a full sync. Every run calls the provider API, and for some providers an incremental run still reads the whole device list, so a shorter interval costs proportionally more API calls.',
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {success ? (
          <Alert variant="success">
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex items-center gap-2">
          <Switch
            id={`${provider}-device-sync-enabled`}
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={isSaving}
          />
          <Label htmlFor={`${provider}-device-sync-enabled`}>
            {t('integrations.rmm.deviceSync.enabledLabel', {
              defaultValue: 'Sync devices on a schedule',
            })}
          </Label>
        </div>

        <div className="space-y-1">
          <Label htmlFor={`${provider}-device-sync-interval`}>
            {t('integrations.rmm.deviceSync.intervalLabel', {
              defaultValue: 'Run every (minutes)',
            })}
          </Label>
          <Input
            id={`${provider}-device-sync-interval`}
            type="number"
            inputMode="numeric"
            min={DEVICE_SYNC_MIN_MINUTES}
            max={DEVICE_SYNC_MAX_MINUTES}
            step={1}
            value={intervalInput}
            onChange={(e) => setIntervalInput(e.target.value)}
            disabled={isSaving}
            className="max-w-xs"
          />
          {intervalIsValid ? (
            <div className="text-xs text-muted-foreground">
              {t('integrations.rmm.deviceSync.intervalHelp', {
                defaultValue:
                  'Choose between {{min}} and {{max}} minutes. A shorter interval keeps device data fresher and calls the provider API more often.',
                min: DEVICE_SYNC_MIN_MINUTES,
                max: DEVICE_SYNC_MAX_MINUTES,
              })}
            </div>
          ) : (
            <div className="text-xs text-destructive">
              {t('integrations.rmm.deviceSync.intervalInvalid', {
                defaultValue:
                  'Enter a whole number of minutes between {{min}} and {{max}}.',
                min: DEVICE_SYNC_MIN_MINUTES,
                max: DEVICE_SYNC_MAX_MINUTES,
              })}
            </div>
          )}
        </div>

        {/* Two labelled lines, never one merged "last synced": a manual full sync
            also advances lastSyncAt, so folding them together would answer
            "is my schedule running?" with a timestamp the schedule never wrote. */}
        <div className="space-y-1 text-xs text-muted-foreground">
          <div>
            {effectiveStatus.lastIncrementalSyncAt
              ? t('integrations.rmm.deviceSync.lastScheduledRun', {
                  defaultValue: 'Last scheduled run: {{time}}',
                  time: formatDate(effectiveStatus.lastIncrementalSyncAt, dateTimeOptions),
                })
              : t('integrations.rmm.deviceSync.lastScheduledRunNever', {
                  defaultValue: 'The scheduled sync has not run yet.',
                })}
          </div>
          <div>
            {effectiveStatus.lastSyncAt
              ? t('integrations.rmm.deviceSync.lastAnySync', {
                  defaultValue: 'Last sync of any kind, including manual full syncs: {{time}}',
                  time: formatDate(effectiveStatus.lastSyncAt, dateTimeOptions),
                })
              : t('integrations.rmm.deviceSync.lastAnySyncNever', {
                  defaultValue: 'No device sync of any kind has run yet.',
                })}
          </div>
        </div>

        {effectiveStatus.syncError ? (
          <Alert variant="destructive">
            <AlertDescription>
              {t('integrations.rmm.deviceSync.lastSyncError', {
                defaultValue: 'The last sync failed: {{error}}',
                error: effectiveStatus.syncError,
              })}
            </AlertDescription>
          </Alert>
        ) : null}

        <Button
          id={`${provider}-save-device-sync`}
          type="button"
          onClick={handleSave}
          disabled={isSaving || !intervalIsValid}
        >
          {isSaving ? (
            <>
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              {t('integrations.rmm.deviceSync.actions.saving', { defaultValue: 'Saving...' })}
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              {t('integrations.rmm.deviceSync.actions.save', {
                defaultValue: 'Save sync schedule',
              })}
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

export default RmmDeviceSyncSettings;
