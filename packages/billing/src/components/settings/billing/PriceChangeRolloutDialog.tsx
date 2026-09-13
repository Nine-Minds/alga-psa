'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { BulkActionBar } from '@alga-psa/ui/components/BulkActionBar';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { useCurrencyFormat } from '@alga-psa/ui/lib';
import type { ColumnDefinition } from '@alga-psa/types';
import {
  previewServicePriceChange,
  type ServicePriceChangePreview,
  type ServicePriceChangePreviewRow,
} from '../../../actions/servicePriceRolloutActions';

export interface PriceChangeRolloutDialogProps {
  isOpen: boolean;
  onClose: () => void;
  serviceId: string;
  serviceName: string;
  newRateCents: number;
  currency: string;
  onSkip: (effectiveDate?: string) => Promise<void> | void;
  onApply: (effectiveDate: string) => Promise<void> | void;
  onReviewRates?: () => void;
}

function defaultEffectiveDate(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const bucketLabel = (count: number, label: string) => (
  <p className="text-sm font-medium text-foreground">
    {label} <span className="text-muted-foreground">({count})</span>
  </p>
);

export default function PriceChangeRolloutDialog({
  isOpen,
  onClose,
  serviceId,
  serviceName,
  newRateCents,
  currency,
  onSkip,
  onApply,
  onReviewRates,
}: PriceChangeRolloutDialogProps) {
  const { money, moneySigned } = useCurrencyFormat();
  const [effectiveDate, setEffectiveDate] = useState<Date>(() => defaultEffectiveDate());
  const [preview, setPreview] = useState<ServicePriceChangePreview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const loadPreview = useCallback(
    async (date: Date) => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await previewServicePriceChange(
          serviceId,
          newRateCents,
          isoDate(date),
          currency,
        );
        if ('willChange' in result) {
          setPreview(result);
          setSelected(new Set(result.willChange.map((row) => row.contractLineId)));
        } else {
          setError('Could not load the price-change preview.');
        }
      } catch (previewError) {
        console.error('Failed to preview price change:', previewError);
        setError('Could not load the price-change preview.');
      } finally {
        setIsLoading(false);
      }
    },
    [serviceId, newRateCents, currency],
  );

  useEffect(() => {
    if (isOpen) {
      setEffectiveDate(defaultEffectiveDate());
      void loadPreview(defaultEffectiveDate());
    }
  }, [isOpen, loadPreview]);

  const toggleSelected = useCallback((lineId: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(lineId);
      else next.delete(lineId);
      return next;
    });
  }, []);

  const columns = useMemo<ColumnDefinition<ServicePriceChangePreviewRow>[]>(
    () => [
      {
        title: '',
        dataIndex: 'contractLineId',
        width: '40px',
        render: (_value: unknown, record: ServicePriceChangePreviewRow, index: number) => (
          <Checkbox
            id={`price-change-row-select-${index}`}
            data-contract-line-id={record.contractLineId}
            checked={selected.has(record.contractLineId)}
            onChange={(event) =>
              toggleSelected(record.contractLineId, event.target.checked)
            }
            skipRegistration
          />
        ),
      },
      { title: 'Client', dataIndex: 'clientName' },
      { title: 'Contract', dataIndex: 'contractName' },
      { title: 'Line', dataIndex: 'contractLineId' },
      {
        title: 'Current',
        dataIndex: 'currentRateCents',
        render: (_value: unknown, record: ServicePriceChangePreviewRow) =>
          record.currentRateCents === null
            ? '—'
            : money(record.currentRateCents, record.currency),
      },
      {
        title: 'New',
        dataIndex: 'newRateCents',
        render: (_value: unknown, record: ServicePriceChangePreviewRow) =>
          record.newRateCents === null
            ? '—'
            : money(record.newRateCents, record.currency),
      },
      {
        title: 'Delta',
        dataIndex: 'deltaCents',
        render: (_value: unknown, record: ServicePriceChangePreviewRow) =>
          moneySigned(record.deltaCents, record.currency),
      },
    ],
    [money, moneySigned, selected, toggleSelected],
  );

  const handleApply = async () => {
    setIsSaving(true);
    setError(null);
    try {
      await onApply(isoDate(effectiveDate));
      onClose();
    } catch (applyError) {
      console.error('Failed to apply price change:', applyError);
      setError('Could not apply the rollout. No changes were made.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSkip = async () => {
    setIsSaving(true);
    setError(null);
    try {
      await onSkip();
      onClose();
    } catch (skipError) {
      console.error('Failed to save price:', skipError);
      setError('Could not save the price change.');
    } finally {
      setIsSaving(false);
    }
  };

  const footer = (
    <div className="flex items-center justify-end gap-2">
      <Button
        id="price-change-skip"
        type="button"
        variant="outline"
        onClick={handleSkip}
        disabled={isSaving}
      >
        Just save the price
      </Button>
      <Button
        id="price-change-apply"
        type="button"
        onClick={handleApply}
        disabled={isSaving || isLoading}
      >
        {isSaving ? 'Saving…' : 'Apply to inherited lines'}
      </Button>
    </div>
  );

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      id="price-change-rollout-dialog"
      title="Price change rollout"
      footer={footer}
      className="max-w-4xl"
    >
      <DialogContent>
        <div className="space-y-4">
          <div>
            <p className="text-sm text-muted-foreground">
              {serviceName}: {money(preview?.oldRateCents ?? 0, currency)} →{' '}
              {money(newRateCents, currency)} {currency}
            </p>
          </div>

          <div className="space-y-1">
            <label
              htmlFor="price-change-effective-date"
              className="text-sm font-medium text-foreground"
            >
              Effective date
            </label>
            <DatePicker
              id="price-change-effective-date"
              value={effectiveDate}
              onChange={(date) => {
                setEffectiveDate(date);
                void loadPreview(date);
              }}
            />
            <p className="text-xs text-muted-foreground">
              Defaults to the next billing period boundary.
            </p>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {isLoading ? (
            <div className="flex justify-center py-6">
              <LoadingIndicator />
            </div>
          ) : preview ? (
            <div className="space-y-6">
              <div className="space-y-2">
                {bucketLabel(preview.willChange.length, 'Will change')}
                {preview.willChange.length > 0 ? (
                  <DataTable
                    id="price-change-affected-grid"
                    data={preview.willChange}
                    columns={columns}
                    pagination={false}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No inherited lines change at this date.
                  </p>
                )}
                {preview.willChange.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Button
                      id="price-change-select-all"
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setSelected(new Set(preview.willChange.map((row) => row.contractLineId)))
                      }
                    >
                      Select all
                    </Button>
                    <Button
                      id="price-change-select-none"
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelected(new Set())}
                    >
                      Select none
                    </Button>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                {bucketLabel(preview.custom.length, "Won't change — custom")}
                {preview.custom.length === 0 ? (
                  <p className="text-sm text-muted-foreground">None.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {preview.custom.map((row) => (
                      <li key={row.contractLineId} className="flex justify-between gap-4">
                        <span>
                          {row.clientName ?? '—'} · {row.contractName ?? '—'}
                        </span>
                        <span>
                          {row.currentRateCents === null
                            ? '—'
                            : money(row.currentRateCents, row.currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="space-y-2">
                {bucketLabel(preview.unreviewed.length, "Won't change — not yet classified")}
                {preview.unreviewed.length > 0 && (
                  <Alert variant="info">
                    <AlertDescription>
                      These lines bill unchanged until you review them.{' '}
                      {onReviewRates && (
                        <button
                          type="button"
                          id="price-change-review-rates"
                          className="underline"
                          onClick={onReviewRates}
                        >
                          Review rates
                        </button>
                      )}
                    </AlertDescription>
                  </Alert>
                )}
                {preview.unreviewed.length === 0 && (
                  <p className="text-sm text-muted-foreground">None.</p>
                )}
              </div>

              <div className="space-y-2">
                {bucketLabel(preview.excluded.length, 'Excluded — already invoiced')}
                {preview.excluded.length === 0 ? (
                  <p className="text-sm text-muted-foreground">None.</p>
                ) : (
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {preview.excluded.map((row) => (
                      <li key={row.contractLineId}>
                        {row.clientName ?? '—'} · {row.contractName ?? '—'} — {row.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-md border p-3 text-sm">
                <div className="flex justify-between">
                  <span>Total monthly revenue delta</span>
                  <span className="font-medium">
                    {moneySigned(preview.totalMonthlyDeltaCents, preview.currency)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Across the {preview.willChange.length} inherited line(s) selected.
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>

      <BulkActionBar
        count={selected.size}
        selectedLabel={`${selected.size} selected`}
        idPrefix="price-change-bulk-actions"
        onClear={() => setSelected(new Set())}
      />
    </Dialog>
  );
}
