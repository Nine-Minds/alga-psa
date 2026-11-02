'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { describeRollover, isCadenceBlock } from './prepaidBlockLabels';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useTranslation, useFormatters } from '@alga-psa/ui/lib/i18n/client';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { formatCurrencyFromMinorUnits } from '@alga-psa/core';
import {
  getContractLinePrepaidBlockSummary,
  issueNextPrepaidBlock,
  removeContractLinePrepaidBlock,
  upsertContractLinePrepaidBlock,
  type ContractLinePrepaidBlockSummary,
} from '@alga-psa/billing/actions/prepaidBlockActions';
import type { PrepaidBlockConfigWarning } from '../../../services/prepaidBlockConfigService';
import PrepaidBlockConfigFields from './PrepaidBlockConfigFields';
import {
  draftFromConfig,
  draftToInput,
  minutesToHoursText,
  type PrepaidBlockConfigDraft,
  type PrepaidBlockDraftErrorCode,
} from './prepaidBlockConfigDraft';

interface PrepaidBlockPanelProps {
  contractLineId: string;
  /** contracts.currency_code; falls back to the summary's value. */
  currencyCode?: string | null;
  isReadOnly?: boolean;
  /** Called after a save/remove/issue so the parent can refresh the line card. */
  onChanged?: () => void;
}

const isActionFailure = (value: unknown): boolean =>
  isActionMessageError(value) || isActionPermissionError(value);

