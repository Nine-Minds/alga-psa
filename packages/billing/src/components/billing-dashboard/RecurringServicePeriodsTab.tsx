'use client';

import React, { startTransition, useEffect, useMemo, useState } from 'react';
import type { ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import {
  getRecurringServicePeriodManagementView,
  previewRecurringServicePeriodRegeneration,
  type PreviewRecurringServicePeriodRegenerationInput,
  type RecurringServicePeriodManagementView,
} from '@alga-psa/billing/actions/recurringServicePeriodActions';

type ManagementViewResult = RecurringServicePeriodManagementView | ActionPermissionError;
type RegenerationPreviewResult =
  | Awaited<ReturnType<typeof previewRecurringServicePeriodRegeneration>>
  | null;

function isPermissionError(value: unknown): value is ActionPermissionError {
  return Boolean(
    value
      && typeof value === 'object'
      && 'permissionError' in (value as Record<string, unknown>),
  );
}

function formatRange(start: string, end: string) {
  return `${start} to ${end}`;
}

function allowedGovernanceActions(view: RecurringServicePeriodManagementView['rows'][number]) {
  return view.governance
    .filter((requirement) => requirement.allowed)
    .map((requirement) => requirement.action.replaceAll('_', ' '));
}

interface RecurringServicePeriodsTabProps {
  initialScheduleKey?: string;
}

const RecurringServicePeriodsTab: React.FC<RecurringServicePeriodsTabProps> = ({
  initialScheduleKey,
}) => {
  const [scheduleKeyInput, setScheduleKeyInput] = useState(initialScheduleKey ?? '');
  const [view, setView] = useState<RecurringServicePeriodManagementView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidateRecordsJson, setCandidateRecordsJson] = useState('[]');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [regenerationPreview, setRegenerationPreview] = useState<RegenerationPreviewResult>(null);

  const loadView = async (targetScheduleKey: string) => {
    const normalized = targetScheduleKey.trim();
    if (!normalized) {
      setError('Enter a schedule key to inspect recurring service periods.');
      setView(null);
      return;
    }

    setLoading(true);
    setError(null);
    setRegenerationPreview(null);

    try {
      const result: ManagementViewResult = await getRecurringServicePeriodManagementView(normalized);
      if (isPermissionError(result)) {
        setView(null);
        setError(result.permissionError);
        return;
      }

      setView(result);
      setScheduleKeyInput(result.scheduleKey);
    } catch (loadError) {
      setView(null);
      setError(loadError instanceof Error ? loadError.message : 'Failed to load recurring service periods.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!initialScheduleKey) {
      return;
    }

    startTransition(() => {
      void loadView(initialScheduleKey);
    });
  }, [initialScheduleKey]);

  const contextLabel = useMemo(() => {
    if (!view) {
      return null;
    }

    if (view.contractName || view.contractLineName) {
      return [view.contractName, view.contractLineName].filter(Boolean).join(' / ');
    }

    return view.clientName ?? view.obligationId;
  }, [view]);

  const handlePreviewRegeneration = async () => {
    if (!view) {
      return;
    }

    setPreviewLoading(true);
    setError(null);

    try {
      const parsed = JSON.parse(candidateRecordsJson);
      if (!Array.isArray(parsed)) {
        throw new Error('Candidate records JSON must be an array.');
      }

      const input: PreviewRecurringServicePeriodRegenerationInput = {
        existingRecords: view.rows.map((row) => row.record),
        candidateRecords: parsed,
        regeneratedAt: new Date().toISOString(),
        sourceRuleVersion: 'operator-service-period-preview',
        sourceRunKey: `operator-preview:${view.scheduleKey}`,
      };

      const result = await previewRecurringServicePeriodRegeneration(input);
      setRegenerationPreview(result);
      if (isPermissionError(result)) {
        setError(result.permissionError);
      }
    } catch (previewError) {
      setRegenerationPreview(null);
      setError(
        previewError instanceof Error
          ? previewError.message
          : 'Failed to preview recurring service-period regeneration.',
      );
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="recurring-service-periods-tab">
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold">Service Periods</h2>
        <p className="text-sm text-muted-foreground">
          Inspect persisted recurring service periods for one obligation, including future generated rows,
          edited exceptions, and billed history linked to invoice detail.
        </p>
      </div>

      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-end">
          <label className="flex-1 text-sm font-medium">
            Schedule Key
            <input
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              value={scheduleKeyInput}
              onChange={(event) => setScheduleKeyInput(event.target.value)}
              placeholder="schedule:tenant:obligation:..."
            />
          </label>
          <button
            type="button"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            onClick={() => {
              startTransition(() => {
                void loadView(scheduleKeyInput);
              });
            }}
            disabled={loading}
          >
            {loading ? 'Loading…' : 'Load Service Periods'}
          </button>
        </div>
        {error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}
      </div>

      {view ? (
        <>
          <div className="rounded-lg border p-4 space-y-2">
            <div className="text-sm text-muted-foreground">Obligation</div>
            <div className="text-lg font-semibold">{contextLabel}</div>
            <div className="grid gap-2 text-sm md:grid-cols-3">
              <div>
                <span className="font-medium">Client:</span> {view.clientName ?? 'Not linked'}
              </div>
              <div>
                <span className="font-medium">Cadence:</span> {view.cadenceOwner} / {view.duePosition}
              </div>
              <div>
                <span className="font-medium">Charge family:</span> {view.chargeFamily}
              </div>
              <div className="md:col-span-3 break-all">
                <span className="font-medium">Schedule key:</span> {view.scheduleKey}
              </div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-lg border p-4">
              <div className="text-sm text-muted-foreground">Generated</div>
              <div className="text-2xl font-semibold">{view.summary.generatedRows}</div>
            </div>
            <div className="rounded-lg border p-4">
              <div className="text-sm text-muted-foreground">Edited</div>
              <div className="text-2xl font-semibold">{view.summary.editedRows}</div>
            </div>
            <div className="rounded-lg border p-4">
              <div className="text-sm text-muted-foreground">Billed</div>
              <div className="text-2xl font-semibold">{view.summary.billedRows}</div>
            </div>
            <div className="rounded-lg border p-4">
              <div className="text-sm text-muted-foreground">Exceptions</div>
              <div className="text-2xl font-semibold">{view.summary.exceptionRows}</div>
            </div>
          </div>

          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm" data-testid="recurring-service-periods-table">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">State</th>
                  <th className="px-4 py-3 font-medium">Service Period</th>
                  <th className="px-4 py-3 font-medium">Invoice Window</th>
                  <th className="px-4 py-3 font-medium">Revision</th>
                  <th className="px-4 py-3 font-medium">Reason</th>
                  <th className="px-4 py-3 font-medium">Allowed Actions</th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((row) => (
                  <tr key={row.record.recordId} className="border-t align-top">
                    <td className="px-4 py-3">
                      <div className="font-medium">{row.displayState.label}</div>
                      <div className="text-xs text-muted-foreground">{row.displayState.detail}</div>
                    </td>
                    <td className="px-4 py-3">{formatRange(row.record.servicePeriod.start, row.record.servicePeriod.end)}</td>
                    <td className="px-4 py-3">{formatRange(row.record.invoiceWindow.start, row.record.invoiceWindow.end)}</td>
                    <td className="px-4 py-3">r{row.record.revision}</td>
                    <td className="px-4 py-3">{row.displayState.reasonLabel ?? 'Generated from source cadence'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {allowedGovernanceActions(row).map((action) => (
                          <span
                            key={`${row.record.recordId}:${action}`}
                            className="rounded-full border px-2 py-0.5 text-xs"
                          >
                            {action}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg border p-4 space-y-3">
            <div>
              <h3 className="text-lg font-semibold">Regeneration Preview</h3>
              <p className="text-sm text-muted-foreground">
                Paste candidate records JSON to preview how preserved edited or billed rows would conflict with
                regenerated future candidates for this schedule.
              </p>
            </div>
            <label className="block text-sm font-medium">
              Candidate Records JSON
              <textarea
                className="mt-1 min-h-40 w-full rounded-md border px-3 py-2 font-mono text-xs"
                value={candidateRecordsJson}
                onChange={(event) => setCandidateRecordsJson(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50"
              onClick={() => {
                startTransition(() => {
                  void handlePreviewRegeneration();
                });
              }}
              disabled={previewLoading}
            >
              {previewLoading ? 'Previewing…' : 'Preview Regeneration'}
            </button>

            {regenerationPreview && !isPermissionError(regenerationPreview) ? (
              <div className="space-y-2" data-testid="regeneration-preview">
                <div className="text-sm">
                  Conflicts: <span className="font-semibold">{regenerationPreview.conflicts.length}</span>
                </div>
                {regenerationPreview.conflicts.length > 0 ? (
                  <ul className="space-y-2 text-sm">
                    {regenerationPreview.conflicts.map((conflict) => (
                      <li
                        key={`${conflict.recordId}:${conflict.kind}`}
                        className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2"
                      >
                        <div className="font-medium">
                          {conflict.kind.replaceAll('_', ' ')}: {conflict.recordId}
                        </div>
                        <div className="text-muted-foreground">{conflict.reason}</div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm">
                    No regeneration conflicts were detected for the supplied candidates.
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
};

export default RecurringServicePeriodsTab;
