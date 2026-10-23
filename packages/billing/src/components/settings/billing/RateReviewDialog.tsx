'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { useCurrencyFormat } from '@alga-psa/ui/lib';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ColumnDefinition } from '@alga-psa/types';
import {
  previewRateReclassification,
  applyRateReclassification,
  type RateReviewRow,
  type RateReviewPreview,
  type RateReviewApplyResult,
} from '../../../actions/rateReviewActions';

export interface RateReviewDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

function isActionable(row: RateReviewRow): boolean {
  return row.proposed === 'inherited' || row.proposed === 'custom';
}

function proposalLabel(row: RateReviewRow, t: TranslateFn): string {
  switch (row.proposed) {
    case 'inherited':
      return t('rateReview.proposal.inherited', { defaultValue: 'Follow the catalog' });
    case 'custom':
      return t('rateReview.proposal.custom', { defaultValue: 'Keep as custom' });
    default:
      return t('rateReview.proposal.unreviewed', { defaultValue: 'Leave unreviewed' });
  }
}

function confidenceLabel(row: RateReviewRow, t: TranslateFn): string {
  if (row.proposed === 'inherited') {
    return t('rateReview.confidence.exact', { defaultValue: 'Exact match' });
  }
  if (row.proposed === 'custom') {
    return t('rateReview.confidence.differs', { defaultValue: 'Differs from catalog' });
  }
  return row.reason ?? t('rateReview.confidence.needsDecision', { defaultValue: 'Needs a decision' });
}

/**
 * Bulk rate review (plan §3.3). Legacy contract lines written before rate
 * provenance carry an `unreviewed` label; this surface asks the one answerable
 * question — "is this line priced at the catalog rate today?" — and applies the
 * classification through the same preview/apply action pair, so the preview the
 * operator sees and the apply that runs cannot drift.
 */
