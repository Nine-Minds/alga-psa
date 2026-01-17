'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { Info } from 'lucide-react';
import { toast } from 'react-hot-toast';
import type { BillingCycleType } from 'server/src/interfaces/billing.interfaces';
import { createNextBillingCycle } from 'server/src/lib/actions/billingCycleActions';
import {
  getClientBillingCycleAnchor,
  previewBillingPeriodsForSchedule,
  type BillingCyclePeriodPreview
} from 'server/src/lib/actions/billingCycleAnchorActions';
import { updateClientBillingSchedule } from 'server/src/lib/actions/billingScheduleActions';
import type { ISO8601String } from 'server/src/types/types.d';

const BILLING_CYCLE_OPTIONS: { value: BillingCycleType; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'bi-weekly', label: 'Bi-Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'semi-annually', label: 'Semi-Annually' },
  { value: 'annually', label: 'Annually' },
];

const MONTH_OPTIONS = [
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' },
] as const;

const WEEKDAY_OPTIONS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 7, label: 'Sunday' },
] as const;

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

function formatScheduleSummary(billingCycle: BillingCycleType, anchor: AnchorDraft): string {
  switch (billingCycle) {
    case 'weekly':
      return anchor.dayOfWeek ? `Weekly (weekday=${anchor.dayOfWeek})` : 'Weekly (rolling)';
    case 'bi-weekly':
      return anchor.referenceDate ? `Bi-weekly (starts ${anchor.referenceDate})` : 'Bi-weekly (rolling)';
    case 'monthly':
      return `Monthly (day ${anchor.dayOfMonth ?? 1})`;
    case 'quarterly':
      return `Quarterly (${anchor.monthOfYear ?? 1}/${anchor.dayOfMonth ?? 1})`;
    case 'semi-annually':
      return `Semi-annually (${anchor.monthOfYear ?? 1}/${anchor.dayOfMonth ?? 1})`;
    case 'annually':
      return `Annually (${anchor.monthOfYear ?? 1}/${anchor.dayOfMonth ?? 1})`;
  }
}

