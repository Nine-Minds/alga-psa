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

function isActionable(row: RateReviewRow): boolean {
  return row.proposed === 'inherited' || row.proposed === 'custom';
}

function proposalLabel(row: RateReviewRow): string {
  switch (row.proposed) {
    case 'inherited':
      return 'Follow the catalog';
    case 'custom':
      return 'Keep as custom';
    default:
      return 'Leave unreviewed';
  }
}

function confidenceLabel(row: RateReviewRow): string {
  if (row.proposed === 'inherited') return 'Exact match';
  if (row.proposed === 'custom') return 'Differs from catalog';
  return row.reason ?? 'Needs a decision';
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
        setError('Could not load the rates for review.');
      }
    } catch (previewError) {
      console.error('Failed to load rate review:', previewError);
      setError('Could not load the rates for review.');
    } finally {
      setIsLoading(false);
    }
  }, []);

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
      const label = row.serviceNames.length > 0 ? row.serviceNames.join(', ') : 'No service';
      const rows = byService.get(label) ?? [];
      rows.push(row);
      byService.set(label, rows);
    }
    return [...byService.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [preview?.rows]);

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
        title: 'Contract',
        dataIndex: 'contractName',
        render: (_value: unknown, record: RateReviewRow) => record.contractName ?? '—',
      },
      {
        title: 'Current rate',
        dataIndex: 'storedRateCents',
        render: (_value: unknown, record: RateReviewRow) =>
          record.storedRateCents === null ? '—' : money(record.storedRateCents, record.currency),
      },
      {
        title: 'Catalog rate',
        dataIndex: 'resolvedRateCents',
        render: (_value: unknown, record: RateReviewRow) =>
          record.resolvedRateCents === null ? '—' : money(record.resolvedRateCents, record.currency),
      },
      {
        title: 'Proposed',
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
            {proposalLabel(record)}
          </Badge>
        ),
      },
      {
        title: 'Confidence',
        dataIndex: 'reason',
        render: (_value: unknown, record: RateReviewRow) => confidenceLabel(record),
      },
    ],
    [money, selected, toggleSelected],
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
        setError('Could not apply the rate review. No changes were made.');
      }
    } catch (applyError) {
      console.error('Failed to apply rate review:', applyError);
      setError('Could not apply the rate review. No changes were made.');
    } finally {
      setIsApplying(false);
    }
  };

  const footer = (
    <div className="flex items-center justify-end gap-2">
      <Button id="rate-review-close" type="button" variant="outline" onClick={onClose}>
        Close
      </Button>
      <Button
        id="rate-review-apply"
        type="button"
        onClick={handleApply}
        disabled={isApplying || isLoading || selected.size === 0}
      >
        {isApplying ? 'Applying…' : 'Apply selected'}
      </Button>
    </div>
  );

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      id="rate-review-dialog"
      title="Rate review"
      footer={footer}
      className="max-w-4xl"
    >
      <DialogContent>
        <div className="space-y-4">
          <Alert variant="info">
            <AlertDescription>
              Lines priced at exactly the catalog rate will not change on your next invoice. Lines
              that differ keep their current rate as a negotiated price.
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
                Applied {result.applied.length} change(s).
                {result.refused.length > 0
                  ? ` ${result.refused.length} row(s) were refused because they changed since the preview.`
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
                {preview.summary.total} unreviewed line(s): {preview.summary.inherited} exact
                match(es), {preview.summary.custom} negotiated, {preview.summary.skipped} skipped.
              </p>

              {preview.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Every line has been classified. Nothing to review.
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
