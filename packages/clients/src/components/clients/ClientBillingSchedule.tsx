'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { Info } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import type { BillingCycleType } from '@alga-psa/types';
import { CLIENT_CADENCE_SCHEDULE_CONTEXT } from '@alga-psa/shared/billingClients';
import {
  createNextBillingCycleAsync,
  getClientBillingCycleAnchorAsync,
  previewBillingHistoryBootstrapAsync,
  previewBillingPeriodsForScheduleAsync,
  updateClientBillingScheduleAsync
} from '../../lib/billingHelpers';

// Local type definition to avoid circular dependency
interface BillingCyclePeriodPreview {
  periodStartDate: string;
  periodEndDate: string;
}
import type { ISO8601String } from '@alga-psa/types';
import type { ClientCadenceScheduleContext } from '@alga-psa/shared/billingClients';
import type { BillingHistoryBootstrapPreview } from '@alga-psa/shared/billingClients';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

const BILLING_CYCLE_OPTIONS: BillingCycleType[] = [
  'weekly',
  'bi-weekly',
  'monthly',
  'quarterly',
  'semi-annually',
  'annually',
];

const MONTH_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

const WEEKDAY_OPTIONS = [1, 2, 3, 4, 5, 6, 7] as const;

type AnchorDraft = {
  dayOfMonth: number | null;
  monthOfYear: number | null;
  dayOfWeek: number | null;
  referenceDate: string | null; // YYYY-MM-DD
};

function defaultAnchorDraftForCycle(billingCycle: BillingCycleType): AnchorDraft {
  switch (billingCycle) {
    case 'weekly':
    case 'bi-weekly':
      return { dayOfMonth: null, monthOfYear: null, dayOfWeek: null, referenceDate: null };
    case 'monthly':
      return { dayOfMonth: 1, monthOfYear: null, dayOfWeek: null, referenceDate: null };
    case 'quarterly':
    case 'semi-annually':
    case 'annually':
      return { dayOfMonth: 1, monthOfYear: 1, dayOfWeek: null, referenceDate: null };
  }
}