export default function RateReviewDialog({ isOpen, onClose }: RateReviewDialogProps) {
  const { money } = useCurrencyFormat();
  const { t } = useTranslation('msp/billing-settings');
  const [preview, setPreview] = useState<RateReviewPreview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isApplying, setIsApplying] = useState(false);
  const [result, setResult] = useState<RateReviewApplyResult | null>(null);

  const options = useMemo(() => ({ period: preview?.period }), [preview?.period]);

  const loadPreview = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await previewRateReclassification({});
      if ('rows' in response) {
        setPreview(response);
        setSelected(
          new Set(
            response.rows
              .filter((row) => row.proposed === 'inherited')
              .map((row) => row.contractLineId),
          ),
        );
      } else {
        setError(
          t('rateReview.previewFailed', { defaultValue: 'Could not load the rates for review.' }),
        );
      }
    } catch (previewError) {
      console.error('Failed to load rate review:', previewError);
      setError(
        t('rateReview.previewFailed', { defaultValue: 'Could not load the rates for review.' }),
      );
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (isOpen) {
      setPreview(null);
      setResult(null);
      void loadPreview();
    }
  }, [isOpen, loadPreview]);

  const groups = useMemo(() => {
    const byService = new Map<string, RateReviewRow[]>();
    for (const row of preview?.rows ?? []) {
      const label =
        row.serviceNames.length > 0
          ? row.serviceNames.join(', ')
          : t('rateReview.noService', { defaultValue: 'No service' });
      const rows = byService.get(label) ?? [];
      rows.push(row);
      byService.set(label, rows);
    }
    return [...byService.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [preview?.rows, t]);

  const exactMatchCount = preview?.rows.filter((row) => row.proposed === 'inherited').length ?? 0;

  const toggleSelected = useCallback((contractLineId: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(contractLineId);
      else next.delete(contractLineId);
      return next;
    });
  }, []);

  const columns = useMemo<ColumnDefinition<RateReviewRow>[]>(
    () => [
      {
        title: '',
        dataIndex: 'contractLineId',
        width: '40px',
        render: (_value: unknown, record: RateReviewRow, index: number) => (
          <Checkbox
            id={`rate-review-row-select-${index}`}
            data-contract-line-id={record.contractLineId}
            checked={selected.has(record.contractLineId)}
            disabled={!isActionable(record)}
            onChange={(event) => toggleSelected(record.contractLineId, event.target.checked)}
            skipRegistration
          />
        ),
      },
      {
        title: t('rateReview.columns.contract', { defaultValue: 'Contract' }),
        dataIndex: 'contractName',
        render: (_value: unknown, record: RateReviewRow) => record.contractName ?? '—',
      },
      {
        title: t('rateReview.columns.currentRate', { defaultValue: 'Current rate' }),
        dataIndex: 'storedRateCents',
        render: (_value: unknown, record: RateReviewRow) =>
          record.storedRateCents === null ? '—' : money(record.storedRateCents, record.currency),
      },
      {
        title: t('rateReview.columns.catalogRate', { defaultValue: 'Catalog rate' }),
        dataIndex: 'resolvedRateCents',
        render: (_value: unknown, record: RateReviewRow) =>
          record.resolvedRateCents === null ? '—' : money(record.resolvedRateCents, record.currency),
      },
      {
        title: t('rateReview.columns.proposed', { defaultValue: 'Proposed' }),
        dataIndex: 'proposed',
        render: (_value: unknown, record: RateReviewRow) => (
          <Badge
            variant={
              record.proposed === 'inherited'
                ? 'default-muted'
                : record.proposed === 'custom'
                  ? 'info'
                  : 'warning'
            }
          >
            {proposalLabel(record, t)}
          </Badge>
        ),
      },
      {
        title: t('rateReview.columns.confidence', { defaultValue: 'Confidence' }),
        dataIndex: 'reason',
        render: (_value: unknown, record: RateReviewRow) => confidenceLabel(record, t),
      },
    ],
    [money, selected, toggleSelected, t],
  );

  const handleApply = async () => {
    if (!preview) return;
    const decisions = preview.rows
      .filter((row) => selected.has(row.contractLineId) && isActionable(row))
      .map((row) => ({
        contractLineId: row.contractLineId,
        target: row.proposed as 'inherited' | 'custom',
      }));
    if (decisions.length === 0) return;

    setIsApplying(true);
    setError(null);
    try {
      const response = await applyRateReclassification(decisions, options);
      if ('applied' in response) {
        setResult(response);
        await loadPreview();
      } else {
        setError(
          t('rateReview.applyFailed', {
            defaultValue: 'Could not apply the rate review. No changes were made.',
          }),
        );
      }
    } catch (applyError) {
      console.error('Failed to apply rate review:', applyError);
      setError(
        t('rateReview.applyFailed', {
          defaultValue: 'Could not apply the rate review. No changes were made.',
        }),
      );
    } finally {
      setIsApplying(false);
    }
  };

  const footer = (
    <div className="flex items-center justify-end gap-2">
      <Button id="rate-review-close" type="button" variant="outline" onClick={onClose}>
        {t('rateReview.close', { defaultValue: 'Close' })}
      </Button>
      <Button
        id="rate-review-apply"
        type="button"
        onClick={handleApply}
        disabled={isApplying || isLoading || selected.size === 0}
      >
        {isApplying
          ? t('rateReview.applying', { defaultValue: 'Applying…' })
          : t('rateReview.applySelected', {
              defaultValue: 'Apply selected',
            })}
      </Button>
    </div>
  );

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      id="rate-review-dialog"
      title={t('rateReview.title', { defaultValue: 'Rate review' })}
      footer={footer}
      className="max-w-4xl"
    >
      <DialogContent>
        <div className="space-y-4">
          <Alert variant="info">
            <AlertDescription>
              {t('rateReview.intro', {
                defaultValue:
                  'Lines priced at exactly the catalog rate will not change on your next invoice. Lines that differ keep their current rate as a negotiated price.',
              })}
            </AlertDescription>
          </Alert>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {result && (
            <Alert variant="success">
              <AlertDescription>
                {t('rateReview.applied', {
                  applied: result.applied.length,
                  defaultValue: 'Applied {{applied}} change(s).',
                })}
                {result.refused.length > 0
                  ? ` ${t('rateReview.refused', {
                      refused: result.refused.length,
                      defaultValue:
                        '{{refused}} row(s) were refused because they changed since the preview.',
                    })}`
                  : ''}
              </AlertDescription>
            </Alert>
          )}

          {isLoading ? (
            <div className="flex justify-center py-6">
              <LoadingIndicator />
            </div>
          ) : preview ? (
            <div className="space-y-6">
              <p className="text-sm text-muted-foreground">
                {t('rateReview.summary', {
                  total: preview.summary.total,
                  inherited: preview.summary.inherited,
                  custom: preview.summary.custom,
                  skipped: preview.summary.skipped,
                  exact: exactMatchCount,
                  defaultValue:
                    '{{total}} unreviewed line(s): {{inherited}} exact match(es), {{custom}} negotiated, {{skipped}} skipped.',
                })}
              </p>

              {preview.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('rateReview.allClassified', {
                    defaultValue: 'Every line has been classified. Nothing to review.',
                  })}
                </p>
              ) : (
                <div className="space-y-6">
                  {groups.map(([serviceName, rows], groupIndex) => (
                    <div key={serviceName} className="space-y-2">
                      <p className="text-sm font-medium text-foreground">{serviceName}</p>
                      <DataTable
                        id={`rate-review-grid-${groupIndex}`}
                        data={rows}
                        columns={columns}
                        pagination={false}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
