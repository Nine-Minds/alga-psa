'use client';

import React, { useEffect, useState } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import Spinner from '@alga-psa/ui/components/Spinner';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import type { IOpportunityDetail } from '@alga-psa/types';
// Targeted import (not the /actions barrel) so only this action module lands in
// the route's server-reference manifest.
import { getOpportunity } from '@alga-psa/opportunities/actions/opportunityActions';

function formatCents(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format((cents || 0) / 100);
  } catch {
    return `${((cents || 0) / 100).toFixed(2)} ${currency}`;
  }
}

function formatDate(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString();
}

function humanize(value?: string | null): string {
  if (!value) return '';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-sm text-gray-900">{children}</div>
    </div>
  );
}

interface OpportunityActivityPanelProps {
  opportunityId: string;
  onClose: () => void;
}

/**
 * Opportunity next-action activities reuse the SCHEDULE activity type but are not
 * schedule entries, so the generic schedule drawer can't render them. This panel
 * loads the deal and shows a summary with a link to the full opportunity page.
 */
export function OpportunityActivityPanel({ opportunityId, onClose }: OpportunityActivityPanelProps) {
  const { t } = useTranslation('msp/user-activities');
  const [opportunity, setOpportunity] = useState<IOpportunityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getOpportunity(opportunityId)
      .then((result) => {
        if (active) setOpportunity(result);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [opportunityId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner />
      </div>
    );
  }

  if (error || !opportunity) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertDescription>
            {error || t('drawer.opportunityNotFound', { defaultValue: 'Opportunity not found.' })}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const opportunityUrl = `/msp/opportunities/${opportunity.opportunity_id}`;
  const dueDate = formatDate(opportunity.next_action_due);
  const overdue = opportunity.next_action_due ? new Date(opportunity.next_action_due).getTime() < Date.now() : false;
  const closeDate = formatDate(opportunity.expected_close_date);
  const currency = opportunity.currency_code || 'USD';

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-5 overflow-y-auto p-6">
        <div>
          <div className="text-xs font-medium text-gray-500">{opportunity.opportunity_number}</div>
          <h2 className="text-xl font-semibold text-gray-900">{opportunity.title}</h2>
          <div className="mt-1 text-sm text-gray-600">{opportunity.client_name}</div>
        </div>

        {opportunity.next_action ? (
          <div className={`rounded-md border p-3 ${overdue ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-gray-50'}`}>
            <div className="text-xs uppercase tracking-wide text-gray-500">
              {t('drawer.nextAction', { defaultValue: 'Next action' })}
            </div>
            <div className="text-sm font-medium text-gray-900">{opportunity.next_action}</div>
            {dueDate ? (
              <div className={`mt-1 text-xs ${overdue ? 'font-medium text-red-600' : 'text-gray-500'}`}>
                {overdue
                  ? t('drawer.overdueSince', { defaultValue: 'Overdue since {{date}}', date: dueDate })
                  : t('drawer.dueOn', { defaultValue: 'Due {{date}}', date: dueDate })}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-4">
          <Field label={t('drawer.stage', { defaultValue: 'Stage' })}>{humanize(opportunity.stage)}</Field>
          <Field label={t('drawer.confidence', { defaultValue: 'Confidence' })}>{humanize(opportunity.confidence)}</Field>
          <Field label={t('drawer.owner', { defaultValue: 'Owner' })}>{opportunity.owner_name || '—'}</Field>
          {closeDate ? (
            <Field label={t('drawer.expectedClose', { defaultValue: 'Expected close' })}>{closeDate}</Field>
          ) : null}
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Field label={t('drawer.mrr', { defaultValue: 'MRR' })}>{formatCents(opportunity.mrr_cents, currency)}</Field>
          <Field label={t('drawer.nrr', { defaultValue: 'NRR' })}>{formatCents(opportunity.nrr_cents, currency)}</Field>
          <Field label={t('drawer.hardware', { defaultValue: 'Hardware' })}>
            {formatCents(opportunity.hardware_cents, currency)}
          </Field>
        </div>

        {opportunity.contact_name ? (
          <Field label={t('drawer.contact', { defaultValue: 'Contact' })}>
            {opportunity.contact_name}
            {opportunity.contact_email ? ` · ${opportunity.contact_email}` : ''}
          </Field>
        ) : null}

        {opportunity.linked_quotes.length > 0 ? (
          <Field label={t('drawer.linkedQuotes', { defaultValue: 'Linked quotes' })}>
            {opportunity.linked_quotes
              .map((q) => `${q.quote_number} (${formatCents(q.total_amount, q.currency_code || currency)})`)
              .join(', ')}
          </Field>
        ) : null}
      </div>

      <div className="flex-shrink-0 border-t border-gray-200 p-4">
        <a
          href={opportunityUrl}
          onClick={onClose}
          className="inline-flex w-full items-center justify-center rounded-md bg-[rgb(var(--color-primary-500))] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[rgb(var(--color-primary-600))]"
        >
          {t('drawer.openOpportunity', { defaultValue: 'Open Opportunity' })}
        </a>
      </div>
    </div>
  );
}
