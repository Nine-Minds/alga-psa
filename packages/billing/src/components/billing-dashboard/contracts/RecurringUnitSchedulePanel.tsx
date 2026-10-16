'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { History, Loader2 } from 'lucide-react';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { toCalendarDateString, toCalendarDisplayDate } from '@alga-psa/core';
import {
  getEffectiveRecurringUnitPricing,
  listRecurringUnitPricingRevisionHistory,
  listRecurringUnitPricingRevisions,
  resolveRecurringUnitMidPeriod,
  scheduleRecurringUnitPricingRevision,
  type ResolvedRecurringUnitMidPeriod,
} from '@alga-psa/billing/actions/contractLineUnitPricingActions';
import { previewRecurringRevisionInvoiceImpact, type RecurringRevisionInvoiceImpact } from '@alga-psa/billing/actions/invoiceGeneration';
import { getNextContractServiceBoundary } from '@alga-psa/billing/actions/contractLineSemanticsActions';
import type { EffectiveRecurringUnitPricingReadResult } from '@alga-psa/billing/actions/contractLineUnitPricingActions';
import type { IRecurringUnitPricingRevisionListRow } from '@alga-psa/billing/lib/billing/seatRevisions';
import {
  computeRecurringUnitMidPeriodAdjustment,
  daysBetweenOnly,
} from '@alga-psa/shared/billingClients/recurringUnitMidPeriodAdjustment';
import type {
  ContractLineUnitPricePolicy,
  IContractLineUnitPricingRevisionHistoryEntry,
} from '@alga-psa/types';

const isReturnedActionError = (value: unknown): boolean =>
  isActionMessageError(value) || isActionPermissionError(value);

const todayIso = (): string => new Date().toISOString().slice(0, 10);

export interface RecurringUnitSchedulePanelProps {
  contractLineId: string;
  serviceId: string;
  configId: string;
  currencyCode: string;
  disabled?: boolean;
  onScheduled?: () => void;
}

/**
 * Schedule prospective quantity/price changes for a recurring product or
 * explicitly unit-priced Fixed service, and review the effective-period
 * history. This is deliberately independent of the line's inline editor so a
 * previously invoiced item stays changeable without rewriting billed periods:
 * the change is stored as a revision effective at a service-period boundary and
 * billing resolves it per covered period.
 */
