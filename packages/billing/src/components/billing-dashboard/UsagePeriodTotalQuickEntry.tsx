'use client';
import React, { useEffect, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { IUsageServicePeriodStatus } from '@alga-psa/types';
import { Input } from '@alga-psa/ui/components/Input';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { upsertUsagePeriodTotal } from '../../actions/usagePeriodTotalActions';

/**
 * Inline "report a period count" field for a due usage service that uses
 * period-total measurement. Lives in the invoice preview so the operator can
 * report (or correct) the whole-period count for the affected client, service,
 * contract line, and service period without leaving the preview selection.
 *
 * Server-side scope/eligibility validation is owned by
 * upsertUsagePeriodTotal (measurement mode, membership, assignment, quantity,
 * period, revision). After a successful save the preview is recomputed for the
 * same selection, so the operator verifies the intended amount in place.
 */
export const UsagePeriodTotalQuickEntry: React.FC<{
  status: IUsageServicePeriodStatus;
  clientId: string | null;
  entryId: string;
  onSaved: () => void;
  /**
   * Present when correcting an already-reported total: the reported quantity
   * and the revision the operator is looking at. The write then carries
   * expected_revision so a blind overwrite of someone else's newer report is
   * refused instead of applied.
   */
  existing?: { quantity: number; revision: number };
}> = ({ status, clientId, entryId, onSaved, existing }) => {
  const {t} = useTranslation('msp/invoicing');
  const [draft, setDraft] = useState(existing ? String(existing.quantity) : '');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // One request id per content attempt: retries of the same submission replay
  // idempotently, while changing the value issues a fresh request.
  const [requestId, setRequestId] = useState<string>(() => uuidv4());
  useEffect(() => { setDraft(existing ? String(existing.quantity) : ''); setRequestId(uuidv4()); }, [existing?.revision, existing?.quantity]);

  const save = async () => {
    if (!clientId || !status.config_id) {
      setSaveError(t('periodTotal.missingContext', {defaultValue: 'Missing client or service configuration for this report.'}));
      return;
    }
    const quantity = Number(draft);
    if (draft === '' || !Number.isInteger(quantity) || quantity < 0) {
      setSaveError(t('periodTotal.invalidQuantity', {defaultValue: 'Enter a whole number of 0 or more for the period count.'}));
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
    const result = await upsertUsagePeriodTotal({
      client_id: clientId,
      client_contract_line_id: status.client_contract_line_id,
      service_id: status.service_id,
      config_id: status.config_id,
      period_start: status.service_period_start,
      period_end: status.service_period_end,
      quantity,
      request_id: requestId,
      ...(existing ? { expected_revision: existing.revision } : {}),
    });
    const failure = (result as unknown) as { actionError?: string; permissionError?: string };
    if (failure && (failure.actionError || failure.permissionError)) {
      setSaveError(failure.actionError ?? failure.permissionError ?? t('periodTotal.saveError', {defaultValue: 'Unable to save the period count.'}));
      setIsSaving(false);
      return;
    }
    setDraft('');
    setIsSaving(false);
    onSaved();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : t('periodTotal.retryError', {defaultValue: 'Unable to save the period count. Retry this submission.'}));
    } finally { setIsSaving(false); }
  };

  return (
    <li key={entryId} className="flex flex-wrap items-center gap-2" data-testid={`period-total-entry-${entryId}`}>
      <span>
        {t(existing ? 'periodTotal.correct' : 'periodTotal.report', {service: status.service_name ?? status.service_id, quantity: existing?.quantity, periodStart: status.service_period_start, periodEnd: status.service_period_end, defaultValue: existing ? tReportedPeriodTotalCopy(status, existing.quantity) : tMissingPeriodTotalCopy(status)})}
      </span>
      <Input
        id={`period-total-quantity-${entryId}`}
        type="number"
        min={0}
        step={1}
        value={draft}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
          setDraft(event.target.value);
          // Changed content is a new request; only unchanged retries replay.
          setRequestId(uuidv4());
        }}
        placeholder="0"
        className="w-24"
        aria-label={t('periodTotal.quantityLabel', {service: status.service_name ?? status.service_id, defaultValue: `Period count for ${status.service_name ?? status.service_id}`})}
      />
      <Button
        id={`period-total-save-${entryId}`}
        size="sm"
        variant="outline"
        disabled={isSaving}
        onClick={() => void save()}
      >
        {isSaving ? t('periodTotal.saving', {defaultValue: 'Saving…'}) : existing ? t('periodTotal.saveCorrection', {defaultValue: 'Save correction'}) : t('periodTotal.save', {defaultValue: 'Save'})}
      </Button>
      {saveError && <span className="text-xs text-[rgb(var(--badge-danger-text))]">{saveError}</span>}
    </li>
  );
};

function tMissingPeriodTotalCopy(status: IUsageServicePeriodStatus): string {
  const period = `${status.service_period_start} to ${status.service_period_end}`;
  return `Report a period count for ${status.service_name ?? status.service_id} (${period})`;
}

function tReportedPeriodTotalCopy(status: IUsageServicePeriodStatus, quantity: number): string {
  const period = `${status.service_period_start} to ${status.service_period_end}`;
  return `Correct the reported count of ${quantity} for ${status.service_name ?? status.service_id} (${period})`;
}
