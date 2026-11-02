'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { describeRollover, isCadenceBlock } from './prepaidBlockLabels';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { useCurrencyFormat } from '@alga-psa/ui/lib';
import {
  getTemplateLinePrepaidBlock,
  removeTemplateLinePrepaidBlock,
  upsertTemplateLinePrepaidBlock,
  type TemplateLinePrepaidBlockView,
} from '@alga-psa/billing/actions/prepaidBlockActions';
import PrepaidBlockConfigFields from './PrepaidBlockConfigFields';
import { usePrepaidBlockDraftErrorText } from './PrepaidBlockLinesEditor';
import {
  draftFromConfig,
  draftToInput,
  emptyPrepaidBlockDraft,
  minutesToHoursText,
  type PrepaidBlockConfigDraft,
} from './prepaidBlockConfigDraft';
import { useTemplateMoney } from './useTemplateMoney';

interface TemplatePrepaidBlockPanelProps {
  /** contract_template_lines.template_line_id of an Hourly template line. */
  templateLineId: string;
  /** The template's base currency; falls back to the ambient authoring currency. */
  currencyCode?: string;
  isReadOnly?: boolean;
  /** Called after a save/remove with whether the line now has a block config (to update the badge). */
  onChanged?: (hasConfig: boolean) => void;
}

const isActionFailure = (value: unknown): boolean =>
  isActionMessageError(value) || isActionPermissionError(value);

/**
 * Display and edit of a template line's Prepaid Block config
 * (contract_template_line_prepaid_blocks). The price is stored and shown in the
 * template's base currency; it is copied as-is when a contract is created.
 */
export const TemplatePrepaidBlockPanel: React.FC<TemplatePrepaidBlockPanelProps> = ({
  templateLineId,
  currencyCode,
  isReadOnly = false,
  onChanged,
}) => {
  const { t } = useTranslation('msp/contracts');
  const idPrefix = `template-prepaid-block-${templateLineId}`;
  const { currencyCode: authoringCurrency } = useCurrencyFormat();
  const templateCurrency = currencyCode ?? authoringCurrency;
  const formatTemplateAmount = useTemplateMoney(templateCurrency);
  const errorText = usePrepaidBlockDraftErrorText();

  const [view, setView] = useState<TemplateLinePrepaidBlockView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionErrorText, setActionErrorText] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PrepaidBlockConfigDraft | null>(null);
  const [draftErrors, setDraftErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const result = await getTemplateLinePrepaidBlock(templateLineId);
      if (isActionFailure(result)) {
        setLoadError(getErrorMessage(result));
        return;
      }
      setLoadError(null);
      setView(result as TemplateLinePrepaidBlockView);
    } catch (error) {
      setLoadError(getErrorMessage(error));
    }
  }, [templateLineId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (loadError) {
    return (
      <Alert variant="destructive" id={`${idPrefix}-load-error`}>
        <AlertDescription>{loadError}</AlertDescription>
      </Alert>
    );
  }
  if (!view) return null;

  const config = view.config;
  const coveredServices = view.services.map((s) => ({ service_id: s.service_id, service_name: s.service_name }));
  const soldAsName = coveredServices.find((s) => s.service_id === config?.sold_as_service_id)?.service_name;

  const startEdit = (existing: boolean) => {
    setDraft(existing && config ? draftFromConfig(config) : emptyPrepaidBlockDraft());
    setDraftErrors([]);
    setActionErrorText(null);
    setEditing(true);
  };

  const save = async () => {
    if (!draft) return;
    // Template services carry no required rate, so the price must be entered explicitly.
    const parsed = draftToInput(draft, undefined);
    if ('errors' in parsed) {
      setDraftErrors(parsed.errors.map(errorText));
      return;
    }
    setBusy(true);
    setActionErrorText(null);
    try {
      const result = await upsertTemplateLinePrepaidBlock(templateLineId, parsed.input);
      if (isActionFailure(result)) {
        setActionErrorText(getErrorMessage(result));
        return;
      }
      setEditing(false);
      await reload();
      onChanged?.(true);
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
      const result = await removeTemplateLinePrepaidBlock(templateLineId);
      if (isActionFailure(result)) {
        setActionErrorText(getErrorMessage(result));
        return;
      }
      await reload();
      onChanged?.(false);
    } catch (error) {
      setActionErrorText(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  if (!config && !editing) {
    if (isReadOnly || coveredServices.length === 0) return null;
    return (
      <div className="mt-3">
        <Button id={`${idPrefix}-setup`} type="button" variant="outline" size="sm" onClick={() => startEdit(false)}>
          <Plus className="mr-1 h-3 w-3" />
          {t('templateDetail.prepaidBlock.setup', { defaultValue: 'Sell as a prepaid block' })}
        </Button>
      </div>
    );
  }

  return (
    <div id={`${idPrefix}-panel`} className="mt-3 space-y-3 rounded-md border border-[rgb(var(--color-border-200))] bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">
          {t('prepaidBlock.heading', { defaultValue: 'Prepaid Block' })}
        </h4>
        {!isReadOnly && !editing && config && (
          <div className="flex gap-2">
            <Button id={`${idPrefix}-edit`} type="button" variant="outline" size="sm" disabled={busy} onClick={() => startEdit(true)}>
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

      {editing && draft ? (
        <div className="space-y-3">
          <PrepaidBlockConfigFields
            idPrefix={`${idPrefix}-edit`}
            value={draft}
            onChange={setDraft}
            currencyCode={templateCurrency}
            coveredServices={coveredServices}
            disabled={busy}
            errors={draftErrors}
            neutralPrice
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
        config && (
          <dl id={`${idPrefix}-config`} className="grid gap-x-6 gap-y-2 text-sm md:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">{t('prepaidBlock.summary.block', { defaultValue: 'Block' })}</dt>
              <dd id={`${idPrefix}-config-block`}>
                {t('templateDetail.prepaidBlock.blockNeutral', {
                  defaultValue: "{{hours}} h / {{price}} (in the client's currency)",
                  hours: minutesToHoursText(Number(config.block_minutes)),
                  price: formatTemplateAmount(Number(config.block_price)),
                })}
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
        )
      )}
    </div>
  );
};

export default TemplatePrepaidBlockPanel;
