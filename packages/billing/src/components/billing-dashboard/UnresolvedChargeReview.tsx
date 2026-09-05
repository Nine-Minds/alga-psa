'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, Info } from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { toast } from 'react-hot-toast';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import {
  acknowledgeCatalogPricing,
  assignContractLineToUnresolvedItem,
  getUnresolvedChargeReview,
  type UnresolvedChargeReviewRow,
} from '@alga-psa/billing/actions/unresolvedChargeActions';

/**
 * The unresolved-item review queue (F068, F137–F142).
 *
 * Two things were wrong before, and this fixes both by telling them apart.
 *
 * An item whose service *no contract covers* is honestly billed at catalog
 * rate — nothing else exists to bill it at — and is labelled as uncovered.
 *
 * An item whose service a contract *does* cover, but where more than one
 * contract line matched, has a negotiated rate that catalog pricing throws
 * away. So it is never billed at catalog rate silently: assign a line, or say
 * out loud that catalog pricing is what you want for this item.
 *
 * The caveat is stated on screen rather than left to be discovered on the
 * invoice: catalog pricing ignores the contract rate, rounding, minimums,
 * overtime, and pricing schedules (F142).
 */

const isReturnedActionError = (value: unknown) =>
  isActionMessageError(value) || isActionPermissionError(value);

interface UnresolvedChargeReviewProps {
  clientId: string;
  windowStart: string;
  windowEnd: string;
  onResolved?: () => void;
}

export function UnresolvedChargeReview({
  clientId,
  windowStart,
  windowEnd,
  onResolved,
}: UnresolvedChargeReviewProps) {
  const { t } = useTranslation('msp/billing');
  const [rows, setRows] = useState<UnresolvedChargeReviewRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyRecordId, setBusyRecordId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await getUnresolvedChargeReview({ clientId, windowStart, windowEnd });
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        setRows([]);
        return;
      }
      setRows(result);
    } finally {
      setIsLoading(false);
    }
  }, [clientId, windowStart, windowEnd]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (recordId: string, action: () => Promise<unknown>, message: string) => {
    setBusyRecordId(recordId);
    try {
      const result = await action();
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      toast.success(message);
      await load();
      onResolved?.();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusyRecordId(null);
    }
  };

  if (isLoading) {
    return <Skeleton className="h-32 w-full" />;
  }
  if (rows.length === 0) {
    return null;
  }

  const ambiguousCount = rows.filter((row) => row.reason !== 'no_match').length;

  return (
    <Card className="p-6">
      <div className="mb-3">
        <h3 className="text-lg font-semibold">
          {t('unresolvedReview.title', { defaultValue: 'Items without a contract line' })}
        </h3>
        <p className="text-sm text-gray-500">
          {t('unresolvedReview.description', {
            defaultValue:
              'These items are not attached to a contract line yet, so they would be billed at the service catalog rate.',
          })}
        </p>
      </div>

      {/* F142 — the caveat, stated where the decision is made. */}
      <Alert className="mb-4">
        <Info className="h-4 w-4" />
        <AlertDescription>
          {t('unresolvedReview.catalogPricingCaveat', {
            defaultValue:
              'Catalog pricing ignores the contract rate, rounding, minimum billable time, overtime, and any pricing schedule.',
          })}
        </AlertDescription>
      </Alert>

      {ambiguousCount > 0 && (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {t('unresolvedReview.ambiguousBlocked', {
              count: ambiguousCount,
              defaultValue:
                '{{count}} item(s) are covered by a contract but matched more than one contract line. They will not be invoiced until you assign a line or choose catalog pricing for them.',
            })}
          </AlertDescription>
        </Alert>
      )}

      <ul className="divide-y divide-gray-200">
        {rows.map((row) => {
          const isUncovered = row.reason === 'no_match';
          const isBusy = busyRecordId === row.recordId;
          return (
            <li key={`${row.kind}:${row.recordId}`} className="py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {row.serviceName ??
                        t('unresolvedReview.unknownService', { defaultValue: 'Unknown service' })}
                    </span>
                    <Badge variant={isUncovered ? 'default-muted' : 'warning'}>
                      {isUncovered
                        ? t('unresolvedReview.reason.uncovered', {
                            defaultValue: 'Not covered by any contract',
                          })
                        : t('unresolvedReview.reason.ambiguous', {
                            defaultValue: 'More than one contract line matches',
                          })}
                    </Badge>
                    {row.catalogPricingAcknowledgedAt && (
                      <Badge variant="info">
                        {t('unresolvedReview.catalogPricingChosen', {
                          defaultValue: 'Catalog pricing chosen',
                        })}
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">
                    {row.kind === 'time_entry'
                      ? t('unresolvedReview.timeEntry', {
                          minutes: row.quantity,
                          defaultValue: 'Time entry · {{minutes}} min',
                        })
                      : t('unresolvedReview.usageRecord', {
                          quantity: row.quantity,
                          defaultValue: 'Usage record · {{quantity}}',
                        })}
                    {row.workDate ? ` · ${row.workDate.slice(0, 10)}` : ''}
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    {isUncovered
                      ? t('unresolvedReview.uncoveredExplanation', {
                          defaultValue:
                            'No contract covers this service, so the catalog rate is the only rate available. It will be billed as-is.',
                        })
                      : t('unresolvedReview.ambiguousExplanation', {
                          defaultValue:
                            'A contract covers this service, so a negotiated rate exists. Pick the contract line it belongs to.',
                        })}
                  </p>
                </div>

                {!isUncovered && (
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <CustomSelect
                      id={`assign-line-${row.recordId}`}
                      value=""
                      placeholder={t('unresolvedReview.assignLine', {
                        defaultValue: 'Assign a contract line',
                      })}
                      options={row.eligibleContractLines.map((line) => ({
                        value: line.contractLineId,
                        label: line.contractName
                          ? `${line.contractName} — ${line.contractLineName}`
                          : line.contractLineName,
                      }))}
                      disabled={isBusy}
                      onValueChange={(contractLineId) =>
                        void run(
                          row.recordId,
                          () =>
                            assignContractLineToUnresolvedItem({
                              kind: row.kind,
                              recordId: row.recordId,
                              contractLineId,
                            }),
                          t('unresolvedReview.assigned', {
                            defaultValue: 'Assigned — this item will bill at contract pricing.',
                          }),
                        )
                      }
                      className="w-[280px]"
                    />
                    <Button
                      id={`catalog-pricing-${row.recordId}`}
                      variant={row.catalogPricingAcknowledgedAt ? 'default' : 'outline'}
                      size="sm"
                      disabled={isBusy}
                      onClick={() =>
                        void run(
                          row.recordId,
                          () =>
                            acknowledgeCatalogPricing({
                              kind: row.kind,
                              recordId: row.recordId,
                              accepted: !row.catalogPricingAcknowledgedAt,
                            }),
                          row.catalogPricingAcknowledgedAt
                            ? t('unresolvedReview.catalogPricingRevoked', {
                                defaultValue: 'Catalog pricing withdrawn.',
                              })
                            : t('unresolvedReview.catalogPricingAccepted', {
                                defaultValue: 'Catalog pricing chosen for this item.',
                              }),
                        )
                      }
                    >
                      {row.catalogPricingAcknowledgedAt ? (
                        <>
                          <Check className="mr-1 h-4 w-4" />
                          {t('unresolvedReview.undoCatalogPricing', { defaultValue: 'Undo' })}
                        </>
                      ) : (
                        t('unresolvedReview.useCatalogPricing', {
                          defaultValue: 'Use catalog pricing',
                        })
                      )}
                    </Button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export default UnresolvedChargeReview;