export const RecurringUnitSchedulePanel: React.FC<RecurringUnitSchedulePanelProps> = ({
  contractLineId,
  serviceId,
  configId,
  currencyCode,
  disabled = false,
  onScheduled,
}) => {
  const { t } = useTranslation('msp/contracts');
  const { formatCurrency, formatDate } = useFormatters();

  const requestRef = useRef(0);
  const [boundary, setBoundary] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [effective, setEffective] = useState<EffectiveRecurringUnitPricingReadResult | null>(null);
  const [revisions, setRevisions] = useState<IRecurringUnitPricingRevisionListRow[]>([]);
  const [history, setHistory] = useState<IContractLineUnitPricingRevisionHistoryEntry[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  // A date picked while the form has an unsaved edit waits here for the user to
  // confirm discarding that edit.
  const [pendingBoundary, setPendingBoundary] = useState<string | null>(null);
  const [boundaryPickerResetKey, setBoundaryPickerResetKey] = useState(0);
  // The values the form was loaded with; a date change that would discard an
  // unsaved edit prompts before reloading.
  const loadedInputsRef = useRef<{ quantity: string; policy: ContractLineUnitPricePolicy; rate: string }>({
    quantity: '',
    policy: 'override',
    rate: '',
  });

  const [quantityInput, setQuantityInput] = useState<string>('');
  const [pricePolicy, setPricePolicy] = useState<ContractLineUnitPricePolicy>('override');
  const [rateInput, setRateInput] = useState<string>('');
  const [impact, setImpact] = useState<RecurringRevisionInvoiceImpact | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [midPeriod, setMidPeriod] = useState(false);
  const [midPeriodDate, setMidPeriodDate] = useState('');
  const [midPeriodContext, setMidPeriodContext] = useState<ResolvedRecurringUnitMidPeriod | null>(null);
  const [midPeriodError, setMidPeriodError] = useState<string | null>(null);
  const impactRequest = useRef(0);
  useEffect(() => {
    impactRequest.current += 1;
    setImpact(null);
    setPreviewing(false);
  }, [boundary, quantityInput, pricePolicy, rateInput, revisions, midPeriod, midPeriodDate]);

  const previewImpact = async () => {
    const request = ++impactRequest.current;
    setPreviewing(true);
    setImpact(null);
    try {
      const result = await previewRecurringRevisionInvoiceImpact({
        contract_line_id: contractLineId, service_id: serviceId, config_id: configId,
        quantity: Number(quantityInput), price_policy: pricePolicy,
        unit_rate_cents: pricePolicy === 'override' ? Math.round(Number(rateInput) * 100) : null,
        effective_period_start: standingBoundary,
        allow_mid_period: midPeriod,
        mid_period_effective_date: midPeriod ? midPeriodDate : null,
        expected_version: standingRevision?.version ?? null,
      });
      if (request === impactRequest.current) setImpact(result);
    } catch (error) {
      if (request === impactRequest.current) setImpact({ success: false, error: getErrorMessage(error) });
    } finally {
      if (request === impactRequest.current) setPreviewing(false);
    }
  };

  const formatRate = useCallback(
    (cents: number | null | undefined) =>
      cents === null || cents === undefined
        ? t('common.empty.notAvailable', { defaultValue: 'N/A' })
        : formatCurrency(cents / 100, currencyCode),
    [currencyCode, formatCurrency, t],
  );

  // Every date shown to the user goes through the tenant's date format. Values
  // stay YYYY-MM-DD internally; only the rendered text is formatted.
  // LEVERAGE: pattern calendar-day-display — formatDate(toCalendarDateString(x)) / formatDate(toPlainDate(x).toString()) is repeated in FinalizedTab, DraftsTab, ProjectBillingReviewTab, TaxRegionsAndRates, ClientContractsTab; useFormatters is missing a formatCalendarDay.
  const formatDay = useCallback(
    (value: string | null | undefined): string | null => {
      const day = value ? toCalendarDateString(value) : null;
      return day ? formatDate(day) : null;
    },
    [formatDate],
  );

  // Audit columns show who acted; the raw id stays reachable as a tooltip
  // when the user no longer resolves to a name.
  const renderActor = (userId: string | null | undefined, name: string | null | undefined) => {
    if (!userId) return '—';
    if (userId === 'system') {
      return t('contractLines.recurringSchedule.systemActor', { defaultValue: 'System' });
    }
    if (name) return name;
    return (
      <span title={userId}>
        {t('contractLines.recurringSchedule.unknownActor', { defaultValue: 'Unknown user' })}
      </span>
    );
  };

  const load = useCallback(
    async (boundaryToLoad: string) => {
      const requestId = ++requestRef.current;
      setLoading(true);
      setLoadError(null);
      try {
        const effectiveResult = await getEffectiveRecurringUnitPricing({
          contract_line_id: contractLineId,
          service_id: serviceId,
          config_id: configId,
          service_period_start: boundaryToLoad,
        });
        if (requestId !== requestRef.current) return;
        if (isReturnedActionError(effectiveResult)) {
          setLoadError(getErrorMessage(effectiveResult));
          setEffective(null);
          setRevisions([]);
          setHistory([]);
          return;
        }
        const [revisionRows, historyRows] = await Promise.all([
          listRecurringUnitPricingRevisions({
            contract_line_id: contractLineId,
            service_id: serviceId,
            config_id: configId,
          }),
          listRecurringUnitPricingRevisionHistory({
            contract_line_id: contractLineId,
            service_id: serviceId,
            config_id: configId,
          }),
        ]);
        if (requestId !== requestRef.current) return;
        setEffective(effectiveResult);
        setRevisions(isReturnedActionError(revisionRows) ? [] : revisionRows);
        if (isReturnedActionError(historyRows)) {
          setHistory([]);
          setHistoryError(getErrorMessage(historyRows));
        } else {
          setHistory(historyRows);
          setHistoryError(null);
        }
        // Start the form from the values in force at the selected boundary.
        const nextQuantity = String(effectiveResult.quantity);
        const nextPolicy = effectiveResult.pricePolicy;
        const nextRate =
          effectiveResult.unitRateCents === null || effectiveResult.unitRateCents === undefined
            ? ''
            : (effectiveResult.unitRateCents / 100).toFixed(2);
        setQuantityInput(nextQuantity);
        setPricePolicy(nextPolicy);
        setRateInput(nextRate);
        loadedInputsRef.current = { quantity: nextQuantity, policy: nextPolicy, rate: nextRate };
      } catch (error) {
        if (requestId === requestRef.current) {
          setLoadError(getErrorMessage(error));
          setEffective(null);
        }
      } finally {
        if (requestId === requestRef.current) {
          setLoading(false);
        }
      }
    },
    [contractLineId, configId, serviceId],
  );

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      const nextBoundary = await getNextContractServiceBoundary(contractLineId);
      if (cancelled) return;
      const initial =
        isReturnedActionError(nextBoundary) || !nextBoundary ? todayIso() : String(nextBoundary);
      setBoundary(initial);
      await load(initial);
    };
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [contractLineId, load]);

  // When a mid-period date is chosen, load the affected period's standing
  // values (its covered dates, quantity and rate) so the true-up math can be
  // shown without changing the form's boundary/revision values.
  useEffect(() => {
    if (!midPeriod || !/^\d{4}-\d{2}-\d{2}$/.test(midPeriodDate)) {
      setMidPeriodContext(null);
      setMidPeriodError(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const result = await resolveRecurringUnitMidPeriod({
          contract_line_id: contractLineId,
          service_id: serviceId,
          config_id: configId,
          mid_period_date: midPeriodDate,
        });
        if (cancelled) return;
        if (isReturnedActionError(result)) {
          setMidPeriodContext(null);
          setMidPeriodError(getErrorMessage(result));
          return;
        }
        setMidPeriodContext(result);
        setMidPeriodError(null);
      } catch (error) {
        if (!cancelled) {
          setMidPeriodContext(null);
          setMidPeriodError(getErrorMessage(error));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [midPeriod, midPeriodDate, contractLineId, serviceId, configId]);

  const applyBoundary = (nextBoundary: string) => {
    setBoundary(nextBoundary);
    setSavedMessage(null);
    setSaveError(null);
    void load(nextBoundary);
  };

  const handleBoundaryChange = (nextBoundary: string) => {
    // Picking the day already selected is not a change.
    if (!nextBoundary || nextBoundary === boundary) return;
    const loaded = loadedInputsRef.current;
    const dirty =
      quantityInput !== loaded.quantity ||
      pricePolicy !== loaded.policy ||
      rateInput !== loaded.rate;
    if (dirty) {
      setPendingBoundary(nextBoundary);
      return;
    }
    applyBoundary(nextBoundary);
  };

  const cancelBoundaryChange = () => {
    setPendingBoundary(null);
    setBoundaryPickerResetKey((key) => key + 1);
  };

  const confirmBoundaryChange = () => {
    const next = pendingBoundary;
    setPendingBoundary(null);
    if (next) applyBoundary(next);
  };

  // Only the revision stored at exactly the selected boundary is authoritative
  // for a compare-and-set. An earlier revision that merely applies to this
  // boundary (inherited) must not be sent as the expected version, or a
  // brand-new future boundary would be rejected as stale.
  const boundaryRevision =
    revisions.find((revision) => revision.effective_period_start === boundary) ?? null;
  // With the mid-period opt-in, the standing quantity begins at the resolved
  // next boundary (not the picked date), and the compare-and-set token is the
  // revision stored at that boundary.
  const standingBoundary = midPeriod && midPeriodContext ? midPeriodContext.periodEnd : boundary;
  const standingRevision =
    revisions.find((revision) => revision.effective_period_start === standingBoundary) ?? null;

  const handleSave = async () => {
    setSaveError(null);
    setSavedMessage(null);
    const quantity = Number(quantityInput);
    if (quantityInput === '' || !Number.isInteger(quantity) || quantity < 0) {
      setSaveError(
        t('contractLines.recurringSchedule.invalidQuantity', {
          defaultValue: 'Quantity must be a whole number of 0 or more.',
        }),
      );
      return;
    }
    let unitRateCents: number | null = null;
    if (pricePolicy === 'override') {
      const dollars = Number(rateInput);
      if (rateInput === '' || !Number.isFinite(dollars) || dollars < 0) {
        setSaveError(
          t('contractLines.recurringSchedule.invalidRate', {
            defaultValue: 'Enter a unit price of 0 or more, or switch to catalog pricing.',
          }),
        );
        return;
      }
      unitRateCents = Math.round(dollars * 100);
    }
    if (midPeriod && (!midPeriodContext || !/^\d{4}-\d{2}-\d{2}$/.test(midPeriodDate))) {
      setSaveError(
        t('contractLines.recurringSchedule.midPeriodDateRequired', {
          defaultValue: 'Choose a date inside an upcoming unbilled period for the one-time mid-period true-up.',
        }),
      );
      return;
    }
    setSaving(true);
    try {
      const result = await scheduleRecurringUnitPricingRevision({
        contract_line_id: contractLineId,
        service_id: serviceId,
        config_id: configId,
        quantity,
        price_policy: pricePolicy,
        unit_rate_cents: pricePolicy === 'override' ? unitRateCents : null,
        effective_period_start: standingBoundary,
        allow_mid_period: midPeriod,
        mid_period_effective_date: midPeriod ? midPeriodDate : null,
        expected_version: standingRevision ? standingRevision.version : null,
      });
      if (isReturnedActionError(result)) {
        setSaveError(getErrorMessage(result));
        return;
      }
      setSavedMessage(
        t('contractLines.recurringSchedule.saved', {
          defaultValue: 'Scheduled: {{quantity}} effective {{date}}.',
          quantity,
          date: formatDay(standingBoundary),
        }),
      );
      await load(standingBoundary);
      onScheduled?.();
    } catch (error) {
      setSaveError(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const stale = boundaryRevision !== null;
  const isProtected =
    effective?.protectedLifecycle === 'billed' || effective?.protectedLifecycle === 'locked';
  const currentResolvedRateCents =
    effective?.resolvedUnitRateCents ?? effective?.unitRateCents ?? null;
  // A catalog selection must preview the catalog price for the selected
  // boundary, not the currently-effective override.
  const proposedRateCents =
    pricePolicy === 'catalog'
      ? effective?.catalogUnitRateCents ?? null
      : rateInput === ''
        ? null
        : Math.round(Number(rateInput) * 100);
  const proposedQuantity = Number(quantityInput);
  const catalogPriceMissing =
    pricePolicy === 'catalog' &&
    !!effective &&
    effective.catalogUnitRateCents === null &&
    Number.isInteger(proposedQuantity) &&
    proposedQuantity > 0;
  const currentSubtotalCents =
    effective && currentResolvedRateCents !== null
      ? effective.quantity * currentResolvedRateCents
      : null;
  const proposedSubtotalCents =
    proposedRateCents !== null && Number.isInteger(proposedQuantity)
      ? proposedQuantity * proposedRateCents
      : null;
  const deltaCents =
    currentSubtotalCents !== null && proposedSubtotalCents !== null
      ? proposedSubtotalCents - currentSubtotalCents
      : null;
  const coveredEndLabel = formatDay(effective?.coveredEnd) ?? t('contractLines.recurringSchedule.openPeriod', { defaultValue: 'next boundary' });

  // Mid-period (opt-in) quantity-only true-up. The standing change begins at
  // the selected boundary; the affected period is the one containing the
  // mid-period date and is billed at its own standing quantity plus one
  // prorated charge/credit for the partial period.
  const priceChangedForMidPeriod =
    !!midPeriodContext &&
    (pricePolicy !== midPeriodContext.pricePolicy ||
      (pricePolicy === 'override' &&
        proposedRateCents !== null &&
        midPeriodContext.unitRateCents !== null &&
        proposedRateCents !== midPeriodContext.unitRateCents));
  const midPeriodStandingDelta =
    midPeriodContext && Number.isInteger(proposedQuantity)
      ? proposedQuantity - midPeriodContext.previousQuantity
      : null;
  const affectedStart = midPeriodContext?.periodStart ?? null;
  const affectedEnd = midPeriodContext?.periodEnd ?? null;
  const affectedRateCents = midPeriodContext?.unitRateCents ?? null;
  let midPeriodCoveredDays: number | null = null;
  let midPeriodFullDays: number | null = null;
  let midPeriodAmountCents: number | null = null;
  if (
    midPeriod &&
    midPeriodStandingDelta !== null &&
    affectedStart &&
    affectedEnd &&
    affectedRateCents !== null &&
    /^\d{4}-\d{2}-\d{2}$/.test(midPeriodDate)
  ) {
    try {
      midPeriodCoveredDays = daysBetweenOnly(midPeriodDate, affectedEnd);
      midPeriodFullDays = daysBetweenOnly(affectedStart, affectedEnd);
      midPeriodAmountCents = computeRecurringUnitMidPeriodAdjustment({
        quantityDelta: midPeriodStandingDelta,
        unitRateCents: affectedRateCents,
        coveredDays: midPeriodCoveredDays,
        fullPeriodDays: midPeriodFullDays,
      }).amountCents;
    } catch {
      midPeriodAmountCents = null;
    }
  }
  const midPeriodBlocked = midPeriod && (priceChangedForMidPeriod || !!midPeriodError);
  const midPeriodReady =
    midPeriod && !midPeriodBlocked && midPeriodAmountCents !== null && midPeriodCoveredDays !== null;

  return (
    <div className="col-span-2 rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-[rgb(var(--color-text-600))]" aria-hidden />
          <h5 className="text-sm font-medium text-[rgb(var(--color-text-800))]">
            {t('contractLines.recurringSchedule.title', {
              defaultValue: 'Recurring quantity & pricing schedule',
            })}
          </h5>
        </div>
        {effective && (
          <Badge className="chip-primary border-[rgb(var(--color-primary-200))]">
            {effective.kind === 'product'
              ? t('contractLines.recurringSchedule.kindProduct', { defaultValue: 'Product' })
              : t('contractLines.recurringSchedule.kindService', { defaultValue: 'Unit service' })}
          </Badge>
        )}
      </div>

      {boundary && boundary < todayIso() && !isProtected && (
        <Alert variant="info" className="mt-3"><AlertDescription>
          {t('contractLines.recurringSchedule.olderUnbilled', { defaultValue: 'This boundary is in the past. Pending billing from this date onward will use the scheduled values; earlier billed periods stay unchanged.' })}
        </AlertDescription></Alert>
      )}

      {loadError && (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {historyError && (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>
            {t('contractLines.recurringSchedule.historyLoadError', {
              defaultValue: 'Could not load the scheduled history: {{error}}',
              error: historyError,
            })}
          </AlertDescription>
        </Alert>
      )}

      {isProtected && (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription className="text-xs">
            {t('contractLines.recurringSchedule.protectedPeriod', {
              defaultValue:
                'This period is already {{state}} and is protected. Choose a later, unbilled service-period boundary; billed invoice amounts are never rewritten.',
              state: effective?.protectedLifecycle ?? 'billed',
            })}
          </AlertDescription>
        </Alert>
      )}

      {effective && effective.source === 'revision' && (
        <Alert variant="info" className="mb-3">
          <AlertDescription className="text-xs">
            {t('contractLines.recurringSchedule.existingRevisionNotice', {
              defaultValue:
                'A scheduled change is already in force from {{date}}. Saving again at this same boundary replaces it (version {{version}}); earlier periods stay unchanged.',
              date: formatDay(effective.effectivePeriodStart ?? boundary),
              version: effective.version ?? 1,
            })}
          </AlertDescription>
        </Alert>
      )}

      <p className="mb-3 text-xs text-[rgb(var(--color-text-600))]">
        {midPeriod
          ? t('contractLines.recurringSchedule.midPeriodNote', {
              defaultValue:
                'Mid-period true-up: the new standing quantity starts at the boundary shown, and one prorated charge or credit covers the partial period. Earlier billed amounts are never rewritten.',
            })
          : t('contractLines.recurringSchedule.boundaryOnly', {
              defaultValue:
                'Changes take effect only at a service-period boundary. There is no mid-period proration, true-up or credit: earlier billed amounts stay unchanged and the new quantity/price applies from the boundary shown.',
            })}
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor={`recurring-effective-${configId}`} className="text-xs uppercase tracking-wide text-muted-foreground">
            {t('contractLines.services.semanticsEffectiveFrom', {
              defaultValue: 'Service pricing and measurement changes effective from',
            })}
          </Label>
          {/* LEVERAGE: friction datetimefield-controlled-revert — DateTimeField does not resync its text when a controlled parent rejects a commit; remount forces it. Engine fix: resync dateText to value after commit when value did not adopt it. */}
          <DatePicker
            id={`recurring-effective-${configId}`}
            key={`recurring-effective-${configId}-${boundaryPickerResetKey}`}
            label={t('contractLines.services.semanticsEffectiveFrom', {
              defaultValue: 'Service pricing and measurement changes effective from',
            })}
            value={toCalendarDisplayDate(standingBoundary) ?? undefined}
            disabled={disabled || saving || loading || (midPeriod && !!midPeriodContext)}
            onChange={(date) => handleBoundaryChange(toCalendarDateString(date) ?? '')}
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor={`recurring-quantity-${configId}`} className="text-xs uppercase tracking-wide text-muted-foreground">
            {t('contractLines.services.recurringUnits', { defaultValue: 'Recurring seats/units' })}
          </Label>
          <Input
            id={`recurring-quantity-${configId}`}
            type="number"
            min="0"
            step="1"
            value={quantityInput}
            disabled={disabled || saving}
            onChange={(event) => setQuantityInput(event.target.value)}
            className="mt-1"
          />
          {Number(quantityInput) === 0 && (
            <p className="mt-1 text-xs text-[rgb(var(--color-text-600))]">
              {t('contractLines.recurringSchedule.stopHelp', {
                defaultValue:
                  'Zero stops recurring billing from this period. The item, its history and other contract items are kept; add a later revision to resume.',
              })}
            </p>
          )}
        </div>

        <div>
          <Label htmlFor={`recurring-policy-${configId}`} className="text-xs uppercase tracking-wide text-muted-foreground">
            {t('contractLines.recurringSchedule.pricingSource', { defaultValue: 'Unit price source' })}
          </Label>
          <CustomSelect
            id={`recurring-policy-${configId}`}
            value={pricePolicy}
            disabled={disabled || saving}
            onValueChange={(value) => setPricePolicy(value as ContractLineUnitPricePolicy)}
            options={[
              {
                value: 'catalog',
                label: t('contractLines.recurringSchedule.useCatalog', {
                  defaultValue: 'Use catalog price',
                }),
              },
              {
                value: 'override',
                label: t('contractLines.recurringSchedule.override', {
                  defaultValue: 'Override unit price',
                }),
              },
            ]}
          />
        </div>

        <div>
          <Label htmlFor={`recurring-rate-${configId}`} className="text-xs uppercase tracking-wide text-muted-foreground">
            {t('contractLines.services.unitRate', { defaultValue: 'Unit Rate' })}
          </Label>
          <Input
            id={`recurring-rate-${configId}`}
            type="number"
            min="0"
            step="0.01"
            value={pricePolicy === 'override' ? rateInput : ''}
            disabled={disabled || saving || pricePolicy !== 'override'}
            placeholder={pricePolicy === 'catalog'
              ? t('contractLines.recurringSchedule.inherited', { defaultValue: 'Inherited from catalog' })
              : '0.00'}
            onChange={(event) => setRateInput(event.target.value)}
            className="mt-1"
          />
        </div>
      </div>

      <div className="mt-4 rounded-md border border-[rgb(var(--color-border-200))] p-3">
        <label htmlFor={`recurring-mid-period-${configId}`} className="flex items-start gap-2 text-sm">
          <input
            id={`recurring-mid-period-${configId}`}
            type="checkbox"
            className="mt-0.5"
            checked={midPeriod}
            disabled={disabled || saving || loading || isProtected || !!loadError}
            onChange={(event) => {
              const checked = event.target.checked;
              setMidPeriod(checked);
              setSavedMessage(null);
              if (checked && !midPeriodDate) {
                setMidPeriodDate(effective?.coveredStart ?? boundary);
              }
            }}
          />
          <span>
            <span className="font-medium text-[rgb(var(--color-text-800))]">
              {t('contractLines.recurringSchedule.midPeriodToggle', {
                defaultValue: 'Apply a one-time mid-period true-up',
              })}
            </span>
            <span className="mt-0.5 block text-xs text-[rgb(var(--color-text-600))]">
              {t('contractLines.recurringSchedule.midPeriodToggleHelp', {
                defaultValue:
                  'Quantity-only. The new standing quantity starts at the boundary above, and one prorated charge or credit covers the days from the change date to that boundary. Leave off to change only at the boundary.',
              })}
            </span>
          </span>
        </label>

        {midPeriod && (
          <div className="mt-3">
            <Label htmlFor={`recurring-mid-period-date-${configId}`} className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('contractLines.recurringSchedule.midPeriodDate', { defaultValue: 'Quantity changes on' })}
            </Label>
            <DatePicker
              id={`recurring-mid-period-date-${configId}`}
              label={t('contractLines.recurringSchedule.midPeriodDate', { defaultValue: 'Quantity changes on' })}
              value={toCalendarDisplayDate(midPeriodDate) ?? undefined}
              disabled={disabled || saving || loading}
              onChange={(date) => {
                setMidPeriodDate(toCalendarDateString(date) ?? '');
                setSavedMessage(null);
              }}
              className="mt-1 max-w-[12rem]"
            />
          </div>
        )}

        {midPeriodBlocked && (
          <Alert variant="destructive" className="mt-3">
            <AlertDescription className="text-xs">
              {midPeriodError ??
                t('contractLines.recurringSchedule.midPeriodQuantityOnly', {
                  defaultValue:
                    'A mid-period true-up may only change the quantity. Schedule a unit price change at a service-period boundary instead.',
                })}
            </AlertDescription>
          </Alert>
        )}

        {midPeriodReady && (
          <div className="mt-3 space-y-1 text-sm text-[rgb(var(--color-text-700))]">
            <p>
              {t('contractLines.recurringSchedule.midPeriodAffected', {
                defaultValue: 'Affected period {{start}} to {{end}} changes by {{delta}} units.',
                start: formatDay(affectedStart),
                end: formatDay(affectedEnd),
                delta: midPeriodStandingDelta,
              })}
            </p>
            <p className="text-xs text-[rgb(var(--color-text-600))]">
              {t('contractLines.recurringSchedule.midPeriodMath', {
                defaultValue:
                  '{{delta}} units × {{rate}} × {{covered}}/{{full}} days = {{amount}} {{effect}}.',
                delta: midPeriodStandingDelta,
                rate: formatRate(affectedRateCents),
                covered: midPeriodCoveredDays,
                full: midPeriodFullDays,
                amount: formatCurrency(Math.abs(midPeriodAmountCents ?? 0) / 100, midPeriodContext?.currencyCode ?? currencyCode),
                effect:
                  (midPeriodAmountCents ?? 0) < 0
                    ? t('contractLines.recurringSchedule.credit', { defaultValue: 'credit' })
                    : t('contractLines.recurringSchedule.charge', { defaultValue: 'charge' }),
              })}
            </p>
            <p className="text-xs text-[rgb(var(--color-text-600))]">
              {t('contractLines.recurringSchedule.midPeriodStanding', {
                defaultValue:
                  'From {{boundary}} the standing quantity is {{quantity}}. The true-up lands on the next eligible editable draft (with applicable discounts and tax).',
                boundary: formatDay(standingBoundary),
                quantity: proposedQuantity,
              })}
            </p>
          </div>
        )}
      </div>

      {effective && (
        <div className="mt-3 space-y-1 text-sm text-[rgb(var(--color-text-700))]">
          <p>
            {t('contractLines.recurringSchedule.currentEffective', {
              defaultValue: 'In force for periods from {{date}}: {{quantity}} × {{rate}} ({{source}}).',
              date: formatDay(effective.effectivePeriodStart ?? boundary),
              quantity: effective.quantity,
              rate: formatRate(currentResolvedRateCents),
              source:
                effective.pricePolicy === 'catalog'
                  ? t('contractLines.recurringSchedule.sourceCatalog', { defaultValue: 'catalog price' })
                  : t('contractLines.recurringSchedule.sourceOverride', { defaultValue: 'explicit override' }),
            })}
          </p>
          <p className="text-xs text-[rgb(var(--color-text-600))]">
            {t('contractLines.recurringSchedule.coverage', {
              defaultValue: 'Covers {{start}} to {{end}} ({{currency}}).',
              start: formatDay(effective.coveredStart ?? boundary),
              end: coveredEndLabel,
              currency: effective.currencyCode ?? currencyCode,
            })}
          </p>
          {effective.pricePolicy === 'catalog' && (
            <p className="text-xs text-[rgb(var(--color-text-600))]">
              {t('contractLines.recurringSchedule.catalogSource', {
                defaultValue:
                  'Catalog price {{priceId}} effective {{effectiveDate}}; inherited, so a later catalog change follows automatically.',
                priceId: effective.catalogPriceId ?? t('common.empty.notAvailable', { defaultValue: 'N/A' }),
                effectiveDate: formatDay(effective.catalogEffectiveDate) ?? t('common.empty.notAvailable', { defaultValue: 'N/A' }),
              })}
            </p>
          )}
          <p className="text-xs text-[rgb(var(--color-text-600))]">
            {t('contractLines.recurringSchedule.baselineRow', {
              defaultValue: 'Baseline (no revision): {{quantity}} × {{rate}}.',
              quantity: effective.baselineQuantity,
              rate: formatRate(effective.baselineUnitRateCents),
            })}
          </p>
          {deltaCents !== null && (
            <p className="text-xs font-medium text-[rgb(var(--color-text-800))]">
              {t('contractLines.recurringSchedule.invoiceImpact', {
                defaultValue:
                  'From {{date}} the recurring subtotal for this item changes by {{delta}} to {{total}} (before discounts and tax). Earlier billed periods are unchanged.',
                date: formatDay(standingBoundary),
                delta: formatCurrency(deltaCents / 100, effective.currencyCode ?? currencyCode),
                total: formatCurrency((proposedSubtotalCents ?? 0) / 100, effective.currencyCode ?? currencyCode),
              })}
            </p>
          )}
        </div>
      )}

      <div className="mt-3" aria-live="polite">
        <Button id={`preview-recurring-impact-${configId}`} type="button" variant="outline" size="sm"
          disabled={disabled || saving || loading || previewing || isProtected || !!loadError ||
            !boundary || quantityInput === '' || !Number.isInteger(proposedQuantity) || proposedQuantity < 0 ||
            midPeriodBlocked || (midPeriod && !midPeriodReady) ||
            catalogPriceMissing || (pricePolicy === 'override' && (rateInput === '' || !Number.isFinite(proposedRateCents) || (proposedRateCents ?? -1) < 0))}
          onClick={() => void previewImpact()}>
          {t('contractLines.recurringSchedule.previewImpact', { defaultValue: 'Preview invoice impact' })}
          {previewing && <Loader2 className="ml-1 h-4 w-4 animate-spin" />}
        </Button>
        {impact?.success === false && <Alert variant="destructive" className="mt-2"><AlertDescription>{impact.error}</AlertDescription></Alert>}
        {impact?.success && <div className="mt-2 text-sm">
          <p>{midPeriod
            ? t('contractLines.recurringSchedule.invoiceWindowMidPeriod', {
                defaultValue:
                  'Estimated client invoice for {{start}} to {{end}}. Includes other items in this billing window and the one-time mid-period true-up.',
                start: formatDay(impact.windowStart),
                end: formatDay(impact.windowEnd),
              })
            : t('contractLines.recurringSchedule.invoiceWindowBoundaryOnly', {
                defaultValue:
                  'Estimated client invoice for {{start}} to {{end}}. Includes other items in this billing window; no mid-period adjustment.',
                start: formatDay(impact.windowStart),
                end: formatDay(impact.windowEnd),
              })}</p>
          <p>{t('contractLines.recurringSchedule.invoiceTotals', { defaultValue: 'Subtotal after discounts: {{subtotal}}. Tax: {{tax}}. Total: {{before}} → {{after}}.', subtotal: formatCurrency(impact.after.subtotal / 100, impact.after.currencyCode), tax: formatCurrency(impact.after.tax / 100, impact.after.currencyCode), before: formatCurrency(impact.before.total / 100, impact.before.currencyCode), after: formatCurrency(impact.after.total / 100, impact.after.currencyCode) })}</p>
          {/* Show the resolved true-up (charge or credit) and any other credit
              lines so the operator sees exactly what the totals include. */}
          {impact.after.items
            .filter(item => item.total < 0 || /mid-period quantity change/i.test(item.description))
            .map(item => <p key={item.id} className={item.total > 0 ? 'font-medium' : undefined}>{item.description}: {formatCurrency(item.total / 100, impact.after.currencyCode)}</p>)}
        </div>}
      </div>

      {catalogPriceMissing && (
        <Alert variant="destructive" className="mt-3">
          <AlertDescription className="text-xs">
            {t('contractLines.recurringSchedule.catalogPriceMissing', {
              defaultValue:
                'No {{currency}} catalog price covers this boundary, so a positive quantity cannot bill. Add a {{currency}} catalog price or choose "Override unit price" before saving.',
              currency: effective?.currencyCode ?? currencyCode,
            })}
          </AlertDescription>
        </Alert>
      )}

      {saveError && (
        <Alert variant="destructive" className="mt-3">
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      )}
      {savedMessage && (
        <Alert variant="success" className="mt-3">
          <AlertDescription>{savedMessage}</AlertDescription>
        </Alert>
      )}

      <div className="mt-3">
        <Button
          id={`recurring-save-${configId}`}
          type="button"
          size="sm"
          onClick={() => void handleSave()}
          disabled={
            disabled ||
            saving ||
            loading ||
            !boundary ||
            !!loadError ||
            isProtected ||
            midPeriodBlocked ||
            (midPeriod && !midPeriodReady) ||
            catalogPriceMissing
          }
        >
          {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          {stale
            ? t('contractLines.recurringSchedule.replace', { defaultValue: 'Replace scheduled change' })
            : t('contractLines.recurringSchedule.schedule', { defaultValue: 'Schedule change' })}
        </Button>
      </div>

      {revisions.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('contractLines.recurringSchedule.scheduledPeriods', { defaultValue: 'Scheduled periods' })}
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-1 pr-3">{t('contractLines.recurringSchedule.effectiveDate', { defaultValue: 'Effective from' })}</th>
                <th className="py-1 pr-3">{t('contractLines.recurringSchedule.quantity', { defaultValue: 'Quantity' })}</th>
                <th className="py-1 pr-3">{t('contractLines.recurringSchedule.unitPrice', { defaultValue: 'Unit price' })}</th>
                <th className="py-1 pr-3">{t('contractLines.recurringSchedule.version', { defaultValue: 'Version' })}</th>
                <th className="py-1 pr-3">{t('contractLines.recurringSchedule.status', { defaultValue: 'Status' })}</th>
                <th className="py-1">{t('contractLines.recurringSchedule.actor', { defaultValue: 'Actor' })}</th>
              </tr>
            </thead>
            <tbody>
              {effective && (
                <tr className="border-t border-[rgb(var(--color-border-100))] text-muted-foreground">
                  <td className="py-1 pr-3">
                    {t('contractLines.recurringSchedule.baselineLabel', { defaultValue: 'Baseline' })}
                  </td>
                  <td className="py-1 pr-3">{effective.baselineQuantity}</td>
                  <td className="py-1 pr-3">{formatRate(effective.baselineUnitRateCents)}</td>
                  <td className="py-1 pr-3">—</td>
                  <td className="py-1 pr-3">—</td>
                  <td className="py-1">—</td>
                </tr>
              )}
              {revisions.map((revision) => {
                const isFuture = revision.effective_period_start > todayIso();
                const isInForce = effective?.revisionId === revision.revision_id;
                return (
                  <tr key={revision.revision_id} className="border-t border-[rgb(var(--color-border-100))]">
                    <td className="py-1 pr-3">
                      {formatDay(revision.effective_period_start)}
                      {revision.mid_period_effective_date && (
                        <span className="block text-xs text-[rgb(var(--color-text-600))]">
                          {t('contractLines.recurringSchedule.midPeriodFrom', {
                            defaultValue: 'true-up from {{date}}',
                            date: formatDay(revision.mid_period_effective_date),
                          })}
                        </span>
                      )}
                    </td>
                    <td className="py-1 pr-3">{revision.quantity}</td>
                    <td className="py-1 pr-3">
                      {revision.price_policy === 'catalog'
                        ? t('contractLines.recurringSchedule.catalogLabel', { defaultValue: 'Catalog' })
                        : formatRate(revision.unit_rate_cents)}
                    </td>
                    <td className="py-1 pr-3">{revision.version}</td>
                    <td className="py-1 pr-3">
                      {isInForce
                        ? t('contractLines.recurringSchedule.statusInForce', { defaultValue: 'In force' })
                        : isFuture
                          ? t('contractLines.recurringSchedule.statusScheduled', { defaultValue: 'Scheduled' })
                          : t('contractLines.recurringSchedule.statusSuperseded', { defaultValue: 'Superseded' })}
                    </td>
                    <td className="py-1">
                      {revision.updated_by
                        ? renderActor(revision.updated_by, revision.updated_by_name)
                        : renderActor(revision.created_by, revision.created_by_name)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {history.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('contractLines.recurringSchedule.supersededHistory', {
              defaultValue: 'Superseded pending edits ({{count}})',
              count: history.length,
            })}
          </summary>
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-1 pr-3">{t('contractLines.recurringSchedule.effectiveDate', { defaultValue: 'Effective from' })}</th>
                <th className="py-1 pr-3">{t('contractLines.recurringSchedule.quantity', { defaultValue: 'Quantity' })}</th>
                <th className="py-1 pr-3">{t('contractLines.recurringSchedule.unitPrice', { defaultValue: 'Unit price' })}</th>
                <th className="py-1">{t('contractLines.recurringSchedule.supersededBy', { defaultValue: 'Superseded by' })}</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr key={row.history_id} className="border-t border-[rgb(var(--color-border-100))]">
                  <td className="py-1 pr-3">{formatDay(row.effective_period_start)}</td>
                  <td className="py-1 pr-3">{row.quantity}</td>
                  <td className="py-1 pr-3">
                    {row.price_policy === 'catalog'
                      ? t('contractLines.recurringSchedule.catalogLabel', { defaultValue: 'Catalog' })
                      : formatRate(row.unit_rate_cents)}
                  </td>
                  <td className="py-1">{renderActor(row.superseded_by, row.superseded_by_name)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      <ConfirmationDialog
        id={`recurring-discard-dirty-${configId}`}
        isOpen={pendingBoundary !== null}
        onClose={cancelBoundaryChange}
        onConfirm={confirmBoundaryChange}
        title={t('contractLines.recurringSchedule.discardDirtyTitle', { defaultValue: 'Discard unsaved edit?' })}
        message={t('contractLines.recurringSchedule.discardDirty', {
          defaultValue:
            'Changing the effective date reloads the values in force and discards your unsaved edit. Continue?',
        })}
        confirmLabel={t('contractLines.recurringSchedule.discardDirtyConfirm', { defaultValue: 'Discard and reload' })}
        cancelLabel={t('common.actions.cancel', { defaultValue: 'Cancel' })}
      />
    </div>
  );
};

export default RecurringUnitSchedulePanel;
