'use client';

import React, { startTransition, useEffect, useMemo, useState } from 'react';
import type { ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import {
  getRecurringServicePeriodManagementView,
  listRecurringServicePeriodScheduleSummaries,
  previewRecurringServicePeriodRegeneration,
  repairMissingRecurringServicePeriods,
  type PreviewRecurringServicePeriodRegenerationInput,
  type RepairRecurringServicePeriodMaterializationResult,
  type RecurringServicePeriodManagementView,
  type RecurringServicePeriodScheduleSummary,
} from '@alga-psa/billing/actions/recurringServicePeriodActions';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

type ManagementViewResult = RecurringServicePeriodManagementView | ActionPermissionError;
type RegenerationPreviewResult =
  | Awaited<ReturnType<typeof previewRecurringServicePeriodRegeneration>>
  | null;
type RepairResult = RepairRecurringServicePeriodMaterializationResult | null;
type ManagementRow = RecurringServicePeriodManagementView['rows'][number];
type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

function isPermissionError(value: unknown): value is ActionPermissionError {
  return Boolean(
    value
      && typeof value === 'object'
      && 'permissionError' in (value as Record<string, unknown>),
  );
}

function formatRange(start: string, end: string, t: TranslateFn) {
  return t('recurringServicePeriods.values.range', {
    start,
    end,
    defaultValue: '{{start}} to {{end}}',
  });
}

function allowedGovernanceActions(view: ManagementRow) {
  return view.governance
    .filter((requirement) => requirement.allowed)
    .map((requirement) => requirement.action);
}

function translateCadenceOwner(
  cadenceOwner: RecurringServicePeriodScheduleSummary['cadenceOwner'],
  t: TranslateFn,
) {
  return cadenceOwner === 'contract'
    ? t('recurringServicePeriods.values.contractAnniversary', {
      defaultValue: 'Contract anniversary',
    })
    : t('recurringServicePeriods.values.clientSchedule', {
      defaultValue: 'Client schedule',
    });
}

function translateDuePosition(
  duePosition: RecurringServicePeriodScheduleSummary['duePosition'],
  t: TranslateFn,
) {
  return duePosition === 'advance'
    ? t('recurringServicePeriods.values.advance', { defaultValue: 'Advance' })
    : t('recurringServicePeriods.values.arrears', { defaultValue: 'Arrears' });
}

function translateDisplayStateLabel(row: ManagementRow, t: TranslateFn) {
  return t(`recurringServicePeriods.displayStates.${row.record.lifecycleState}.label`, {
    defaultValue: row.displayState.label,
  });
}

function translateDisplayStateDetail(row: ManagementRow, t: TranslateFn) {
  if (row.record.lifecycleState === 'billed') {
    const invoiceChargeDetailId = row.record.invoiceLinkage?.invoiceChargeDetailId;

    return invoiceChargeDetailId
      ? t('recurringServicePeriods.displayStates.billed.detailLinked', {
        invoiceChargeDetailId,
        defaultValue: `Linked to invoice detail ${invoiceChargeDetailId}.`,
      })
      : t('recurringServicePeriods.displayStates.billed.detailUnlinked', {
        defaultValue: 'Linked to billed history.',
      });
  }

  return t(`recurringServicePeriods.displayStates.${row.record.lifecycleState}.detail`, {
    defaultValue: row.displayState.detail,
  });
}

function translateReasonCode(
  reasonCode: string | null | undefined,
  fallbackLabel: string | null | undefined,
  t: TranslateFn,
) {
  if (!reasonCode) {
    return t('recurringServicePeriods.values.generatedFromSourceCadence', {
      defaultValue: fallbackLabel ?? 'Generated from source cadence',
    });
  }

  return t(`recurringServicePeriods.provenanceReasons.${reasonCode}`, {
    defaultValue: fallbackLabel ?? reasonCode.replaceAll('_', ' '),
  });
}

function translateGovernanceAction(action: string, t: TranslateFn) {
  return t(`recurringServicePeriods.governanceActions.${action}`, {
    defaultValue: action.replaceAll('_', ' '),
  });
}

function translateConflictKind(kind: string, t: TranslateFn) {
  return t(`recurringServicePeriods.conflicts.kinds.${kind}`, {
    defaultValue: kind.replaceAll('_', ' '),
  });
}

function translateConflictReason(kind: string, reason: string, t: TranslateFn) {
  return t(`recurringServicePeriods.conflicts.reasons.${kind}`, {
    defaultValue: reason,
  });
}

interface RecurringServicePeriodsTabProps {
  initialScheduleKey?: string;
}

const RecurringServicePeriodsTab: React.FC<RecurringServicePeriodsTabProps> = ({
  initialScheduleKey,
}) => {
  const { t } = useTranslation('msp/invoicing');
  const [scheduleOptions, setScheduleOptions] = useState<RecurringServicePeriodScheduleSummary[]>([]);
  const [selectedScheduleKey, setSelectedScheduleKey] = useState<string>('');
  const [scheduleKeyInput, setScheduleKeyInput] = useState(initialScheduleKey ?? '');
  const [view, setView] = useState<RecurringServicePeriodManagementView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidateRecordsJson, setCandidateRecordsJson] = useState('[]');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [regenerationPreview, setRegenerationPreview] = useState<RegenerationPreviewResult>(null);
  const [repairLoading, setRepairLoading] = useState(false);
  const [repairResult, setRepairResult] = useState<RepairResult>(null);

  const loadView = async (
    targetScheduleKey: string,
    options: { clearRepairResult?: boolean } = {},
  ) => {
    const normalized = targetScheduleKey.trim();
    if (!normalized) {
      setError(t('recurringServicePeriods.errors.enterScheduleKey', {
        defaultValue: 'Enter a schedule key to inspect recurring service periods.',
      }));
      setView(null);
      return;
    }

    setLoading(true);
    setError(null);
    setRegenerationPreview(null);
    if (options.clearRepairResult !== false) {
      setRepairResult(null);
    }

    try {
      const result: ManagementViewResult = await getRecurringServicePeriodManagementView(normalized);
      if (isPermissionError(result)) {
        setView(null);
        setError(result.permissionError);
        return;
      }

      setView(result);
      setScheduleKeyInput(result.scheduleKey);
      setSelectedScheduleKey(result.scheduleKey);
    } catch (loadError) {
      setView(null);
      setError(
        loadError instanceof Error
          ? loadError.message
          : t('recurringServicePeriods.errors.loadFailed', {
            defaultValue: 'Failed to load recurring service periods.',
          }),
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    startTransition(() => {
      void (async () => {
        try {
          const result = await listRecurringServicePeriodScheduleSummaries(100);
          if (!isPermissionError(result)) {
            setScheduleOptions(result);
          }
        } catch (_error) {
          // Keep the page usable with direct schedule-key entry even if list loading fails.
        }
      })();
    });
  }, []);

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

  const formatScheduleOptionLabel = (option: RecurringServicePeriodScheduleSummary) => {
    const cadenceLabel = translateCadenceOwner(option.cadenceOwner, t);
    const timingLabel = translateDuePosition(option.duePosition, t);
    const entityLabel = option.contractLineName ?? option.contractName ?? option.obligationId;

    return t('recurringServicePeriods.values.scheduleOptionLabel', {
      client: option.clientName ?? t('recurringServicePeriods.values.unknownClient', {
        defaultValue: 'Unknown client',
      }),
      entity: entityLabel,
      cadence: cadenceLabel,
      timing: timingLabel,
      defaultValue: '{{client}} · {{entity}} · {{cadence}} · {{timing}}',
    });
  };

  const handlePreviewRegeneration = async () => {
    if (!view || view.status !== 'ready') {
      return;
    }

    setPreviewLoading(true);
    setError(null);

    try {
      const parsed = JSON.parse(candidateRecordsJson);
      if (!Array.isArray(parsed)) {
        throw new Error(t('recurringServicePeriods.errors.candidateRecordsArray', {
          defaultValue: 'Candidate records JSON must be an array.',
        }));
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
          : t('recurringServicePeriods.errors.previewFailed', {
            defaultValue: 'Failed to preview recurring service-period regeneration.',
          }),
      );
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleRepairMissingRows = async () => {
    if (!view || view.status !== 'repair_required') {
      return;
    }

    setRepairLoading(true);
    setError(null);

    try {
      const result = await repairMissingRecurringServicePeriods(view.scheduleKey);
      if (isPermissionError(result)) {
        setError(result.permissionError);
        return;
      }

      setRepairResult(result);
      await loadView(view.scheduleKey, { clearRepairResult: false });
    } catch (repairError) {
      setError(
        repairError instanceof Error
          ? repairError.message
          : t('recurringServicePeriods.errors.repairFailed', {
            defaultValue: 'Failed to repair recurring service-period materialization.',
          }),
      );
    } finally {
      setRepairLoading(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="recurring-service-periods-tab">
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold">
          {t('recurringServicePeriods.title', {
            defaultValue: 'Recurring Service Periods',
          })}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t('recurringServicePeriods.description', {
            defaultValue: 'Review recurring invoice coverage windows for a client contract line, troubleshoot why work is or is not due, and inspect billed history linked to invoice detail rows.',
          })}
        </p>
      </div>

      <div className="rounded-lg border p-4 space-y-3">
        <label className="block text-sm font-medium">
          {t('recurringServicePeriods.fields.scheduleSelect', {
            defaultValue: 'Choose a Schedule',
          })}
          <CustomSelect
            value={selectedScheduleKey}
            onValueChange={(value: string) => {
              setSelectedScheduleKey(value);
              setScheduleKeyInput(value);
            }}
            options={[
              {
                value: '',
                label: t('recurringServicePeriods.fields.scheduleSelectPlaceholder', {
                  defaultValue: 'Select a recent recurring schedule',
                }),
              },
              ...scheduleOptions.map((option) => ({
                value: option.scheduleKey,
                label: formatScheduleOptionLabel(option),
              })),
            ]}
            className="mt-1"
          />
        </label>
        <div className="flex flex-col gap-2 md:flex-row md:items-end">
          <label className="flex-1 text-sm font-medium">
            {t('recurringServicePeriods.fields.scheduleKey', {
              defaultValue: 'Schedule Key',
            })}
            <input
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              value={scheduleKeyInput}
              onChange={(event) => setScheduleKeyInput(event.target.value)}
              placeholder={t('recurringServicePeriods.fields.scheduleKeyPlaceholder', {
                defaultValue: 'Paste a schedule key (optional if selected above)',
              })}
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
            {loading
              ? t('recurringServicePeriods.actions.loadingSchedule', {
                defaultValue: 'Loading…',
              })
              : t('recurringServicePeriods.actions.openSchedule', {
                defaultValue: 'Open Schedule',
              })}
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
            <div className="text-sm text-muted-foreground">
              {t('recurringServicePeriods.labels.recurringObligation', {
                defaultValue: 'Recurring Obligation',
              })}
            </div>
            <div className="text-lg font-semibold">{contextLabel}</div>
            <div className="grid gap-2 text-sm md:grid-cols-3">
              <div>
                <span className="font-medium">
                  {t('recurringServicePeriods.fields.client', { defaultValue: 'Client' })}:
                </span>{' '}
                {view.clientName ?? t('recurringServicePeriods.values.notLinked', {
                  defaultValue: 'Not linked',
                })}
              </div>
              <div>
                <span className="font-medium">
                  {t('recurringServicePeriods.fields.cadenceSource', {
                    defaultValue: 'Cadence source',
                  })}
                  :
                </span>{' '}
                {translateCadenceOwner(view.cadenceOwner, t)}
              </div>
              <div>
                <span className="font-medium">
                  {t('recurringServicePeriods.fields.billingTiming', {
                    defaultValue: 'Billing timing',
                  })}
                  :
                </span>{' '}
                {translateDuePosition(view.duePosition, t)}
              </div>
              <div>
                <span className="font-medium">
                  {t('recurringServicePeriods.fields.chargeFamily', {
                    defaultValue: 'Charge family',
                  })}
                  :
                </span>{' '}
                {view.chargeFamily}
              </div>
              <div className="md:col-span-3 break-all">
                <span className="font-medium">
                  {t('recurringServicePeriods.fields.scheduleKeyLabel', {
                    defaultValue: 'Schedule key',
                  })}
                  :
                </span>{' '}
                {view.scheduleKey}
              </div>
            </div>
          </div>

          {repairResult ? (
            <div
              className="rounded-lg border border-success/30 bg-success/5 p-4 space-y-2"
              data-testid="repair-result"
            >
              <div className="text-sm font-medium">
                {t('recurringServicePeriods.labels.repairCompleted', {
                  defaultValue: 'Repair completed',
                })}
              </div>
              <div className="text-sm text-muted-foreground">
                {t('recurringServicePeriods.repairPanel.result', {
                  backfilled: repairResult.backfilledRows,
                  realigned: repairResult.realignedRows,
                  skipped: repairResult.skippedHistoricalCandidates,
                  active: repairResult.activeRows,
                  defaultValue: 'Backfilled {{backfilled}} rows, realigned {{realigned}}, skipped {{skipped}} historical candidates, and left {{active}} active rows on this schedule.',
                })}
              </div>
            </div>
          ) : null}

          {view.status === 'repair_required' ? (
            <div
              className="rounded-lg border border-warning/30 bg-warning/5 p-4 space-y-3"
              data-testid="recurring-service-period-repair-state"
            >
              <div>
                <h3 className="text-lg font-semibold">
                  {t('recurringServicePeriods.repairPanel.title', {
                    defaultValue: 'Missing persisted service periods',
                  })}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {t('recurringServicePeriods.repairPanel.description', {
                    defaultValue: 'This recurring schedule exists in live billing metadata but has no persisted service-period rows. Repair will materialize future rows only, preserve billed history boundaries, and stamp the new records with backfill provenance.',
                  })}
                </p>
              </div>
              <button
                type="button"
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                onClick={() => {
                  startTransition(() => {
                    void handleRepairMissingRows();
                  });
                }}
                disabled={repairLoading}
              >
                {repairLoading
                  ? t('recurringServicePeriods.actions.repairing', {
                    defaultValue: 'Repairing…',
                  })
                  : t('recurringServicePeriods.actions.repairMissing', {
                    defaultValue: 'Repair Missing Service Periods',
                  })}
              </button>
            </div>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-lg border p-4">
                  <div className="text-sm text-muted-foreground">
                    {t('recurringServicePeriods.labels.generated', {
                      defaultValue: 'Generated',
                    })}
                  </div>
                  <div className="text-2xl font-semibold">{view.summary.generatedRows}</div>
                </div>
                <div className="rounded-lg border p-4">
                  <div className="text-sm text-muted-foreground">
                    {t('recurringServicePeriods.labels.edited', {
                      defaultValue: 'Edited',
                    })}
                  </div>
                  <div className="text-2xl font-semibold">{view.summary.editedRows}</div>
                </div>
                <div className="rounded-lg border p-4">
                  <div className="text-sm text-muted-foreground">
                    {t('recurringServicePeriods.labels.billed', {
                      defaultValue: 'Billed',
                    })}
                  </div>
                  <div className="text-2xl font-semibold">{view.summary.billedRows}</div>
                </div>
                <div className="rounded-lg border p-4">
                  <div className="text-sm text-muted-foreground">
                    {t('recurringServicePeriods.labels.exceptions', {
                      defaultValue: 'Exceptions',
                    })}
                  </div>
                  <div className="text-2xl font-semibold">{view.summary.exceptionRows}</div>
                </div>
              </div>

              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm" data-testid="recurring-service-periods-table">
                  <thead className="bg-muted/40 text-left">
                    <tr>
                      <th className="px-4 py-3 font-medium">
                        {t('recurringServicePeriods.table.columns.state', {
                          defaultValue: 'State',
                        })}
                      </th>
                      <th className="px-4 py-3 font-medium">
                        {t('recurringServicePeriods.table.columns.servicePeriod', {
                          defaultValue: 'Service Period',
                        })}
                      </th>
                      <th className="px-4 py-3 font-medium">
                        {t('recurringServicePeriods.table.columns.invoiceWindow', {
                          defaultValue: 'Invoice Window',
                        })}
                      </th>
                      <th className="px-4 py-3 font-medium">
                        {t('recurringServicePeriods.table.columns.revision', {
                          defaultValue: 'Revision',
                        })}
                      </th>
                      <th className="px-4 py-3 font-medium">
                        {t('recurringServicePeriods.table.columns.reason', {
                          defaultValue: 'Reason',
                        })}
                      </th>
                      <th className="px-4 py-3 font-medium">
                        {t('recurringServicePeriods.table.columns.allowedActions', {
                          defaultValue: 'Allowed Actions',
                        })}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.rows.map((row) => (
                      <tr key={row.record.recordId} className="border-t align-top">
                        <td className="px-4 py-3">
                          <div className="font-medium">{translateDisplayStateLabel(row, t)}</div>
                          <div className="text-xs text-muted-foreground">
                            {translateDisplayStateDetail(row, t)}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {formatRange(row.record.servicePeriod.start, row.record.servicePeriod.end, t)}
                        </td>
                        <td className="px-4 py-3">
                          {formatRange(row.record.invoiceWindow.start, row.record.invoiceWindow.end, t)}
                        </td>
                        <td className="px-4 py-3">r{row.record.revision}</td>
                        <td className="px-4 py-3">
                          {translateReasonCode(
                            row.record.provenance.reasonCode,
                            row.displayState.reasonLabel,
                            t,
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {allowedGovernanceActions(row).map((action) => (
                              <span
                                key={`${row.record.recordId}:${action}`}
                                className="rounded-full border px-2 py-0.5 text-xs"
                              >
                                {translateGovernanceAction(action, t)}
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
                  <h3 className="text-lg font-semibold">
                    {t('recurringServicePeriods.regenerationPreview.title', {
                      defaultValue: 'Regeneration Preview',
                    })}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {t('recurringServicePeriods.regenerationPreview.description', {
                      defaultValue: 'Paste candidate records JSON to preview how preserved edited or billed rows would conflict with regenerated future candidates for this schedule.',
                    })}
                  </p>
                </div>
                <label className="block text-sm font-medium">
                  {t('recurringServicePeriods.labels.candidateRecordsJson', {
                    defaultValue: 'Candidate Records JSON',
                  })}
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
                  {previewLoading
                    ? t('recurringServicePeriods.actions.previewing', {
                      defaultValue: 'Previewing…',
                    })
                    : t('recurringServicePeriods.actions.previewRegeneration', {
                      defaultValue: 'Preview Regeneration',
                    })}
                </button>

                {regenerationPreview && !isPermissionError(regenerationPreview) ? (
                  <div className="space-y-2" data-testid="regeneration-preview">
                    <div className="text-sm">
                      {t('recurringServicePeriods.labels.conflicts', {
                        defaultValue: 'Conflicts',
                      })}
                      : <span className="font-semibold">{regenerationPreview.conflicts.length}</span>
                    </div>
                    {regenerationPreview.conflicts.length > 0 ? (
                      <ul className="space-y-2 text-sm">
                        {regenerationPreview.conflicts.map((conflict) => (
                          <li
                            key={`${conflict.recordId}:${conflict.kind}`}
                            className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2"
                          >
                            <div className="font-medium">
                              {translateConflictKind(conflict.kind, t)}: {conflict.recordId}
                            </div>
                            <div className="text-muted-foreground">
                              {translateConflictReason(conflict.kind, conflict.reason, t)}
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm">
                        {t('recurringServicePeriods.values.noConflicts', {
                          defaultValue: 'No regeneration conflicts were detected for the supplied candidates.',
                        })}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </>
          )}
        </>
      ) : null}
    </div>
  );
};

export default RecurringServicePeriodsTab;
