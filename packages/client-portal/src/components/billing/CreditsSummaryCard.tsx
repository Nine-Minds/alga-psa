'use client';

import React, { useEffect, useState } from 'react';
import { Card } from '@alga-psa/ui/components/Card';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Wallet, History } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type {
  ClientPortalCreditSummary,
  ClientPortalCreditHistoryEntry,
} from '../../actions/client-portal-actions/client-billing';

interface CreditsSummaryCardProps {
  formatCurrency: (amount: number, currencyCode?: string) => string;
  formatDate: (date: string | { toString(): string } | undefined | null) => string;
}

type TranslateFn = ReturnType<typeof useTranslation>['t'];

function isActionError(value: unknown): boolean {
  const candidate = value as Record<string, unknown> | null;
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    (typeof candidate.actionError === 'string' || typeof candidate.permissionError === 'string')
  );
}

function getCreditHistoryLabel(t: TranslateFn, entry: ClientPortalCreditHistoryEntry): string {
  const invoiceNumber = entry.invoice_number;
  switch (entry.type) {
    case 'prepayment':
      return invoiceNumber
        ? t('credits.history.issuedWithInvoice', {
            invoice: invoiceNumber,
            defaultValue: 'Issued — prepayment #{{invoice}}',
          })
        : t('credits.history.issued', 'Issued');
    case 'credit_application':
      return invoiceNumber
        ? t('credits.history.appliedToInvoice', {
            invoice: invoiceNumber,
            defaultValue: 'Applied to invoice #{{invoice}}',
          })
        : t('credits.history.applied', 'Applied');
    case 'credit_issuance':
      return invoiceNumber
        ? t('credits.history.issuedForInvoice', {
            invoice: invoiceNumber,
            defaultValue: 'Issued — invoice #{{invoice}}',
          })
        : t('credits.history.issued', 'Issued');
    case 'credit_issuance_from_negative_invoice':
      return t('credits.history.issuedFromCreditNote', 'Issued from credit note');
    case 'credit_adjustment':
      return t('credits.history.adjusted', 'Adjusted');
    case 'credit_expiration':
      return t('credits.history.expired', 'Expired');
    case 'credit_transfer':
      return t('credits.history.transferred', 'Transferred');
    default:
      return t('credits.history.transaction', 'Credit activity');
  }
}

/**
 * Available-credit card for the portal billing overview: headline derived
 * balance plus the client's recent credit history with provenance. A "View
 * history" link opens a ledger dialog of recent credit transactions.
 */
export default function CreditsSummaryCard({ formatCurrency, formatDate }: CreditsSummaryCardProps) {
  const { t } = useTranslation('features/billing');
  const [summary, setSummary] = useState<ClientPortalCreditSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [history, setHistory] = useState<ClientPortalCreditHistoryEntry[] | null>(null);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Deferred so component test environments never load the server-action
        // module graph; failures degrade to hiding the card.
        const { getClientCreditSummary } = await import(
          '../../actions/client-portal-actions/client-billing'
        );
        const result = await getClientCreditSummary();
        if (cancelled) return;
        if (isActionError(result)) {
          setUnavailable(true);
          return;
        }
        setSummary(result as ClientPortalCreditSummary);
      } catch (error) {
        console.error('Error loading credit summary:', error);
        if (!cancelled) setUnavailable(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the ledger when the dialog opens. Degrades to the dialog's empty
  // state on any error — the card itself is unaffected.
  useEffect(() => {
    if (!isHistoryOpen) {
      return;
    }
    let cancelled = false;
    setIsHistoryLoading(true);
    (async () => {
      try {
        const { getClientCreditHistory } = await import(
          '../../actions/client-portal-actions/client-billing'
        );
        const result = await getClientCreditHistory();
        if (cancelled) return;
        if (isActionError(result)) {
          setHistory([]);
          return;
        }
        setHistory(result as ClientPortalCreditHistoryEntry[]);
      } catch (error) {
        console.error('Error loading credit history:', error);
        if (!cancelled) setHistory([]);
      } finally {
        if (!cancelled) setIsHistoryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isHistoryOpen]);

  if (unavailable) {
    return null;
  }

  const activeCredits = summary?.credits.filter(
    (credit) => !credit.is_expired && credit.remaining_amount > 0
  ) ?? [];

  return (
    <Card id="available-credit-card" className="p-6">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-500">
            {t('credits.availableCredit', 'Available Credit')}
          </p>
          {loading ? (
            <>
              <Skeleton className="mt-2 h-8 w-3/4" />
              <Skeleton className="mt-1 h-4 w-1/2" />
            </>
          ) : (
            <>
              <p className="mt-2 text-3xl font-semibold">
                {formatCurrency(summary?.available_credit ?? 0, activeCredits[0]?.currency_code ?? undefined)}
              </p>
              <p className="mt-1 text-sm text-gray-500">
                {t('credits.appliedAutomatically', 'Applied automatically to your next invoice.')}
              </p>
              {activeCredits.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {activeCredits.slice(0, 3).map((credit) => (
                    <li key={credit.credit_id} className="flex items-center justify-between gap-2 text-sm text-gray-500">
                      <span className="truncate">
                        {credit.description || t('credits.credit', 'Credit')}
                      </span>
                      <span className="shrink-0 inline-flex items-center gap-2">
                        {formatCurrency(credit.remaining_amount, credit.currency_code ?? undefined)}
                        {credit.expiration_date && (
                          <Badge variant="secondary">
                            {t('credits.expires', { date: formatDate(credit.expiration_date), defaultValue: 'Expires {{date}}' })}
                          </Badge>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <Button
                id="credits-view-history-button"
                className="mt-3 w-full"
                variant="outline"
                onClick={() => setIsHistoryOpen(true)}
              >
                <History className="mr-2 h-4 w-4" />
                {t('credits.history.viewHistory', 'View history')}
              </Button>
            </>
          )}
        </div>
        <Wallet className="h-5 w-5 text-gray-400" />
      </div>

      <Dialog
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        title={t('credits.history.title', 'Credit History')}
        id="credit-history-dialog"
        data-automation-id="credit-history-dialog"
      >
        <DialogContent>
          <div className="space-y-1" data-automation-id="credit-history-content">
            {isHistoryLoading ? (
              <div className="space-y-4">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                    <div className="space-y-1">
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                  </div>
                ))}
              </div>
            ) : !history || history.length === 0 ? (
              <div className="py-8 text-center">
                <History className="mx-auto h-8 w-8 text-gray-400" />
                <p className="mt-2 text-sm text-gray-500">
                  {t('credits.history.empty', 'No credit activity yet')}
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {history.map((entry) => (
                  <li key={entry.transaction_id} className="flex items-start justify-between gap-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900">
                        {getCreditHistoryLabel(t, entry)}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {formatDate(entry.created_at)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={entry.amount >= 0 ? 'text-sm font-semibold text-success' : 'text-sm font-medium'}>
                        {entry.amount >= 0 ? '+' : '−'}
                        {formatCurrency(Math.abs(entry.amount), entry.currency_code ?? undefined)}
                      </p>
                      {entry.balance_after != null && (
                        <p className="mt-0.5 text-xs text-gray-500">
                          {t('credits.history.balance', {
                            amount: formatCurrency(entry.balance_after, entry.currency_code ?? undefined),
                            defaultValue: 'balance {{amount}}',
                          })}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
