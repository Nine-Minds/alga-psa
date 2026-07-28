'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { formatCurrencyFromMinorUnits, formatDateOnly } from '@alga-psa/core';
import type { ICreditTracking, ITransaction } from '@alga-psa/types';
import { getCreditDetail } from './actions';
import DetailField from './DetailField';

interface CreditDetailDialogProps {
  creditId: string | null;
  clientName?: string;
  onClose: () => void;
}

interface CreditDetailData {
  credit: ICreditTracking;
  transactions: ITransaction[];
  invoice?: { invoice_number?: string };
}

export default function CreditDetailDialog({ creditId, clientName, onClose }: CreditDetailDialogProps) {
  const { t } = useTranslation('msp/credits');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<CreditDetailData | null>(null);

  useEffect(() => {
    if (!creditId) {
      setDetail(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    getCreditDetail(creditId)
      .then((result) => {
        if (cancelled) return;
        if (result.success && result.data) {
          setDetail(result.data as CreditDetailData);
        } else {
          setError(result.error || t('viewDialog.loadFailed', { defaultValue: 'Failed to load credit details.' }));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(t('viewDialog.loadFailed', { defaultValue: 'Failed to load credit details.' }));
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [creditId, t]);

  const credit = detail?.credit;

  return (
    <Dialog isOpen={Boolean(creditId)} onClose={onClose}>
      <DialogContent className="max-w-2xl">
        <h2 className="text-xl font-semibold mb-4">
          {t('viewDialog.title', { defaultValue: 'Credit Details' })}
        </h2>

        {isLoading && (
          <div className="space-y-3">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {credit && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <DetailField
                label={t('columns.creditId', { defaultValue: 'Credit ID' })}
                value={credit.credit_id}
                mono
              />
              <DetailField
                label={t('columns.client', { defaultValue: 'Client' })}
                value={clientName || t('status.na', { defaultValue: 'N/A' })}
              />
              <DetailField
                label={t('columns.originalAmount', { defaultValue: 'Original Amount' })}
                value={formatCurrencyFromMinorUnits(Number(credit.amount))}
              />
              <DetailField
                label={t('columns.remaining', { defaultValue: 'Remaining' })}
                value={formatCurrencyFromMinorUnits(Number(credit.remaining_amount))}
              />
              <DetailField
                label={t('columns.created', { defaultValue: 'Created' })}
                value={formatDateOnly(new Date(credit.created_at))}
              />
              <DetailField
                label={t('columns.expires', { defaultValue: 'Expires' })}
                value={
                  credit.expiration_date
                    ? formatDateOnly(new Date(credit.expiration_date))
                    : t('status.never', { defaultValue: 'Never' })
                }
              />
              <DetailField
                label={t('columns.status', { defaultValue: 'Status' })}
                value={
                  credit.is_expired
                    ? t('status.expired', { defaultValue: 'Expired' })
                    : t('status.active', { defaultValue: 'Active' })
                }
              />
              {detail?.invoice?.invoice_number && (
                <DetailField
                  label={t('viewDialog.invoice', { defaultValue: 'Invoice' })}
                  value={detail.invoice.invoice_number}
                />
              )}
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-2">
                {t('viewDialog.transactions', { defaultValue: 'Related Transactions' })}
              </h3>
              {detail && detail.transactions.length > 0 ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[rgb(var(--color-border-200))] text-left">
                      <th className="px-2 py-1">{t('viewDialog.transactionType', { defaultValue: 'Type' })}</th>
                      <th className="px-2 py-1">{t('reconciliation.fields.date', { defaultValue: 'Date' })}</th>
                      <th className="px-2 py-1 text-right">{t('reconciliation.fields.amount', { defaultValue: 'Amount' })}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.transactions.map((tx) => (
                      <tr key={tx.transaction_id} className="border-b border-[rgb(var(--color-border-200))]">
                        <td className="px-2 py-1">{tx.description || tx.type}</td>
                        <td className="px-2 py-1">{formatDateOnly(new Date(tx.created_at))}</td>
                        <td className="px-2 py-1 text-right">{formatCurrencyFromMinorUnits(Number(tx.amount))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-[rgb(var(--color-text-500))]">
                  {t('viewDialog.noTransactions', { defaultValue: 'No related transactions found.' })}
                </p>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
