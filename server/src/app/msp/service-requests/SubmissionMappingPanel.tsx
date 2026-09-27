'use client';

import React, { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import type { TFunction } from 'i18next';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import type { ColumnDefinition } from '@alga-psa/types';
import {
  applyServiceRequestAnswerMappingAction,
  getServiceRequestAnswerMappingEditorDataAction,
  listServiceRequestSubmissionMappingApplicationsAction,
  previewServiceRequestAnswerMappingAction,
} from './actions';

/**
 * Preview / apply / results surface on the admin submission detail
 * (plan §8.2-§8.3). Preview is a dry run; apply records one application per
 * (submission, mapping version) with per-field before→after results. Targets
 * render by display name, never by id.
 */

interface FieldResultRow {
  ruleId: string | null;
  questionKey: string | null;
  destinationKind: string;
  targetFieldKey: string;
  resolvedTargetDisplay: string | null;
  status: string;
  beforeValue: unknown;
  afterValue: unknown;
  errorDetail: string | null;
}

interface ApplicationRun {
  application_id: string;
  mapping_version_id: string;
  applied_by: string | null;
  applied_at: string | Date;
  status: string;
  summary: { applied?: number; skipped?: number; failed?: number };
  results: Array<{
    result_id: string;
    rule_id: string | null;
    question_key: string | null;
    destination_kind: string;
    target_field_key: string;
    resolved_target_display: string | null;
    status: string;
    before_value: unknown;
    after_value: unknown;
    error_detail: string | null;
  }>;
}

interface CatalogEntry {
  kind: string;
  kindDisplayName: string;
  fields: Array<{ fieldKey: string; displayLabel: string }>;
}

interface PreviewRun {
  mappingVersionNumber: number;
  results: FieldResultRow[];
}

function formatValue(value: unknown, empty: string): string {
  if (value === null || value === undefined || value === '') {
    return empty;
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function toRows(run: ApplicationRun): FieldResultRow[] {
  return run.results.map((result) => ({
    ruleId: result.rule_id,
    questionKey: result.question_key,
    destinationKind: result.destination_kind,
    targetFieldKey: result.target_field_key,
    resolvedTargetDisplay: result.resolved_target_display,
    status: result.status,
    beforeValue: result.before_value,
    afterValue: result.after_value,
    errorDetail: result.error_detail,
  }));
}

export function SubmissionMappingPanel({
  definitionId,
  submissionId,
  questionLabel,
  t,
  formatDate,
  onApplied,
}: {
  definitionId: string;
  submissionId: string;
  questionLabel: (key: string | null) => string;
  t: TFunction;
  formatDate: (date: Date, options?: Intl.DateTimeFormatOptions) => string;
  /** Called after a successful apply so the parent can refresh the audit history. */
  onApplied: () => Promise<void> | void;
}) {
  const [runs, setRuns] = useState<ApplicationRun[]>([]);
  const [preview, setPreview] = useState<PreviewRun | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [noMapping, setNoMapping] = useState(false);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    getServiceRequestAnswerMappingEditorDataAction(definitionId)
      .then((result) => {
        if (!cancelled) {
          setCatalog((result as unknown as { targetFieldCatalog: CatalogEntry[] }).targetFieldCatalog ?? []);
        }
      })
      .catch((error) => console.error('Failed to load answer mapping catalog', error));
    return () => {
      cancelled = true;
    };
  }, [definitionId]);

  const destinationLabel = (kind: string) =>
    catalog.find((entry) => entry.kind === kind)?.kindDisplayName ?? kind;

  const fieldLabel = (kind: string, fieldKey: string) => {
    if (kind === 'asset' && fieldKey.startsWith('attributes.')) {
      return `${t('editor.answerMapping.targetFieldGroups.attribute')} ${fieldKey.slice('attributes.'.length)}`;
    }
    return (
      catalog.find((entry) => entry.kind === kind)?.fields.find((field) => field.fieldKey === fieldKey)
        ?.displayLabel ?? fieldKey
    );
  };

  const loadRuns = async () => {
    const result = await listServiceRequestSubmissionMappingApplicationsAction(submissionId);
    setRuns(result as unknown as ApplicationRun[]);
  };

  useEffect(() => {
    setPreview(null);
    setNoMapping(false);
    loadRuns().catch((error) => console.error('Failed to load mapping applications', error));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submissionId]);

  const isNoPublishedMapping = (error: unknown) =>
    error instanceof Error && /No published answer mapping/i.test(error.message);

  const runPreview = async () => {
    setPreviewing(true);
    try {
      const result = await previewServiceRequestAnswerMappingAction(submissionId);
      setPreview(result as unknown as PreviewRun);
      setNoMapping(false);
    } catch (error) {
      if (isNoPublishedMapping(error)) {
        setNoMapping(true);
        return;
      }
      console.error('Failed to preview answer mapping', error);
      toast.error(t('editor.answerMapping.messages.previewFailed'));
    } finally {
      setPreviewing(false);
    }
  };

  const runApply = async () => {
    setApplying(true);
    try {
      const result = (await applyServiceRequestAnswerMappingAction(submissionId)) as unknown as
        ApplicationRun & { replayed: boolean };
      setPreview(null);
      setNoMapping(false);
      await loadRuns();
      await onApplied();
      toast.success(
        result.replayed ? t('editor.submissions.mapping.replayed') : t('editor.answerMapping.messages.applied')
      );
    } catch (error) {
      if (isNoPublishedMapping(error)) {
        setNoMapping(true);
        return;
      }
      console.error('Failed to apply answer mapping', error);
      toast.error(t('editor.answerMapping.messages.applyFailed'));
    } finally {
      setApplying(false);
    }
  };

  const empty = t('editor.submissions.mapping.emptyValue');
  const columns: ColumnDefinition<FieldResultRow>[] = [
    {
      title: t('editor.submissions.mapping.columns.question'),
      dataIndex: 'questionKey',
      render: (value: string | null) => questionLabel(value),
    },
    {
      title: t('editor.submissions.mapping.columns.destination'),
      dataIndex: 'destinationKind',
      render: (value: string, record) => `${destinationLabel(value)} · ${fieldLabel(value, record.targetFieldKey)}`,
    },
    {
      title: t('editor.submissions.mapping.columns.target'),
      dataIndex: 'resolvedTargetDisplay',
      render: (value: string | null) => value ?? t('editor.submissions.mapping.unresolvedTarget'),
    },
    {
      title: t('editor.submissions.mapping.columns.before'),
      dataIndex: 'beforeValue',
      sortable: false,
      render: (value: unknown) => formatValue(value, empty),
    },
    {
      title: t('editor.submissions.mapping.columns.after'),
      dataIndex: 'afterValue',
      sortable: false,
      render: (value: unknown) => formatValue(value, empty),
    },
    {
      title: t('editor.submissions.mapping.columns.status'),
      dataIndex: 'status',
      render: (value: string) => t(`editor.submissions.mapping.status.${value}`, { defaultValue: value }),
    },
    {
      title: t('editor.submissions.mapping.columns.detail'),
      dataIndex: 'errorDetail',
      sortable: false,
      render: (value: string | null) => value ?? empty,
    },
  ];

  return (
    <div id={`service-request-submission-mapping-${submissionId}`} className="space-y-3 pt-2">
      <div className="text-sm font-semibold">{t('editor.submissions.mapping.title')}</div>
      <p className="text-sm text-[rgb(var(--color-text-600))]">{t('editor.submissions.mapping.description')}</p>
      <div className="flex gap-2">
        <Button
          id={`service-request-submission-mapping-preview-${submissionId}`}
          variant="outline"
          disabled={previewing || applying}
          onClick={runPreview}
        >
          {previewing ? t('editor.submissions.mapping.previewing') : t('editor.submissions.mapping.preview')}
        </Button>
        <Button
          id={`service-request-submission-mapping-apply-${submissionId}`}
          variant="default"
          disabled={previewing || applying}
          onClick={runApply}
        >
          {applying ? t('editor.submissions.mapping.applying') : t('editor.submissions.mapping.apply')}
        </Button>
      </div>

      {noMapping && (
        <Alert variant="warning">
          <AlertDescription>{t('editor.submissions.mapping.noPublishedMapping')}</AlertDescription>
        </Alert>
      )}

      {preview && (
        <div className="space-y-2">
          <div className="text-sm font-medium">
            {t('editor.submissions.mapping.previewTitle', { version: preview.mappingVersionNumber })}
          </div>
          <DataTable
            id={`service-request-submission-mapping-preview-table-${submissionId}`}
            data={preview.results}
            columns={columns}
            pagination={false}
          />
        </div>
      )}

      <div className="space-y-2">
        <div className="text-sm font-medium">{t('editor.submissions.mapping.resultsTitle')}</div>
        {runs.length === 0 ? (
          <div className="text-sm text-[rgb(var(--color-text-600))]">{t('editor.submissions.mapping.noRuns')}</div>
        ) : (
          runs.map((run) => (
            <div key={run.application_id} className="space-y-1">
              <div className="text-sm">
                <span className="font-medium">
                  {t('editor.submissions.mapping.runLabel', {
                    date: formatDate(new Date(run.applied_at), { dateStyle: 'medium', timeStyle: 'short' }),
                    status: t(`editor.submissions.mapping.runStatus.${run.status}`, { defaultValue: run.status }),
                  })}
                </span>
                <span className="text-[rgb(var(--color-text-600))]">
                  {' · '}
                  {t('editor.submissions.mapping.summary', {
                    applied: run.summary?.applied ?? 0,
                    skipped: run.summary?.skipped ?? 0,
                    failed: run.summary?.failed ?? 0,
                  })}
                </span>
              </div>
              <DataTable
                id={`service-request-submission-mapping-run-${run.application_id}`}
                data={toRows(run)}
                columns={columns}
                pagination={false}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
