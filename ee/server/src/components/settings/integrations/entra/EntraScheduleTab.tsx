'use client';

import React from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { CustomSelect } from '@alga-psa/ui/components/CustomSelect';
import { Switch } from '@alga-psa/ui/components/Switch';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  saveEntraSyncSchedule,
  type EntraSyncScheduleSettings,
} from '@alga-psa/integrations/actions';

interface EntraScheduleTabProps {
  schedule: EntraSyncScheduleSettings | null;
  /** True once one client has completed a real run. */
  hasCompletedPilot: boolean;
  onSaved: () => void | Promise<void>;
}

const INTERVAL_CHOICES = [60, 240, 720, 1440, 10080];

/**
 * Automatic sync, on or off, at a cadence the tenant chooses.
 *
 * `sync_enabled` and `sync_interval_minutes` have existed since phase 1 with
 * nothing writing them: the screen's only mention of the schedule was a
 * read-only "Next Sync Interval" line, so a tenant could neither enable
 * automatic sync nor pause it. Saving here also reconciles the Temporal
 * schedule immediately rather than at the next worker boot.
 */
export function EntraScheduleTab({
  schedule,
  hasCompletedPilot,
  onSaved,
}: EntraScheduleTabProps): React.JSX.Element {
  const { t } = useTranslation('msp/integrations');
  const [enabled, setEnabled] = React.useState(Boolean(schedule?.syncEnabled));
  const [intervalMinutes, setIntervalMinutes] = React.useState(schedule?.syncIntervalMinutes ?? 1440);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setEnabled(Boolean(schedule?.syncEnabled));
    setIntervalMinutes(schedule?.syncIntervalMinutes ?? 1440);
  }, [schedule?.syncEnabled, schedule?.syncIntervalMinutes]);

  const handleSave = React.useCallback(async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await saveEntraSyncSchedule({
        syncEnabled: enabled,
        syncIntervalMinutes: intervalMinutes,
      });
      if ('error' in result) {
        setError(result.error || t('integrations.entra.console.schedule.saveFailed'));
        return;
      }

      // The setting is stored either way; say so plainly when the schedule
      // itself could not be reconciled rather than claiming success.
      setMessage(
        result.data?.scheduleApplied === false
          ? t('integrations.entra.console.schedule.savedPending')
          : t('integrations.entra.console.schedule.saved')
      );
      await onSaved();
    } finally {
      setSaving(false);
    }
  }, [enabled, intervalMinutes, onSaved, t]);

  return (
    <div className="space-y-4" id="entra-console-schedule">
      {!schedule?.syncEnabled && hasCompletedPilot ? (
        <p className="rounded-md border border-border/60 bg-muted/30 p-3 text-sm" id="entra-schedule-prompt">
          {t('integrations.entra.console.schedule.enablePrompt')}
        </p>
      ) : null}

      <div className="rounded-lg border border-border/70 bg-background p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">{t('integrations.entra.console.schedule.title')}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('integrations.entra.console.schedule.description')}
            </p>
          </div>
          <Switch
            id="entra-schedule-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={saving}
          />
        </div>

        <div className="mt-3 max-w-xs">
          <CustomSelect
            id="entra-schedule-interval"
            label={t('integrations.entra.console.schedule.intervalLabel')}
            value={String(intervalMinutes)}
            onValueChange={(value) => setIntervalMinutes(Number(value))}
            options={INTERVAL_CHOICES.map((minutes) => ({
              value: String(minutes),
              label: t(`integrations.entra.console.schedule.intervals.${minutes}`),
            }))}
            disabled={saving || !enabled}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            id="entra-schedule-save"
            type="button"
            size="sm"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving
              ? t('integrations.entra.console.schedule.saving')
              : t('integrations.entra.console.schedule.save')}
          </Button>
          {enabled ? (
            <Button
              id="entra-schedule-pause"
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setEnabled(false);
                setMessage(t('integrations.entra.console.schedule.pauseHint'));
              }}
              disabled={saving}
            >
              {t('integrations.entra.console.schedule.pause')}
            </Button>
          ) : null}
        </div>

        {message ? (
          <p className="mt-2 text-sm text-muted-foreground" id="entra-schedule-message">{message}</p>
        ) : null}
        {error ? (
          <p className="mt-2 text-sm text-destructive" id="entra-schedule-error">{error}</p>
        ) : null}
      </div>
    </div>
  );
}

export default EntraScheduleTab;
