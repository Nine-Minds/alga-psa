'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { Button } from '@alga-psa/ui/components/Button';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { EmptyState } from '@alga-psa/ui/components/EmptyState';
import { Mail } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type {
  ColumnDefinition,
  IContact,
  IMarketingEnrollmentWithContact,
  IMarketingSequence,
  IMarketingSequenceStepStats,
} from '@alga-psa/types';
import { getMarketingSequenceDetail, unenrollContactFromSequence } from '../actions/sequenceActions';
import type { SequenceDetail } from '../lib/sequences';
import { SequenceDialog } from './SequenceDialog';
import { EnrollContactDialog } from './EnrollContactDialog';
import { EnrollmentStateBadge, SequenceStatusBadge } from './StatusBadge';
import { delayLabel, formatDateTime, journeyDayLabel } from './format';

function ProgressBar({ current, total }: { current: number; total: number }): React.ReactElement {
  const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  const complete = total > 0 && current >= total;
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 flex-1 rounded-full bg-[rgb(var(--color-border-100))]">
        <div
          className={`h-1.5 rounded-full ${complete ? 'bg-emerald-500' : 'bg-[rgb(var(--color-primary-500))]'}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="flex-shrink-0 text-xs text-[rgb(var(--color-text-500))]">
        {current}/{total}
      </span>
    </div>
  );
}

export function SequencesView({
  sequences,
  initialDetail,
  contacts,
}: {
  sequences: IMarketingSequence[];
  initialDetail: SequenceDetail | null;
  contacts: IContact[];
}): React.ReactElement {
  const { t } = useTranslation('msp/core');
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string>(initialDetail?.sequence.sequence_id ?? '');
  const [detail, setDetail] = useState<SequenceDetail | null>(initialDetail);
  const [dialogMode, setDialogMode] = useState<'create' | 'edit' | null>(null);
  const [enrollOpen, setEnrollOpen] = useState(false);

  const loadDetail = useCallback(async (sequenceId: string) => {
    try {
      setDetail(await getMarketingSequenceDetail(sequenceId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (selectedId && selectedId !== detail?.sequence.sequence_id) {
      void loadDetail(selectedId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // After a refresh (e.g. a new sequence was created), fall back to the first
  // sequence when the current selection no longer exists in the list.
  useEffect(() => {
    if (sequences.length > 0 && !sequences.some((sequence) => sequence.sequence_id === selectedId)) {
      setSelectedId(sequences[0].sequence_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequences]);

  const refresh = useCallback(async () => {
    if (selectedId) await loadDetail(selectedId);
  }, [loadDetail, selectedId]);

  const selectedSequence = detail?.sequence ?? sequences.find((s) => s.sequence_id === selectedId) ?? null;

  const statsByStep = useMemo(() => {
    const map = new Map<string, IMarketingSequenceStepStats>();
    for (const stat of detail?.stepStats ?? []) map.set(stat.step_id, stat);
    return map;
  }, [detail]);

  const performance = useMemo(() => {
    const totals = (detail?.stepStats ?? []).reduce(
      (acc, stat) => ({ sent: acc.sent + stat.sent, opened: acc.opened + stat.opened, clicked: acc.clicked + stat.clicked }),
      { sent: 0, opened: 0, clicked: 0 }
    );
    return {
      openRate: totals.sent > 0 ? Math.round((totals.opened / totals.sent) * 100) : null,
      clickRate: totals.sent > 0 ? Math.round((totals.clicked / totals.sent) * 100) : null,
    };
  }, [detail]);

  const activeEnrollments = useMemo(
    () => (detail?.enrollments ?? []).filter((enrollment) => enrollment.state === 'active').length,
    [detail]
  );

  const handleUnenroll = async (enrollmentId: string) => {
    try {
      await unenrollContactFromSequence(enrollmentId);
      toast.success(t('marketing.sequences.toast.unenrolled', 'Contact unenrolled'));
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const enrollmentColumns: ColumnDefinition<IMarketingEnrollmentWithContact>[] = [
    {
      title: t('marketing.sequences.enrollments.contact', 'Contact'),
      dataIndex: 'contact_name',
      render: (value: string, record: IMarketingEnrollmentWithContact) => (
        <div>
          <div className="font-medium text-[rgb(var(--color-text-800))]">{value}</div>
          <div className="text-xs text-[rgb(var(--color-text-500))]">{record.contact_email}</div>
        </div>
      ),
    },
    {
      title: t('marketing.sequences.enrollments.progress', 'Progress'),
      dataIndex: 'current_step_order',
      render: (value: number, record: IMarketingEnrollmentWithContact) => (
        <ProgressBar current={value} total={record.step_count} />
      ),
    },
    {
      title: t('marketing.sequences.enrollments.nextSend', 'Next send'),
      dataIndex: 'next_send_at',
      render: (value: string | null) => (value ? formatDateTime(value) : '—'),
    },
    {
      title: t('marketing.sequences.enrollments.state', 'State'),
      dataIndex: 'state',
      render: (value: IMarketingEnrollmentWithContact['state']) => <EnrollmentStateBadge state={value} />,
    },
    {
      title: t('marketing.sequences.enrollments.actions', 'Actions'),
      dataIndex: 'enrollment_id',
      sortable: false,
      render: (value: string, record: IMarketingEnrollmentWithContact) =>
        record.state === 'active' ? (
          <Button
            id={`marketing-enrollment-unenroll-${value}`}
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => void handleUnenroll(value)}
          >
            {t('marketing.sequences.enrollments.unenroll', 'Unenroll')}
          </Button>
        ) : null,
    },
  ];

  // Cumulative delay for the "day N" chip on each journey card — the step's
  // own delay counts toward its label (a step sent 2 days in is "day 2").
  const journeyDays = useMemo(() => {
    let cumulative = 0;
    return (detail?.steps ?? []).map((step) => {
      cumulative += step.delay_minutes;
      return journeyDayLabel(cumulative);
    });
  }, [detail]);

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-[rgb(var(--color-text-900))]">
          {t('marketing.sequences.title', 'Sequences')}
        </h1>
        <Button id="marketing-sequences-new" type="button" size="sm" onClick={() => setDialogMode('create')}>
          {t('marketing.sequences.new', 'New sequence')}
        </Button>
      </div>

      {sequences.length === 0 ? (
        <EmptyState
          icon={<Mail className="h-6 w-6" />}
          title={t('marketing.sequences.emptyTitle', 'No sequences yet')}
          description={t(
            'marketing.sequences.emptyBody',
            'Sequences send a timed series of emails to enrolled contacts.'
          )}
          action={
            <Button id="marketing-sequences-empty-new" type="button" size="sm" onClick={() => setDialogMode('create')}>
              {t('marketing.sequences.new', 'New sequence')}
            </Button>
          }
        />
      ) : (
        <>
          <div className="mb-4 max-w-sm">
            <CustomSelect
              id="marketing-sequences-picker"
              label={t('marketing.sequences.pickerLabel', 'Sequence')}
              options={sequences.map((sequence) => ({ value: sequence.sequence_id, label: sequence.name }))}
              value={selectedId}
              onValueChange={setSelectedId}
            />
          </div>

          {selectedSequence && detail && (
            <>
              {/* Header */}
              <div className="mb-4 flex items-center">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-base font-semibold text-[rgb(var(--color-text-900))]">
                      {selectedSequence.name}
                    </h2>
                    <SequenceStatusBadge status={selectedSequence.status} />
                  </div>
                  <p className="text-xs text-[rgb(var(--color-text-500))]">
                    {t('marketing.sequences.headerSummary', '{{steps}} steps · {{active}} active enrollments', {
                      steps: detail.steps.length,
                      active: activeEnrollments,
                    })}
                    {performance.openRate !== null
                      ? ` · ${t('marketing.sequences.headerOpenRate', '{{rate}}% open rate', { rate: performance.openRate })}`
                      : ''}
                  </p>
                </div>
                <div className="ml-auto flex flex-shrink-0 items-center gap-2">
                  <Button
                    id="marketing-sequences-edit"
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setDialogMode('edit')}
                  >
                    {t('marketing.actions.edit', 'Edit')}
                  </Button>
                  <Button
                    id="marketing-sequences-enroll"
                    type="button"
                    size="sm"
                    onClick={() => setEnrollOpen(true)}
                  >
                    {t('marketing.sequences.enroll', 'Enroll contacts')}
                  </Button>
                </div>
              </div>

              {/* Journey cards */}
              <div className="mb-4 rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4">
                <div className="mb-3 flex items-center">
                  <span className="text-sm font-semibold text-[rgb(var(--color-text-800))]">
                    {t('marketing.sequences.journey', 'Journey')}
                  </span>
                </div>
                {detail.steps.length === 0 ? (
                  <p className="text-sm text-[rgb(var(--color-text-400))]">
                    {t('marketing.sequences.noSteps', 'No steps yet — edit the sequence to add steps.')}
                  </p>
                ) : (
                  <div className="flex items-stretch gap-0 overflow-x-auto pb-1">
                    {detail.steps.map((step, index) => {
                      const stats = statsByStep.get(step.step_id);
                      const openPercent =
                        stats && stats.sent > 0 ? Math.round((stats.opened / stats.sent) * 100) : null;
                      return (
                        <React.Fragment key={step.step_id}>
                          {index > 0 && (
                            <div className="flex flex-shrink-0 flex-col items-center justify-center px-1.5">
                              <span className="whitespace-nowrap text-[9px] font-semibold uppercase tracking-wide text-[rgb(var(--color-text-400))]">
                                {delayLabel(step.delay_minutes)}
                              </span>
                              <svg
                                className="h-4 w-8 text-[rgb(var(--color-border-300))]"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                viewBox="0 0 32 16"
                              >
                                <path d="M0 8h28m-6-5 6 5-6 5" />
                              </svg>
                            </div>
                          )}
                          <div
                            className={`w-56 flex-shrink-0 rounded-md border p-3 ${
                              index === 0
                                ? 'border-[rgb(var(--color-primary-200))] bg-[rgb(var(--color-primary-50))]'
                                : 'border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))]'
                            }`}
                          >
                            <div className="mb-1 flex items-center gap-1.5">
                              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[rgb(var(--color-primary-500))] text-[10px] font-semibold text-white">
                                {step.step_order}
                              </span>
                              <span className="rounded-full bg-[rgb(var(--color-border-100))] px-1.5 py-0.5 text-[10px] font-semibold text-[rgb(var(--color-text-500))]">
                                {journeyDays[index]}
                              </span>
                            </div>
                            <div className="truncate text-sm font-semibold text-[rgb(var(--color-text-800))]">
                              {step.subject}
                            </div>
                            <p className="mt-0.5 line-clamp-2 text-xs text-[rgb(var(--color-text-500))]">
                              {step.body_template}
                            </p>
                            <div className="mt-2 flex items-center gap-2 text-[10px] text-[rgb(var(--color-text-500))]">
                              <span>
                                {t('marketing.sequences.stepStats.sent', '{{count}} sent', { count: stats?.sent ?? 0 })}
                              </span>
                              {openPercent !== null && (
                                <>
                                  <span>·</span>
                                  <span>
                                    {t('marketing.sequences.stepStats.opened', '{{rate}}% opened', { rate: openPercent })}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </React.Fragment>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="flex items-start gap-4">
                {/* Enrollments */}
                <div className="min-w-0 flex-1 rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4">
                  <div className="mb-2 flex items-center">
                    <span className="text-sm font-semibold text-[rgb(var(--color-text-800))]">
                      {t('marketing.sequences.enrollments.title', 'Enrollments')}
                    </span>
                    <span className="ml-auto flex-shrink-0 rounded-full bg-[rgb(var(--color-border-100))] px-2 py-0.5 text-[10px] font-semibold text-[rgb(var(--color-text-500))]">
                      {detail.enrollments.length}
                    </span>
                  </div>
                  {detail.enrollments.length === 0 ? (
                    <p className="text-sm text-[rgb(var(--color-text-400))]">
                      {t('marketing.sequences.enrollments.empty', 'No enrollments yet.')}
                    </p>
                  ) : (
                    <DataTable data={detail.enrollments} columns={enrollmentColumns} pagination={false} />
                  )}
                </div>

                {/* Performance rail */}
                <div className="w-72 flex-shrink-0">
                  <div className="rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4">
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-400))]">
                      {t('marketing.sequences.performance', 'Performance')}
                    </div>
                    <div className="space-y-1.5 text-sm">
                      <div className="flex justify-between">
                        <span className="text-[rgb(var(--color-text-500))]">{t('marketing.sequences.performance.openRate', 'Open rate')}</span>
                        <span className="font-medium text-[rgb(var(--color-text-800))]">
                          {performance.openRate !== null ? `${performance.openRate}%` : '—'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[rgb(var(--color-text-500))]">{t('marketing.sequences.performance.clickRate', 'Click rate')}</span>
                        <span className="font-medium text-[rgb(var(--color-text-800))]">
                          {performance.clickRate !== null ? `${performance.clickRate}%` : '—'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[rgb(var(--color-text-500))]">{t('marketing.sequences.performance.stopped', 'Unsubscribed / stopped')}</span>
                        <span className="font-medium text-[rgb(var(--color-text-800))]">
                          {detail.enrollments.filter((enrollment) => enrollment.state === 'stopped').length}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}

      <SequenceDialog
        sequence={dialogMode === 'edit' ? selectedSequence : null}
        steps={dialogMode === 'edit' ? detail?.steps ?? [] : []}
        isOpen={dialogMode != null}
        onClose={() => setDialogMode(null)}
        onCompleted={() => {
          void refresh();
          router.refresh();
        }}
      />
      <EnrollContactDialog
        sequence={selectedSequence}
        contacts={contacts}
        isOpen={enrollOpen}
        onClose={() => setEnrollOpen(false)}
        onCompleted={() => void refresh()}
      />
    </div>
  );
}
