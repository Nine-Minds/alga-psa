'use client';

import React, { useEffect, useState } from 'react';
import { Card } from '@alga-psa/ui/components/Card';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { Wallet } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ClientPortalCreditSummary } from '../../actions/client-portal-actions/client-billing';

interface CreditsSummaryCardProps {
  formatCurrency: (amount: number, currencyCode?: string) => string;
  formatDate: (date: string | { toString(): string } | undefined | null) => string;
}

function isActionError(value: unknown): boolean {
  const candidate = value as Record<string, unknown> | null;
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    (typeof candidate.actionError === 'string' || typeof candidate.permissionError === 'string')
  );
}

/**
 * Available-credit card for the portal billing overview: headline derived
 * balance plus the client's recent credit history with provenance.
 */
export default function CreditsSummaryCard({ formatCurrency, formatDate }: CreditsSummaryCardProps) {
  const { t } = useTranslation('features/billing');
  const [summary, setSummary] = useState<ClientPortalCreditSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

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
            </>
          )}
        </div>
        <Wallet className="h-5 w-5 text-gray-400" />
      </div>
    </Card>
  );
}