export function ClientBillingSchedule(props: { clientId: string }): React.JSX.Element {
  const { clientId } = props;
  const { t } = useTranslation('msp/clients');

  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creatingCycle, setCreatingCycle] = useState(false);
  const [preview, setPreview] = useState<BillingCyclePeriodPreview[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewReferenceDate, setPreviewReferenceDate] = useState<ISO8601String | null>(null);
  const [billingHistoryStartDate, setBillingHistoryStartDate] = useState<string | null>(null);
  const [bootstrapPreview, setBootstrapPreview] = useState<BillingHistoryBootstrapPreview | null>(null);
  const [bootstrapPreviewLoading, setBootstrapPreviewLoading] = useState(false);
  const previewRequestIdRef = useRef(0);
  const bootstrapPreviewRequestIdRef = useRef(0);
  const [cadenceContext, setCadenceContext] = useState<ClientCadenceScheduleContext>(CLIENT_CADENCE_SCHEDULE_CONTEXT);

  const [billingCycle, setBillingCycle] = useState<BillingCycleType>('monthly');
  const [anchorDraft, setAnchorDraft] = useState<AnchorDraft>(defaultAnchorDraftForCycle('monthly'));

  const billingCycleOptions = useMemo(
    () =>
      BILLING_CYCLE_OPTIONS.map((value) => ({
        value,
        label: t(`clientBillingSchedule.cycleOptions.${value}`, {
          defaultValue:
            value === 'bi-weekly'
              ? 'Bi-Weekly'
              : value === 'semi-annually'
                ? 'Semi-Annually'
                : value.charAt(0).toUpperCase() + value.slice(1)
        })
      })),
    [t]
  );

  const monthOptions = useMemo(
    () =>
      MONTH_OPTIONS.map((value) => ({
        value: String(value),
        label: t(`clientBillingSchedule.months.${value}`, {
          defaultValue: new Date(Date.UTC(2020, value - 1, 1)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })
        })
      })),
    [t]
  );

  const weekdayOptions = useMemo(
    () =>
      WEEKDAY_OPTIONS.map((value) => ({
        value: String(value),
        label: t(`clientBillingSchedule.weekdays.${value}`, {
          defaultValue: new Date(Date.UTC(2020, 0, value + 5)).toLocaleString('en-US', { weekday: 'long', timeZone: 'UTC' })
        })
      })),
    [t]
  );

  const scheduleSummary = useMemo(() => {
    switch (billingCycle) {
      case 'weekly':
        return anchorDraft.dayOfWeek
          ? t('clientBillingSchedule.summary.weeklyAnchored', {
              defaultValue: 'Weekly (weekday={{dayOfWeek}})',
              dayOfWeek: anchorDraft.dayOfWeek
            })
          : t('clientBillingSchedule.weeklyRolling', { defaultValue: 'Weekly (rolling)' });
      case 'bi-weekly':
        return anchorDraft.referenceDate
          ? t('clientBillingSchedule.summary.biWeeklyAnchored', {
              defaultValue: 'Bi-weekly (starts {{referenceDate}})',
              referenceDate: anchorDraft.referenceDate
            })
          : t('clientBillingSchedule.biWeeklyRolling', { defaultValue: 'Bi-weekly (rolling)' });
      case 'monthly':
        return t('clientBillingSchedule.summary.monthly', {
          defaultValue: 'Monthly (day {{dayOfMonth}})',
          dayOfMonth: anchorDraft.dayOfMonth ?? 1
        });
      case 'quarterly':
        return t('clientBillingSchedule.summary.quarterly', {
          defaultValue: 'Quarterly ({{monthOfYear}}/{{dayOfMonth}})',
          monthOfYear: anchorDraft.monthOfYear ?? 1,
          dayOfMonth: anchorDraft.dayOfMonth ?? 1
        });
      case 'semi-annually':
        return t('clientBillingSchedule.summary.semiAnnually', {
          defaultValue: 'Semi-annually ({{monthOfYear}}/{{dayOfMonth}})',
          monthOfYear: anchorDraft.monthOfYear ?? 1,
          dayOfMonth: anchorDraft.dayOfMonth ?? 1
        });
      case 'annually':
        return t('clientBillingSchedule.summary.annually', {
          defaultValue: 'Annually ({{monthOfYear}}/{{dayOfMonth}})',
          monthOfYear: anchorDraft.monthOfYear ?? 1,
          dayOfMonth: anchorDraft.dayOfMonth ?? 1
        });
    }
  }, [anchorDraft, billingCycle, t]);

  const loadFromServer = async (): Promise<void> => {
    setLoading(true);
    try {
      const config = await getClientBillingCycleAnchorAsync(clientId);

      setBillingCycle(config.billingCycle);
      setCadenceContext(config.cadenceContext);
      const defaults = defaultAnchorDraftForCycle(config.billingCycle);
      setAnchorDraft({
        dayOfMonth: config.anchor.dayOfMonth ?? defaults.dayOfMonth,
        monthOfYear: config.anchor.monthOfYear ?? defaults.monthOfYear,
        dayOfWeek: config.anchor.dayOfWeek ?? defaults.dayOfWeek,
        referenceDate: config.anchor.referenceDate ? config.anchor.referenceDate.slice(0, 10) : defaults.referenceDate
      });
    } catch (e) {
      handleError(e, t('clientBillingSchedule.loadError', { defaultValue: 'Failed to load billing schedule' }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadFromServer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  useEffect(() => {
    if (!dialogOpen) return;
    if (!previewReferenceDate) return;

    const requestId = ++previewRequestIdRef.current;

    const timeoutId = window.setTimeout(() => {
      setPreviewLoading(true);
      void previewBillingPeriodsForScheduleAsync(
        billingCycle,
        {
          dayOfMonth: anchorDraft.dayOfMonth,
          monthOfYear: anchorDraft.monthOfYear,
          dayOfWeek: anchorDraft.dayOfWeek,
          referenceDate: anchorDraft.referenceDate ? `${anchorDraft.referenceDate}T00:00:00Z` : null
        },
        { count: 3, referenceDate: previewReferenceDate }
      )
        .then((result) => {
          if (previewRequestIdRef.current !== requestId) return;
          setCadenceContext(result.cadenceContext);
          setPreview(result.periods);
        })
        .catch((e) => {
          if (previewRequestIdRef.current !== requestId) return;
          handleError(e, t('clientBillingSchedule.previewError', { defaultValue: 'Failed to preview billing periods' }));
        })
        .finally(() => {
          if (previewRequestIdRef.current !== requestId) return;
          setPreviewLoading(false);
        });
    }, 150);

    return () => window.clearTimeout(timeoutId);
  }, [
    dialogOpen,
    billingCycle,
    anchorDraft.dayOfMonth,
    anchorDraft.monthOfYear,
    anchorDraft.dayOfWeek,
    anchorDraft.referenceDate,
    previewReferenceDate,
  ]);

  useEffect(() => {
    if (!dialogOpen) return;
    if (!billingHistoryStartDate) {
      setBootstrapPreview(null);
      return;
    }

    const requestId = ++bootstrapPreviewRequestIdRef.current;
    const timeoutId = window.setTimeout(() => {
      setBootstrapPreviewLoading(true);
      void previewBillingHistoryBootstrapAsync({
        clientId,
        billingCycle,
        anchor: {
          dayOfMonth: anchorDraft.dayOfMonth,
          monthOfYear: anchorDraft.monthOfYear,
          dayOfWeek: anchorDraft.dayOfWeek,
          referenceDate: anchorDraft.referenceDate ? `${anchorDraft.referenceDate}T00:00:00Z` : null
        },
        billingHistoryStartDate: `${billingHistoryStartDate}T00:00:00Z` as ISO8601String,
      })
        .then((result) => {
          if (bootstrapPreviewRequestIdRef.current !== requestId) return;
          setBootstrapPreview(result);
        })
        .catch((e) => {
          if (bootstrapPreviewRequestIdRef.current !== requestId) return;
          handleError(e, t('clientBillingSchedule.historyPreviewError', { defaultValue: 'Failed to preview billing history bootstrap' }));
        })
        .finally(() => {
          if (bootstrapPreviewRequestIdRef.current !== requestId) return;
          setBootstrapPreviewLoading(false);
        });
    }, 150);

    return () => window.clearTimeout(timeoutId);
  }, [
    anchorDraft.dayOfMonth,
    anchorDraft.dayOfWeek,
    anchorDraft.monthOfYear,
    anchorDraft.referenceDate,
    billingCycle,
    billingHistoryStartDate,
    clientId,
    dialogOpen,
  ]);

  const openDialog = async (): Promise<void> => {
    setPreviewReferenceDate((new Date().toISOString().split('T')[0] + 'T00:00:00Z') as ISO8601String);
    setBillingHistoryStartDate(null);
    setBootstrapPreview(null);
    setDialogOpen(true);
    if (loading) {
      await loadFromServer();
    }
  };

  const onBillingCycleChange = (newCycle: BillingCycleType): void => {
    setBillingCycle(newCycle);
    setAnchorDraft(defaultAnchorDraftForCycle(newCycle));
    setPreview(null);
  };

  const saveSchedule = async (): Promise<void> => {
    setSaving(true);
    try {
      await updateClientBillingScheduleAsync({
        clientId,
        billingCycle,
        anchor: {
          dayOfMonth: anchorDraft.dayOfMonth,
          monthOfYear: anchorDraft.monthOfYear,
          dayOfWeek: anchorDraft.dayOfWeek,
          referenceDate: anchorDraft.referenceDate ? `${anchorDraft.referenceDate}T00:00:00Z` : null
        },
        billingHistoryStartDate: billingHistoryStartDate ? `${billingHistoryStartDate}T00:00:00Z` : null,
      });

      await loadFromServer();
      toast.success(t('clientBillingSchedule.saveSuccess', { defaultValue: 'Billing schedule saved' }));
    } catch (e) {
      handleError(e, t('clientBillingSchedule.saveError', { defaultValue: 'Failed to save billing schedule' }));
    } finally {
      setSaving(false);
    }
  };

  const createNextCycle = async (): Promise<void> => {
    setCreatingCycle(true);
    try {
      const result = await createNextBillingCycleAsync(clientId);
      if (!result.success) {
        toast.error(result.message || t('clientBillingSchedule.createNextCycleError', { defaultValue: 'Failed to create next billing cycle' }));
        return;
      }
      toast.success(t('clientBillingSchedule.createNextCycleSuccess', { defaultValue: 'Created next billing cycle' }));
    } catch (e) {
      handleError(e, t('clientBillingSchedule.createNextCycleError', { defaultValue: 'Failed to create next billing cycle' }));
    } finally {
      setCreatingCycle(false);
    }
  };

  return (
    <div className="mt-8 border-t pt-6" data-automation-id="client-billing-schedule-section">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold">{t('clientBillingSchedule.title', { defaultValue: 'Billing Schedule' })}</h3>
          <Tooltip content={cadenceContext.changeScopeDescription}>
            <Info className="h-4 w-4 text-gray-500" />
          </Tooltip>
        </div>
	        <div className="flex items-center gap-2">
	          <Button
	            id="client-billing-create-next-cycle"
	            type="button"
	            variant="outline"
	            onClick={createNextCycle}
	            disabled={creatingCycle}
	            data-automation-id="client-billing-create-next-cycle"
          >
            {creatingCycle
              ? t('clientBillingSchedule.createInProgress', { defaultValue: 'Creating...' })
              : t('clientBillingSchedule.createNextCycle', { defaultValue: 'Create Next Cycle' })}
	          </Button>
	          <Button
	            id="client-billing-edit-schedule"
	            type="button"
	            variant="default"
	            onClick={openDialog}
	            disabled={loading}
	            data-automation-id="client-billing-edit-schedule"
          >
            {loading
              ? t('common.states.loading', { defaultValue: 'Loading...' })
              : t('clientBillingSchedule.edit', { defaultValue: 'Edit Schedule' })}
	          </Button>
	        </div>
	      </div>

      <div className="mt-2 text-sm text-gray-600">
        {loading ? t('clientBillingSchedule.currentScheduleLoading', { defaultValue: 'Loading current schedule...' }) : scheduleSummary}
      </div>
      <div className="mt-1 text-sm text-gray-500">
        {cadenceContext.scheduleDescription}
      </div>

      <Dialog
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={t('clientBillingSchedule.title', { defaultValue: 'Billing Schedule' })}
        id="client-billing-schedule-dialog"
        disableFocusTrap
        footer={
          <div className="flex justify-end space-x-2">
            <Button
              id="client-billing-schedule-close"
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
              {t('common.actions.close', { defaultValue: 'Close' })}
            </Button>
            <Button
              id="client-billing-save-schedule"
              type="button"
              onClick={saveSchedule}
              disabled={saving || bootstrapPreview?.status === 'blocked_invoiced_history'}
              data-automation-id="client-billing-save-schedule"
            >
              {saving
                ? t('common.actions.saving', { defaultValue: 'Saving...' })
                : t('clientBillingSchedule.save', { defaultValue: 'Save Schedule' })}
            </Button>
          </div>
        }
      >
        <div className="space-y-4 p-1">
          <div className="text-sm text-gray-600">
            {t('clientBillingSchedule.billingPeriodsSemantics', {
              defaultValue: 'Billing periods use [start, end) semantics. The end date is the start of the next period.'
            })}
          </div>
          <div className="text-sm text-gray-600">
            {cadenceContext.previewDescription}
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">{t('clientBillingSchedule.cycleType', { defaultValue: 'Cycle Type' })}</div>
            <CustomSelect
              id="client-billing-cycle-type"
              options={billingCycleOptions}
              value={billingCycle}
              onValueChange={(v) => onBillingCycleChange(v as BillingCycleType)}
              placeholder={t('clientBillingSchedule.selectBillingCycle', { defaultValue: 'Select billing cycle...' })}
            />
          </div>

          {(billingCycle === 'monthly') && (
            <div className="space-y-2">
              <div className="text-sm font-medium">{t('clientBillingSchedule.dayOfMonth', { defaultValue: 'Day of month (1–28)' })}</div>
              <CustomSelect
                id="client-billing-anchor-day-of-month"
                options={Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
                value={String(anchorDraft.dayOfMonth ?? 1)}
                onValueChange={(v) => setAnchorDraft(d => ({ ...d, dayOfMonth: Number(v) }))}
                placeholder={t('clientBillingSchedule.selectDay', { defaultValue: 'Select day...' })}
              />
            </div>
          )}

          {(billingCycle === 'weekly') && (
            <div className="space-y-2">
              <div className="text-sm font-medium">{t('clientBillingSchedule.weekday', { defaultValue: 'Weekday' })}</div>
              <CustomSelect
                id="client-billing-anchor-weekday"
                options={[{ value: '', label: t('clientBillingSchedule.rollingNoAnchor', { defaultValue: 'Rolling (no anchor)' }) }, ...weekdayOptions]}
                value={anchorDraft.dayOfWeek ? String(anchorDraft.dayOfWeek) : ''}
                onValueChange={(v) => setAnchorDraft(d => ({ ...d, dayOfWeek: v ? Number(v) : null }))}
                placeholder={t('clientBillingSchedule.selectWeekday', { defaultValue: 'Select weekday...' })}
              />
            </div>
          )}

          {(billingCycle === 'bi-weekly') && (
            <div className="space-y-2">
              <div className="text-sm font-medium">{t('clientBillingSchedule.firstCycleStartDate', { defaultValue: 'First cycle start date (UTC)' })}</div>
              <Input
                id="client-billing-anchor-reference-date"
                type="date"
                value={anchorDraft.referenceDate ?? ''}
                onChange={(e) => setAnchorDraft(d => ({ ...d, referenceDate: e.target.value || null }))}
              />
              <div className="text-xs text-gray-500">{t('clientBillingSchedule.firstCycleStartHelp', { defaultValue: 'Used to establish stable parity; leave blank for rolling bi-weekly cycles.' })}</div>
            </div>
          )}

          {(billingCycle === 'quarterly' || billingCycle === 'semi-annually' || billingCycle === 'annually') && (
            <div className="space-y-3">
              <div className="space-y-2">
                <div className="text-sm font-medium">{t('clientBillingSchedule.startMonth', { defaultValue: 'Start month' })}</div>
                <CustomSelect
                  id="client-billing-anchor-start-month"
                  options={monthOptions}
                  value={String(anchorDraft.monthOfYear ?? 1)}
                  onValueChange={(v) => setAnchorDraft(d => ({ ...d, monthOfYear: Number(v) }))}
                  placeholder={t('clientBillingSchedule.selectMonth', { defaultValue: 'Select month...' })}
                />
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium">{t('clientBillingSchedule.dayOfMonth', { defaultValue: 'Day of month (1–28)' })}</div>
                <CustomSelect
                  id="client-billing-anchor-day-of-month"
                  options={Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
                  value={String(anchorDraft.dayOfMonth ?? 1)}
                  onValueChange={(v) => setAnchorDraft(d => ({ ...d, dayOfMonth: Number(v) }))}
                  placeholder={t('clientBillingSchedule.selectDay', { defaultValue: 'Select day...' })}
                />
              </div>
            </div>
          )}

          <div className="space-y-2 border-t pt-3">
            <div className="text-sm font-medium">{t('clientBillingSchedule.historyStartDate', { defaultValue: 'Billing History Start Date (optional)' })}</div>
            <Input
              id="client-billing-history-start-date"
              type="date"
              value={billingHistoryStartDate ?? ''}
              onChange={(e) => setBillingHistoryStartDate(e.target.value || null)}
            />
            <div className="text-xs text-gray-500">
              {t('clientBillingSchedule.historyStartHelp', { defaultValue: 'If set, historical client billing cycles are generated from the containing billing-cycle boundary through today.' })}
            </div>
            {bootstrapPreview ? (
              <div className="space-y-1 text-xs">
                <div className="text-gray-700">
                  {t('clientBillingSchedule.normalizedHistoryBoundary', {
                    defaultValue: 'Normalized history boundary: {{date}}',
                    date: bootstrapPreview.normalizedHistoryStartBoundary.slice(0, 10)
                  })}
                </div>
                {bootstrapPreview.earliestInvoicedCycleStartBoundary ? (
                  <div className="text-gray-700">
                    {t('clientBillingSchedule.earliestInvoicedBoundary', {
                      defaultValue: 'Earliest invoiced boundary: {{date}}',
                      date: bootstrapPreview.earliestInvoicedCycleStartBoundary.slice(0, 10)
                    })}
                  </div>
                ) : null}
                <div className="text-gray-700">
                  {t('clientBillingSchedule.uninvoicedCyclesToRegenerate', {
                    defaultValue: 'Uninvoiced cycles to regenerate: {{count}}',
                    count: bootstrapPreview.affectedUninvoicedCycleCount
                  })}
                </div>
                {bootstrapPreview.status === 'blocked_invoiced_history' ? (
                  <div className="text-red-600">{bootstrapPreview.blockedReason}</div>
                ) : null}
              </div>
            ) : null}
            {bootstrapPreviewLoading ? (
              <div className="text-xs text-gray-500">{t('clientBillingSchedule.updatingHistoryPreview', { defaultValue: 'Updating billing history bootstrap preview...' })}</div>
            ) : null}
          </div>

          <div className="pt-2 border-t">
            <div className="text-sm font-medium mb-2">{cadenceContext.previewHeading}</div>
            {preview ? (
              <div className="space-y-1 text-sm text-gray-700">
                {preview.map((p, idx) => (
                  <div key={idx} className="font-mono">
                    {p.periodStartDate.slice(0, 10)} → {p.periodEndDate.slice(0, 10)}
                  </div>
                ))}
                {previewLoading && (
                  <div className="text-xs text-gray-500">{t('clientBillingSchedule.updatingCadencePreview', { defaultValue: 'Updating client-cadence preview...' })}</div>
                )}
              </div>
            ) : (
              <div className="text-sm text-gray-500">{t('clientBillingSchedule.previewLoading', { defaultValue: 'Loading client-cadence preview...' })}</div>
            )}
          </div>
        </div>
      </Dialog>
    </div>
  );
}