export const PrepaidBlockPanel: React.FC<PrepaidBlockPanelProps> = ({
  contractLineId,
  currencyCode,
  isReadOnly = false,
  onChanged,
}) => {
  const { t } = useTranslation('msp/contracts');
  const { formatDate, locale } = useFormatters();
  const idPrefix = `prepaid-block-${contractLineId}`;

  const [summary, setSummary] = useState<ContractLinePrepaidBlockSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionErrorText, setActionErrorText] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<PrepaidBlockConfigWarning[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PrepaidBlockConfigDraft | null>(null);
  const [draftErrors, setDraftErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const result = await getContractLinePrepaidBlockSummary(contractLineId);
      if (isActionFailure(result)) {
        setLoadError(getErrorMessage(result));
        return;
      }
      setLoadError(null);
      setSummary(result as ContractLinePrepaidBlockSummary);
    } catch (error) {
      setLoadError(getErrorMessage(error));
    }
  }, [contractLineId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const currency = currencyCode || summary?.currency_code || '';
  const config = summary?.config ?? null;

  const draftErrorText = (code: PrepaidBlockDraftErrorCode): string => {
    switch (code) {
      case 'hoursInvalid':
        return t('prepaidBlock.errors.hoursInvalid', { defaultValue: 'Enter a block size greater than zero (fractions of an hour are allowed).' });
      case 'priceInvalid':
        return t('prepaidBlock.errors.priceInvalid', { defaultValue: 'Enter a block price of zero or more.' });
      case 'expiryInvalid':
        return t('prepaidBlock.errors.expiryInvalid', { defaultValue: 'Expiry must be a whole number of months from 1 to 120, or empty.' });
      case 'thresholdInvalid':
        return t('prepaidBlock.errors.thresholdInvalid', { defaultValue: 'The usage threshold must be a whole percentage from 1 to 99, or empty.' });
      default:
        return t('prepaidBlock.errors.serviceRequired', { defaultValue: 'The line needs at least one hourly service.' });
    }
  };

  const soldAsRate = (d: PrepaidBlockConfigDraft): number | undefined => {
    const services = summary?.covered_services ?? [];
    const id = d.soldAsServiceId ?? services[0]?.service_id;
    return services.find((s) => s.service_id === id)?.hourly_rate;
  };

  const startEdit = () => {
    if (!config) return;
    setDraft(draftFromConfig(config));
    setDraftErrors([]);
    setActionErrorText(null);
    setEditing(true);
  };

  const save = async () => {
    if (!draft) return;
    const parsed = draftToInput(draft, soldAsRate(draft));
    if ('errors' in parsed) {
      setDraftErrors(parsed.errors.map(draftErrorText));
      return;
    }
    setBusy(true);
    setActionErrorText(null);
    try {
      const result = await upsertContractLinePrepaidBlock(contractLineId, parsed.input);
      if (isActionFailure(result)) {
        setActionErrorText(getErrorMessage(result));
        return;
      }
      setWarnings((result as { warnings: PrepaidBlockConfigWarning[] }).warnings ?? []);
      setEditing(false);
      await reload();
      onChanged?.();
    } catch (error) {
      setActionErrorText(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setActionErrorText(null);
    try {
      const result = await removeContractLinePrepaidBlock(contractLineId);
      if (isActionFailure(result)) {
        setActionErrorText(getErrorMessage(result));
        return;
      }
      await reload();
      onChanged?.();
    } catch (error) {
      setActionErrorText(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const issueNext = async () => {
    setBusy(true);
    setActionErrorText(null);
    try {
      const result = await issueNextPrepaidBlock(contractLineId);
      if (isActionFailure(result)) {
        setActionErrorText(getErrorMessage(result));
        return;
      }
      await reload();
      onChanged?.();
    } catch (error) {
      setActionErrorText(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const money = (minor: number, code?: string) => {
    const c = code || currency;
    return c ? formatCurrencyFromMinorUnits(minor, locale, c) : String(minor);
  };
  const hours = (minutes: number) =>
    t('prepaidBlock.hoursValue', { defaultValue: '{{hours}} h', hours: minutesToHoursText(minutes) });
  const dateText = (value: string | null) => (value ? formatDate(value, { dateStyle: 'medium' }) : '');

  const triggerLabel = (kind: string | null | undefined): string => {
    switch (kind) {
      case 'contract_start': return t('prepaidBlock.trigger.initial', { defaultValue: 'Initial block' });
      case 'exhaustion': return t('prepaidBlock.trigger.exhaustion', { defaultValue: 'Block ran out' });
      case 'threshold': return t('prepaidBlock.trigger.threshold', { defaultValue: 'Usage threshold' });
      case 'expiry': return t('prepaidBlock.trigger.expiry', { defaultValue: 'Block expired' });
      case 'renewal': return t('prepaidBlock.trigger.renewal', { defaultValue: 'Contract renewal' });
      case 'manual': return t('prepaidBlock.trigger.manual', { defaultValue: 'Issued manually' });
      default: return '';
    }
  };

  const statusLabel = (status: string): string =>
    t(`prepaidBlock.status.${status}`, { defaultValue: status });

  if (loadError) {
    return (
      <Alert variant="destructive" id={`${idPrefix}-load-error`}>
        <AlertDescription>{loadError}</AlertDescription>
      </Alert>
    );
  }
  if (!summary) {
    return (
      <div id={`${idPrefix}-loading`} className="text-sm text-muted-foreground">
        {t('prepaidBlock.loading', { defaultValue: 'Loading prepaid block details...' })}
      </div>
    );
  }
  if (!config) return null;

  const balance = summary.balance;
  const usedPercent = balance.total_minutes > 0
    ? Math.min(100, Math.max(0, Math.round(((balance.total_minutes - balance.remaining_minutes) / balance.total_minutes) * 100)))
    : 0;
  // A scheduled expiry issuance is a date obligation, not an open follow-on: a manual block may replace it.
  const hasOpenFollowOn = Boolean(
    summary.pending_block || (summary.next_issuance && summary.next_issuance.trigger_kind !== 'expiry'),
  );
  const soldAsName = summary.covered_services.find((s) => s.service_id === config.sold_as_service_id)?.service_name;

  return (
    <div id={`${idPrefix}-panel`} className="space-y-4 rounded-lg border border-[rgb(var(--color-border-200))] p-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">
          {t('prepaidBlock.heading', { defaultValue: 'Prepaid Block' })}
        </h4>
        {!isReadOnly && !editing && (
          <div className="flex gap-2">
            <Button id={`${idPrefix}-edit`} type="button" variant="outline" size="sm" disabled={busy} onClick={startEdit}>
              <Pencil className="mr-1 h-3 w-3" />
              {t('prepaidBlock.actions.edit', { defaultValue: 'Edit' })}
            </Button>
            <Button id={`${idPrefix}-remove`} type="button" variant="outline" size="sm" disabled={busy} onClick={remove}>
              <Trash2 className="mr-1 h-3 w-3" />
              {t('prepaidBlock.actions.remove', { defaultValue: 'Remove block config' })}
            </Button>
          </div>
        )}
      </div>

      {actionErrorText && (
        <Alert variant="destructive" id={`${idPrefix}-action-error`}>
          <AlertDescription>{actionErrorText}</AlertDescription>
        </Alert>
      )}

      {warnings.length > 0 && (
        <Alert variant="warning" id={`${idPrefix}-warnings`}>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <ul className="list-disc pl-4">
              {warnings.map((w) => (
                <li key={`${w.service_id}-${w.other_contract_line_id}`}>
                  {t('prepaidBlock.warnings.coveredServiceOnOtherLine', {
                    defaultValue: '{{service}} is also on another active line ({{line}}). Time for it may bill there instead of drawing from this block.',
                    service: w.service_name,
                    line: w.other_contract_line_name,
                  })}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {editing && draft ? (
        <div className="space-y-3">
          <PrepaidBlockConfigFields
            idPrefix={`${idPrefix}-edit`}
            value={draft}
            onChange={setDraft}
            currencyCode={currency}
            coveredServices={summary.covered_services}
            disabled={busy}
            errors={draftErrors}
          />
          <div className="flex justify-end gap-2">
            <Button id={`${idPrefix}-edit-cancel`} type="button" variant="outline" size="sm" disabled={busy} onClick={() => setEditing(false)}>
              {t('prepaidBlock.actions.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button id={`${idPrefix}-edit-save`} type="button" size="sm" disabled={busy} onClick={save}>
              {t('prepaidBlock.actions.save', { defaultValue: 'Save' })}
            </Button>
          </div>
        </div>
      ) : (
        <dl id={`${idPrefix}-config`} className="grid gap-x-6 gap-y-2 text-sm md:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">{t('prepaidBlock.summary.block', { defaultValue: 'Block' })}</dt>
            <dd id={`${idPrefix}-config-block`}>
              {hours(Number(config.block_minutes))} / {money(Number(config.block_price))}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
                {isCadenceBlock(config)
                  ? t('prepaidBlock.fields.rolloverPeriods', { defaultValue: 'Unused hours' })
                  : t('prepaidBlock.summary.expiry', { defaultValue: 'Expiry' })}
              </dt>
            <dd id={`${idPrefix}-config-expiry`}>
              {isCadenceBlock(config)
                ? describeRollover(t, Number(config.rollover_periods ?? 0))
                : config.expiry_months == null
                ? t('prepaidBlock.summary.neverExpires', { defaultValue: 'Never expires' })
                : t('prepaidBlock.summary.expiresAfterMonths', { defaultValue: '{{months}} months', months: config.expiry_months })}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('prepaidBlock.summary.soldAs', { defaultValue: 'Sold as' })}</dt>
            <dd id={`${idPrefix}-config-sold-as`}>{soldAsName ?? ''}</dd>
          </div>
          <div className="md:col-span-3">
            <dt className="text-muted-foreground">{isCadenceBlock(config)
                ? t('prepaidBlock.fields.issueMode', { defaultValue: 'Issue blocks' })
                : t('prepaidBlock.summary.triggers', { defaultValue: 'Next block is invoiced when' })}</dt>
            <dd id={`${idPrefix}-config-triggers`} className="flex flex-wrap gap-1 pt-1">
              {isCadenceBlock(config) && <Badge variant="default-muted">{t('prepaidBlock.fields.issueModeCadence', { defaultValue: 'Every billing period' })}</Badge>}
              {config.trigger_on_exhaustion && <Badge variant="default-muted">{t('prepaidBlock.summary.onExhaustion', { defaultValue: 'The block runs out' })}</Badge>}
              {config.trigger_threshold_percent != null && (
                <Badge variant="default-muted">
                  {t('prepaidBlock.summary.onThreshold', { defaultValue: '{{percent}}% used', percent: config.trigger_threshold_percent })}
                </Badge>
              )}
              {config.trigger_on_expiry && <Badge variant="default-muted">{t('prepaidBlock.summary.onExpiry', { defaultValue: 'The block expires' })}</Badge>}
              {config.trigger_on_renewal && <Badge variant="default-muted">{t('prepaidBlock.summary.onRenewal', { defaultValue: 'The contract renews' })}</Badge>}
              {!isCadenceBlock(config) && (
              <Badge variant="outline">
                {config.replenishment_tier === 'auto_issue'
                  ? t('prepaidBlock.summary.tierAutoIssue', { defaultValue: 'Finalized automatically' })
                  : t('prepaidBlock.summary.tierDraft', { defaultValue: 'Draft for review' })}
              </Badge>
              )}
            </dd>
          </div>
        </dl>
      )}
      {config && isCadenceBlock(config) && !editing && (
        <p id={`${idPrefix}-fee-in-advance-note`} className="text-xs text-muted-foreground">
          {t('prepaidBlock.fields.blockFeeInAdvance', { defaultValue: 'The line bills in arrears; the block fee bills in advance.' })}
        </p>
      )}

      <div id={`${idPrefix}-balance`} className="space-y-1">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t('prepaidBlock.balance.label', { defaultValue: 'Active balance' })}</span>
          <span id={`${idPrefix}-balance-value`}>
            {t('prepaidBlock.balance.value', {
              defaultValue: '{{remaining}} of {{total}} remaining',
              remaining: hours(balance.remaining_minutes),
              total: hours(balance.total_minutes),
            })}
          </span>
        </div>
        <div
          id={`${idPrefix}-balance-meter`}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={usedPercent}
          className="h-2 w-full overflow-hidden rounded-full bg-[rgb(var(--color-border-200))]"
        >
          <div className="h-full bg-[rgb(var(--color-primary-500))]" style={{ width: `${usedPercent}%` }} />
        </div>
        {balance.active_block_count === 0 && summary.assignment_ended && (
          <p className="text-xs text-muted-foreground">
            {t('prepaidBlock.balance.contractEnded', { defaultValue: 'Contract ended; remaining hours were forfeited.' })}
          </p>
        )}
        {balance.active_block_count === 0 && !summary.assignment_ended && (
          <p className="text-xs text-muted-foreground">
            {t('prepaidBlock.balance.none', { defaultValue: 'No active block yet. A block activates when its invoice is finalized.' })}
          </p>
        )}
      </div>

      {summary.pending_block && (
        <div id={`${idPrefix}-pending`} className="rounded-md border border-[rgb(var(--badge-warning-border))] bg-[rgb(var(--badge-warning-bg))] p-3 text-sm">
          <div className="font-medium">
            {t('prepaidBlock.pending.heading', { defaultValue: 'Pending block awaiting invoice finalization' })}
          </div>
          <div>
            {hours(summary.pending_block.total_minutes)}
            {' - '}
            {summary.pending_block.invoice_id ? (
              <Link
                id={`${idPrefix}-pending-invoice-link`}
                className="underline"
                href={`/msp/billing?tab=invoicing&subtab=drafts&invoiceId=${summary.pending_block.invoice_id}`}
              >
                {summary.pending_block.invoice_number
                  ?? t('prepaidBlock.pending.draftInvoice', { defaultValue: 'Draft invoice' })}
              </Link>
            ) : (
              <span>{t('prepaidBlock.pending.noInvoice', { defaultValue: 'No invoice linked' })}</span>
            )}
            {' - '}
            <span id={`${idPrefix}-pending-age`}>
              {t('prepaidBlock.pending.ageDays', { defaultValue: '{{days}} days old', days: summary.pending_block.age_days })}
            </span>
          </div>
          {summary.pending_block.held_minutes > 0 && (
            <div className="text-xs">
              {t('prepaidBlock.pending.held', {
                defaultValue: '{{hours}} of logged time is held until this block activates.',
                hours: hours(summary.pending_block.held_minutes),
              })}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 text-sm">
        <div id={`${idPrefix}-next-issuance`}>
          <span className="text-muted-foreground">{t('prepaidBlock.next.label', { defaultValue: 'Next scheduled issuance' })}:</span>{' '}
          {summary.next_issuance
            ? `${triggerLabel(summary.next_issuance.trigger_kind)} (${dateText(summary.next_issuance.due_date)})`
            : t('prepaidBlock.next.none', { defaultValue: 'None' })}
        </div>
        {!isReadOnly && !isCadenceBlock(config) && (
          <Button
            id={`${idPrefix}-issue-next`}
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || hasOpenFollowOn || summary.assignment_ended}
            onClick={issueNext}
          >
            {t('prepaidBlock.actions.issueNext', { defaultValue: 'Issue next block' })}
          </Button>
        )}
      </div>

      <div id={`${idPrefix}-history`}>
        <h5 className="mb-1 text-sm font-medium">{t('prepaidBlock.history.heading', { defaultValue: 'Block history' })}</h5>
        {summary.history.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('prepaidBlock.history.empty', { defaultValue: 'No blocks have been issued yet.' })}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 pr-2 font-normal">{t('prepaidBlock.history.columns.issued', { defaultValue: 'Issued' })}</th>
                <th className="py-1 pr-2 font-normal">{t('prepaidBlock.history.columns.reason', { defaultValue: 'Reason' })}</th>
                <th className="py-1 pr-2 font-normal">{t('prepaidBlock.history.columns.status', { defaultValue: 'Status' })}</th>
                <th className="py-1 pr-2 font-normal">{t('prepaidBlock.history.columns.hours', { defaultValue: 'Remaining' })}</th>
                <th className="py-1 pr-2 font-normal">{t('prepaidBlock.history.columns.amount', { defaultValue: 'Amount' })}</th>
                <th className="py-1 font-normal">{t('prepaidBlock.history.columns.invoice', { defaultValue: 'Invoice' })}</th>
              </tr>
            </thead>
            <tbody>
              {summary.history.map((row) => (
                <tr key={row.block_id} id={`${idPrefix}-history-row-${row.block_id}`}>
                  <td className="py-1 pr-2">{dateText(row.purchased_at ?? row.created_at)}</td>
                  <td className="py-1 pr-2">{triggerLabel(row.trigger_kind)}</td>
                  <td className="py-1 pr-2">{statusLabel(row.status)}</td>
                  <td className="py-1 pr-2">{hours(row.remaining_minutes)} / {hours(row.total_minutes)}</td>
                  <td className="py-1 pr-2">{money(Number(row.purchase_amount), row.currency_code)}</td>
                  <td className="py-1">
                    {row.invoice_id ? (
                      <Link
                        id={`${idPrefix}-history-invoice-${row.block_id}`}
                        className="underline"
                        href={`/msp/billing?tab=invoicing&subtab=drafts&invoiceId=${row.invoice_id}`}
                      >
                        {row.invoice_number ?? t('prepaidBlock.pending.draftInvoice', { defaultValue: 'Draft invoice' })}
                      </Link>
                    ) : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default PrepaidBlockPanel;
