'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { useCurrencyFormat } from '@alga-psa/ui/lib';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
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
  /**
   * `rollout` applies a pending price change; `review` is the read-only
   * "who is on this price?" entry point (plan §3.2) with no pending change.
   */
  mode?: 'rollout' | 'review';
  onSkip?: (effectiveDate?: string) => Promise<void> | void;
  onApply?: (effectiveDate: string) => Promise<void> | void;
  onReviewRates?: () => void;
}

function defaultEffectiveDate(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default function PriceChangeRolloutDialog({
  isOpen,
  onClose,
  serviceId,
  serviceName,
  newRateCents,
  currency,
  mode = 'rollout',
  onSkip,
  onApply,
  onReviewRates,
}: PriceChangeRolloutDialogProps) {
  const { money, moneySigned } = useCurrencyFormat();
  const { t } = useTranslation('msp/billing-settings');
  const isReview = mode === 'review';
  const [effectiveDate, setEffectiveDate] = useState<Date>(() => defaultEffectiveDate());
  const [preview, setPreview] = useState<ServicePriceChangePreview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

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
        } else {
          setError(
            t('priceChangeRollout.previewFailed', {
              defaultValue: 'Could not load the price-change preview.',
            }),
          );
        }
      } catch (previewError) {
        console.error('Failed to preview price change:', previewError);
        setError(
          t('priceChangeRollout.previewFailed', {
            defaultValue: 'Could not load the price-change preview.',
          }),
        );
      } finally {
        setIsLoading(false);
      }
    },
    [serviceId, newRateCents, currency, t],
  );

  useEffect(() => {
    if (isOpen) {
      setEffectiveDate(defaultEffectiveDate());
      void loadPreview(defaultEffectiveDate());
    }
  }, [isOpen, loadPreview]);

  // The rollout is catalog-level by design: one effective-dated price row
  // changes every inherited line. There is no per-line selection because there
  // is no per-contract write to select — a control here would ignore its input.
  const columns = useMemo<ColumnDefinition<ServicePriceChangePreviewRow>[]>(
    () => [
      {
        title: t('priceChangeRollout.columns.client', { defaultValue: 'Client' }),
        dataIndex: 'clientName',
      },
      {
        title: t('priceChangeRollout.columns.contract', { defaultValue: 'Contract' }),
        dataIndex: 'contractName',
      },
      {
        title: t('priceChangeRollout.columns.line', { defaultValue: 'Line' }),
        dataIndex: 'contractLineName',
        render: (_value: unknown, record: ServicePriceChangePreviewRow) =>
          record.contractLineName ?? serviceName,
      },
      {
        title: t('priceChangeRollout.columns.current', { defaultValue: 'Current' }),
        dataIndex: 'currentRateCents',
        render: (_value: unknown, record: ServicePriceChangePreviewRow) =>
          record.currentRateCents === null
            ? '—'
            : money(record.currentRateCents, record.currency),
      },
      {
        title: t('priceChangeRollout.columns.new', { defaultValue: 'New' }),
        dataIndex: 'newRateCents',
        render: (_value: unknown, record: ServicePriceChangePreviewRow) =>
          record.newRateCents === null
            ? '—'
            : money(record.newRateCents, record.currency),
      },
      {
        title: t('priceChangeRollout.columns.delta', { defaultValue: 'Delta' }),
        dataIndex: 'deltaCents',
        render: (_value: unknown, record: ServicePriceChangePreviewRow) =>
          moneySigned(record.deltaCents, record.currency),
      },
    ],
    [money, moneySigned, serviceName, t],
  );

  const handleApply = async () => {
    if (!onApply) return;
    setIsSaving(true);
    setError(null);
    try {
      await onApply(isoDate(effectiveDate));
      onClose();
    } catch (applyError) {
      console.error('Failed to apply price change:', applyError);
      setError(
        t('priceChangeRollout.applyFailed', {
          defaultValue: 'Could not apply the rollout. No changes were made.',
        }),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleSkip = async () => {
    if (!onSkip) return;
    setIsSaving(true);
    setError(null);
    try {
      await onSkip();
      onClose();
    } catch (skipError) {
      console.error('Failed to save price:', skipError);
      setError(
        t('priceChangeRollout.skipFailed', {
          defaultValue: 'Could not save the price change.',
        }),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const footer = isReview ? (
    <div className="flex items-center justify-end gap-2">
      <Button id="price-change-close" type="button" variant="outline" onClick={onClose}>
        {t('priceChangeRollout.close', { defaultValue: 'Close' })}
      </Button>
    </div>
  ) : (
    <div className="flex items-center justify-end gap-2">
      <Button
        id="price-change-skip"
        type="button"
        variant="outline"
        onClick={handleSkip}
        disabled={isSaving}
      >
        {t('priceChangeRollout.skip', { defaultValue: 'Just save the price' })}
      </Button>
      <Button
        id="price-change-apply"
        type="button"
        onClick={handleApply}
        disabled={isSaving || isLoading}
      >
        {isSaving
          ? t('priceChangeRollout.applying', { defaultValue: 'Saving…' })
          : t('priceChangeRollout.apply', { defaultValue: 'Apply to inherited lines' })}
      </Button>
    </div>
  );

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      id="price-change-rollout-dialog"
      title={
        isReview
          ? t('priceChangeRollout.usageTitle', { defaultValue: 'Service usage' })
          : t('priceChangeRollout.title', { defaultValue: 'Price change rollout' })
      }
      footer={footer}
      className="max-w-4xl"
    >
      <DialogContent>
        <div className="space-y-4">
          <div>
            <p className="text-sm text-muted-foreground">
              {serviceName}: {money(preview?.oldRateCents ?? newRateCents, currency)}
              {isReview ? (
                <> {currency}</>
              ) : (
                <>
                  {' '}
                  &rarr; {money(newRateCents, currency)} {currency}
                </>
              )}
            </p>
          </div>

          <div className="space-y-1">
            <label
              htmlFor="price-change-effective-date"
              className="text-sm font-medium text-foreground"
            >
              {t('priceChangeRollout.effectiveDate', { defaultValue: 'Effective date' })}
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
              {t('priceChangeRollout.effectiveDateHint', {
                defaultValue: 'Defaults to the next billing period boundary.',
              })}
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
                <p className="text-sm font-medium text-foreground">
                  {isReview
                    ? t('priceChangeRollout.followsCatalog', {
                        defaultValue: 'Follows the catalog',
                      })
                    : t('priceChangeRollout.willChange', { defaultValue: 'Will change' })}{' '}
                  <span className="text-muted-foreground">({preview.willChange.length})</span>
                </p>
                {preview.willChange.length > 0 ? (
                  <DataTable
                    id="price-change-affected-grid"
                    data={preview.willChange}
                    columns={columns}
                    pagination={false}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t('priceChangeRollout.noInheritedLines', {
                      defaultValue: 'No inherited lines change at this date.',
                    })}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">
                  {t('priceChangeRollout.custom', { defaultValue: "Won't change — custom" })}{' '}
                  <span className="text-muted-foreground">({preview.custom.length})</span>
                </p>
                {preview.custom.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t('priceChangeRollout.none', { defaultValue: 'None.' })}
                  </p>
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
                <p className="text-sm font-medium text-foreground">
                  {t('priceChangeRollout.unreviewed', {
                    defaultValue: "Won't change — not yet classified",
                  })}{' '}
                  <span className="text-muted-foreground">({preview.unreviewed.length})</span>
                </p>
                {preview.unreviewed.length > 0 && (
                  <Alert variant="info">
                    <AlertDescription>
                      {t('priceChangeRollout.unreviewedAlert', {
                        defaultValue: 'These lines bill unchanged until you review them.',
                      })}{' '}
                      {onReviewRates && (
                        <button
                          type="button"
                          id="price-change-review-rates"
                          className="underline"
                          onClick={onReviewRates}
                        >
                          {t('priceChangeRollout.reviewRates', { defaultValue: 'Review rates' })}
                        </button>
                      )}
                    </AlertDescription>
                  </Alert>
                )}
                {preview.unreviewed.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    {t('priceChangeRollout.none', { defaultValue: 'None.' })}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">
                  {t('priceChangeRollout.excluded', { defaultValue: 'Excluded — already invoiced' })}{' '}
                  <span className="text-muted-foreground">({preview.excluded.length})</span>
                </p>
                {preview.excluded.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t('priceChangeRollout.none', { defaultValue: 'None.' })}
                  </p>
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

              {!isReview && (
                <div className="rounded-md border p-3 text-sm">
                  <div className="flex justify-between">
                    <span>
                      {t('priceChangeRollout.totalMonthlyDelta', {
                        defaultValue: 'Total monthly revenue delta',
                      })}
                    </span>
                    <span className="font-medium">
                      {moneySigned(preview.totalMonthlyDeltaCents, preview.currency)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t('priceChangeRollout.acrossAllInherited', {
                      lines: preview.willChange.length,
                      defaultValue: 'Across all {{lines}} inherited line(s).',
                    })}
                  </p>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