export function ClientBillingSchedule(props: { clientId: string }): React.JSX.Element {
  const { clientId } = props;

  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creatingCycle, setCreatingCycle] = useState(false);
  const [preview, setPreview] = useState<BillingCyclePeriodPreview[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewReferenceDate, setPreviewReferenceDate] = useState<ISO8601String | null>(null);
  const previewRequestIdRef = useRef(0);

  const [billingCycle, setBillingCycle] = useState<BillingCycleType>('monthly');
  const [anchorDraft, setAnchorDraft] = useState<AnchorDraft>(defaultAnchorDraftForCycle('monthly'));

  const scheduleSummary = useMemo(() => formatScheduleSummary(billingCycle, anchorDraft), [billingCycle, anchorDraft]);

  const loadFromServer = async (): Promise<void> => {
    setLoading(true);
    try {
      const config = await getClientBillingCycleAnchor(clientId);

      setBillingCycle(config.billingCycle);
      const defaults = defaultAnchorDraftForCycle(config.billingCycle);
      setAnchorDraft({
        dayOfMonth: config.anchor.dayOfMonth ?? defaults.dayOfMonth,
        monthOfYear: config.anchor.monthOfYear ?? defaults.monthOfYear,
        dayOfWeek: config.anchor.dayOfWeek ?? defaults.dayOfWeek,
        referenceDate: config.anchor.referenceDate ? config.anchor.referenceDate.slice(0, 10) : defaults.referenceDate
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to load billing schedule', e);
      toast.error('Failed to load billing schedule');
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
      void previewBillingPeriodsForSchedule(
        billingCycle,
        {
          dayOfMonth: anchorDraft.dayOfMonth,
          monthOfYear: anchorDraft.monthOfYear,
          dayOfWeek: anchorDraft.dayOfWeek,
          referenceDate: anchorDraft.referenceDate ? `${anchorDraft.referenceDate}T00:00:00Z` : null
        },
        { count: 3, referenceDate: previewReferenceDate }
      )
        .then((periods) => {
          if (previewRequestIdRef.current !== requestId) return;
          setPreview(periods);
        })
        .catch((e) => {
          if (previewRequestIdRef.current !== requestId) return;
          // eslint-disable-next-line no-console
          console.error('Failed to preview billing periods', e);
          toast.error('Failed to preview billing periods');
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

  const openDialog = async (): Promise<void> => {
    setPreviewReferenceDate((new Date().toISOString().split('T')[0] + 'T00:00:00Z') as ISO8601String);
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
      await updateClientBillingSchedule({
        clientId,
        billingCycle,
        anchor: {
          dayOfMonth: anchorDraft.dayOfMonth,
          monthOfYear: anchorDraft.monthOfYear,
          dayOfWeek: anchorDraft.dayOfWeek,
          referenceDate: anchorDraft.referenceDate ? `${anchorDraft.referenceDate}T00:00:00Z` : null
        }
      });

      await loadFromServer();
      toast.success('Billing schedule saved');
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to save billing schedule', e);
      toast.error(e instanceof Error ? e.message : 'Failed to save billing schedule');
    } finally {
      setSaving(false);
    }
  };

  const createNextCycle = async (): Promise<void> => {
    setCreatingCycle(true);
    try {
      const result = await createNextBillingCycle(clientId);
      if (!result.success) {
        toast.error(result.message || 'Failed to create next billing cycle');
        return;
      }
      toast.success('Created next billing cycle');
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to create next billing cycle', e);
      toast.error(e instanceof Error ? e.message : 'Failed to create next billing cycle');
    } finally {
      setCreatingCycle(false);
    }
  };

  return (
    <div className="mt-8 border-t pt-6" data-automation-id="client-billing-schedule-section">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold">Billing Schedule</h3>
          <Tooltip content="Configure billing cycle type + anchor. Changes only affect future non-invoiced billing cycles.">
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
            {creatingCycle ? 'Creating...' : 'Create Next Cycle'}
	          </Button>
	          <Button
	            id="client-billing-edit-schedule"
	            type="button"
	            variant="default"
	            onClick={openDialog}
	            disabled={loading}
	            data-automation-id="client-billing-edit-schedule"
          >
            {loading ? 'Loading…' : 'Edit Schedule'}
	          </Button>
	        </div>
	      </div>

      <div className="mt-2 text-sm text-gray-600">
        {loading ? 'Loading current schedule…' : scheduleSummary}
      </div>

      <Dialog
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Billing Schedule"
        id="client-billing-schedule-dialog"
        disableFocusTrap
      >
        <div className="space-y-4 p-1">
          <div className="text-sm text-gray-600">
            Billing periods use <span className="font-mono">[start, end)</span> semantics. The end date is the start of the next period.
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">Cycle Type</div>
            <CustomSelect
              id="client-billing-cycle-type"
              options={BILLING_CYCLE_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
              value={billingCycle}
              onValueChange={(v) => onBillingCycleChange(v as BillingCycleType)}
              placeholder="Select billing cycle..."
            />
          </div>

          {(billingCycle === 'monthly') && (
            <div className="space-y-2">
              <div className="text-sm font-medium">Day of month (1–28)</div>
              <CustomSelect
                id="client-billing-anchor-day-of-month"
                options={Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
                value={String(anchorDraft.dayOfMonth ?? 1)}
                onValueChange={(v) => setAnchorDraft(d => ({ ...d, dayOfMonth: Number(v) }))}
                placeholder="Select day..."
              />
            </div>
          )}

          {(billingCycle === 'weekly') && (
            <div className="space-y-2">
              <div className="text-sm font-medium">Weekday</div>
              <CustomSelect
                id="client-billing-anchor-weekday"
                options={[{ value: '', label: 'Rolling (no anchor)' }, ...WEEKDAY_OPTIONS.map(o => ({ value: String(o.value), label: o.label }))]}
                value={anchorDraft.dayOfWeek ? String(anchorDraft.dayOfWeek) : ''}
                onValueChange={(v) => setAnchorDraft(d => ({ ...d, dayOfWeek: v ? Number(v) : null }))}
                placeholder="Select weekday..."
              />
            </div>
          )}

          {(billingCycle === 'bi-weekly') && (
            <div className="space-y-2">
              <div className="text-sm font-medium">First cycle start date (UTC)</div>
              <Input
                id="client-billing-anchor-reference-date"
                type="date"
                value={anchorDraft.referenceDate ?? ''}
                onChange={(e) => setAnchorDraft(d => ({ ...d, referenceDate: e.target.value || null }))}
              />
              <div className="text-xs text-gray-500">Used to establish stable parity; leave blank for rolling bi-weekly cycles.</div>
            </div>
          )}

          {(billingCycle === 'quarterly' || billingCycle === 'semi-annually' || billingCycle === 'annually') && (
            <div className="space-y-3">
              <div className="space-y-2">
                <div className="text-sm font-medium">Start month</div>
                <CustomSelect
                  id="client-billing-anchor-start-month"
                  options={MONTH_OPTIONS.map(m => ({ value: String(m.value), label: m.label }))}
                  value={String(anchorDraft.monthOfYear ?? 1)}
                  onValueChange={(v) => setAnchorDraft(d => ({ ...d, monthOfYear: Number(v) }))}
                  placeholder="Select month..."
                />
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium">Day of month (1–28)</div>
                <CustomSelect
                  id="client-billing-anchor-day-of-month"
                  options={Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
                  value={String(anchorDraft.dayOfMonth ?? 1)}
                  onValueChange={(v) => setAnchorDraft(d => ({ ...d, dayOfMonth: Number(v) }))}
                  placeholder="Select day..."
                />
              </div>
            </div>
          )}

	          <div className="flex items-center justify-end gap-2 pt-2">
	            <Button
	              id="client-billing-schedule-close"
	              type="button"
	              variant="outline"
	              onClick={() => setDialogOpen(false)}
	              disabled={saving}
	            >
	              Close
	            </Button>
	            <Button
	              id="client-billing-save-schedule"
	              type="button"
	              onClick={saveSchedule}
	              disabled={saving}
	              data-automation-id="client-billing-save-schedule"
            >
              {saving ? 'Saving...' : 'Save Schedule'}
            </Button>
          </div>

          <div className="pt-2 border-t">
            <div className="text-sm font-medium mb-2">Upcoming periods (preview)</div>
            {preview ? (
              <div className="space-y-1 text-sm text-gray-700">
                {preview.map((p, idx) => (
                  <div key={idx} className="font-mono">
                    {p.periodStartDate.slice(0, 10)} → {p.periodEndDate.slice(0, 10)}
                  </div>
                ))}
                {previewLoading && (
                  <div className="text-xs text-gray-500">Updating preview…</div>
                )}
              </div>
            ) : (
              <div className="text-sm text-gray-500">Loading preview…</div>
            )}
          </div>
        </div>
      </Dialog>
    </div>
  );
}
