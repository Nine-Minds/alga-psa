'use client';

import React from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { formatCurrencyFromMinorUnits } from '@alga-psa/core';
import type { IOpportunityDetail, OpportunityConfidence } from '@alga-psa/types';
import { EvidenceLadder } from '../EvidenceLadder';
import { WhySentenceText } from '../WhySentenceText';

const OPPORTUNITY_TYPE_DEFAULTS = {
  new_logo: 'New client',
  expansion: 'Expansion',
  renewal: 'Renewal',
  project: 'Project',
} as const;

export interface OpportunityDetailViewProps {
  detail: IOpportunityDetail;
  /** Timeline feed (interactions) rendered by the host, so the module reuses the standard interactions UI. */
  timeline?: React.ReactNode;
  /** EE commitments ledger, injected by the host app when the management tier allows it. */
  commitments?: React.ReactNode;
  onCompleteAction: (opportunityId: string) => void;
  onDeclareQualified: (opportunityId: string) => void;
  onConfidenceChange: (opportunityId: string, confidence: OpportunityConfidence) => void;
  onWin: (opportunityId: string) => void;
  onLose: (opportunityId: string) => void;
  onDelete: (opportunityId: string) => void;
  onCreateQuote: (opportunityId: string) => void;
  onLinkQuote: (opportunityId: string) => void;
  onOpenQuote: (quoteId: string) => void;
  onUnlinkQuote: (quoteId: string) => void;
  onEditValues?: (opportunityId: string) => void;
  onEditDetails?: (opportunityId: string) => void;
  /** Present only when the AI module is enabled for the tenant. */
  onDraftFollowUp?: (opportunityId: string) => void;
}

/**
 * The deal working surface. The next action is the screen's one primary
 * button; win/lose are deliberately quiet until the evidence carries the deal
 * to Verbal. Values are read-only once a quote locks them.
 */
export function OpportunityDetailView({
  detail,
  timeline,
  commitments,
  onCompleteAction,
  onDeclareQualified,
  onConfidenceChange,
  onWin,
  onLose,
  onDelete,
  onCreateQuote,
  onLinkQuote,
  onOpenQuote,
  onUnlinkQuote,
  onEditValues,
  onEditDetails,
  onDraftFollowUp,
}: OpportunityDetailViewProps) {
  const { t } = useTranslation();
  const fmt = (cents: number) => formatCurrencyFromMinorUnits(cents, undefined, detail.currency_code);
  const open = detail.status === 'open';
  const overdue =
    open && detail.next_action_due != null && new Date(detail.next_action_due).getTime() < Date.now();
  const qualifiedPending = detail.ladder.some((s) => s.checkpoint === 'qualified' && s.state !== 'reached');

  const confidenceOptions = (['low', 'medium', 'high', 'committed'] as OpportunityConfidence[]).map((c) => ({
    value: c,
    label: t(`opportunities.confidence.${c}`, c.charAt(0).toUpperCase() + c.slice(1)),
  }));

  return (
    <div id={`opportunity-detail-${detail.opportunity_id}`} className="mx-auto w-full max-w-3xl space-y-5">
      {/* Header */}
      <header>
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-xl font-semibold text-[rgb(var(--color-text-900))]">{detail.title}</h1>
          {detail.status === 'won' ? (
            <Badge variant="success">{t('opportunities.status.won', 'Won')}</Badge>
          ) : detail.status === 'lost' ? (
            <Badge variant="error">{t('opportunities.status.lost', 'Lost')}</Badge>
          ) : null}
          <span className="font-mono text-xs text-[rgb(var(--color-text-400))]">{detail.opportunity_number}</span>
          {open && onEditDetails ? (
            <Button
              id="opportunity-detail-edit"
              size="xs"
              variant="ghost"
              onClick={() => onEditDetails(detail.opportunity_id)}
            >
              {t('common.edit', 'Edit')}
            </Button>
          ) : null}
        </div>
        <div className="mt-0.5 text-sm text-[rgb(var(--color-text-500))]">
          {detail.client_name}
          {detail.client_lifecycle_status === 'prospect' ? (
            <Badge variant="default-muted" size="sm" className="ml-2">
              {t('opportunities.prospect', 'Prospect')}
            </Badge>
          ) : null}
          {detail.contact_name ? ` · ${detail.contact_name}` : ''}
          {` · ${t('opportunities.detail.owner', 'Owner')}: ${detail.owner_name}`}
        </div>
        <div id="opportunity-detail-metadata" className="mt-1 text-xs text-[rgb(var(--color-text-400))]">
          {t(
            `opportunities.type.${detail.opportunity_type}`,
            OPPORTUNITY_TYPE_DEFAULTS[detail.opportunity_type]
          )}
          {detail.expected_close_date
            ? ` · ${t('opportunities.detail.expectedClose', 'Expected close')}: ${new Date(
                `${detail.expected_close_date.slice(0, 10)}T12:00:00`
              ).toLocaleDateString()}`
            : ''}
        </div>
        {detail.why.segments.length > 0 ? (
          <p className="mt-2 text-[13px] leading-relaxed text-[rgb(var(--color-text-500))]">
            <WhySentenceText why={detail.why} />
          </p>
        ) : null}
      </header>

      {/* Evidence ladder */}
      <section className="rounded-xl border border-[rgb(var(--color-border-200))] bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-[rgb(var(--color-text-400))]">
            {t('opportunities.detail.evidence', 'Evidence')}
          </h2>
          {open && qualifiedPending ? (
            <Button
              id="opportunity-detail-declare-qualified"
              size="xs"
              variant="outline"
              onClick={() => onDeclareQualified(detail.opportunity_id)}
            >
              {t('opportunities.detail.declareQualified', 'Mark qualified')}
            </Button>
          ) : null}
        </div>
        <EvidenceLadder steps={detail.ladder} />
      </section>

      {/* Next action — the screen's one primary */}
      {open ? (
        <section
          className={`rounded-xl border p-4 ${
            overdue
              ? 'border-[rgb(var(--color-accent-200,254_202_202))] bg-[rgb(var(--color-accent-50,254_242_242))]'
              : 'border-[rgb(var(--color-border-200))] bg-white'
          }`}
        >
          <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[rgb(var(--color-text-400))]">
            {overdue
              ? t('opportunities.detail.nextActionOverdue', 'Next action · overdue')
              : t('opportunities.detail.nextAction', 'Next action')}
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex-1 text-sm font-semibold text-[rgb(var(--color-text-900))]">
              {detail.next_action}
            </span>
            {detail.next_action_due ? (
              <span
                className={`text-xs font-medium ${
                  overdue ? 'text-[rgb(var(--badge-error-text))]' : 'text-[rgb(var(--color-text-500))]'
                }`}
              >
                {t('opportunities.detail.due', 'due {{date}}', {
                  date: new Date(detail.next_action_due).toLocaleDateString(),
                })}
              </span>
            ) : null}
            {onDraftFollowUp ? (
              <Button
                id="opportunity-detail-draft"
                size="sm"
                variant="soft"
                onClick={() => onDraftFollowUp(detail.opportunity_id)}
              >
                {t('opportunities.detail.draftFollowUp', 'Draft the follow-up')}
              </Button>
            ) : null}
            <Button
              id="opportunity-detail-complete-action"
              size="sm"
              variant="default"
              onClick={() => onCompleteAction(detail.opportunity_id)}
            >
              {t('opportunities.queue.completeAction', 'Done → set next')}
            </Button>
          </div>
        </section>
      ) : null}

      {/* Values + confidence */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-[rgb(var(--color-border-200))] bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-[rgb(var(--color-text-400))]">
              {t('opportunities.detail.value', 'Value')}
            </h2>
            {open && !detail.values_locked_by_quote && onEditValues ? (
              <Button
                id="opportunity-detail-edit-values"
                size="xs"
                variant="ghost"
                onClick={() => onEditValues(detail.opportunity_id)}
              >
                {t('common.edit', 'Edit')}
              </Button>
            ) : detail.values_locked_by_quote ? (
              <span className="text-[11px] text-[rgb(var(--color-text-400))]">
                {t('opportunities.detail.valuesFromQuote', 'from accepted quote')}
              </span>
            ) : null}
          </div>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-[rgb(var(--color-text-500))]">{t('opportunities.detail.recurring', 'Recurring')}</dt>
              <dd className="font-medium tabular-nums text-[rgb(var(--color-text-900))]">
                {fmt(detail.mrr_cents)}
                {t('opportunities.perMonthSuffix', '/mo')}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[rgb(var(--color-text-500))]">{t('opportunities.detail.oneTime', 'One-time')}</dt>
              <dd className="font-medium tabular-nums text-[rgb(var(--color-text-900))]">{fmt(detail.nrr_cents)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[rgb(var(--color-text-500))]">{t('opportunities.detail.hardware', 'Hardware')}</dt>
              <dd className="font-medium tabular-nums text-[rgb(var(--color-text-900))]">
                {fmt(detail.hardware_cents)}
              </dd>
            </div>
          </dl>
        </div>
        <div className="rounded-xl border border-[rgb(var(--color-border-200))] bg-white p-4">
          <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[rgb(var(--color-text-400))]">
            {t('opportunities.detail.confidence', 'Your confidence')}
          </h2>
          <CustomSelect
            id="opportunity-detail-confidence"
            options={confidenceOptions}
            value={detail.confidence}
            onValueChange={(v: string) => onConfidenceChange(detail.opportunity_id, v as OpportunityConfidence)}
            disabled={!open}
          />
          <p className="mt-2 text-[11px] leading-relaxed text-[rgb(var(--color-text-400))]">
            {t(
              'opportunities.detail.confidenceNote',
              'Confidence is yours; the stage comes from evidence. The two are compared, never merged.'
            )}
          </p>
        </div>
      </section>

      {/* Linked quotes */}
      <section className="rounded-xl border border-[rgb(var(--color-border-200))] bg-white p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-[rgb(var(--color-text-400))]">
            {t('opportunities.detail.quotes', 'Quotes')}
          </h2>
          {open ? (
            <div className="flex items-center gap-2">
              <Button
                id="opportunity-detail-link-quote"
                size="xs"
                variant="ghost"
                onClick={() => onLinkQuote(detail.opportunity_id)}
              >
                {t('opportunities.detail.linkQuote', 'Link existing')}
              </Button>
              <Button
                id="opportunity-detail-create-quote"
                size="xs"
                variant="soft"
                onClick={() => onCreateQuote(detail.opportunity_id)}
              >
                {t('opportunities.detail.createQuote', 'Create quote')}
              </Button>
            </div>
          ) : null}
        </div>
        {detail.linked_quotes.length === 0 ? (
          <p className="text-[13px] text-[rgb(var(--color-text-400))]">
            {t('opportunities.detail.noQuotes', 'No quote yet. A sent quote moves this deal to Proposed on its own.')}
          </p>
        ) : (
          <ul className="divide-y divide-[rgb(var(--color-border-100,241_245_249))]">
            {detail.linked_quotes.map((q) => (
              <li key={q.quote_id} className="flex items-center justify-between py-2 text-sm">
                <button
                  type="button"
                  id={`opportunity-detail-quote-${q.quote_id}`}
                  className="font-medium text-[rgb(var(--color-primary-600))] hover:underline"
                  onClick={() => onOpenQuote(q.quote_id)}
                >
                  {q.quote_number}
                </button>
                <span className="flex items-center gap-3">
                  <Badge variant={q.status === 'accepted' ? 'success' : 'default-muted'} size="sm">
                    {q.status}
                  </Badge>
                  <span className="tabular-nums text-[rgb(var(--color-text-700))]">
                    {formatCurrencyFromMinorUnits(q.total_amount, undefined, q.currency_code)}
                  </span>
                  {open ? (
                    <Button
                      id={`opportunity-detail-unlink-quote-${q.quote_id}`}
                      size="xs"
                      variant="ghost"
                      onClick={() => onUnlinkQuote(q.quote_id)}
                    >
                      {t('opportunities.detail.unlinkQuote', 'Unlink')}
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {commitments}

      {/* Close the deal — quiet until evidence carries it */}
      {open ? (
        <section className="flex items-center justify-between gap-2">
          <Button
            id="opportunity-detail-delete"
            size="sm"
            variant="ghost"
            onClick={() => onDelete(detail.opportunity_id)}
          >
            {t('common.delete', 'Delete')}
          </Button>
          <div className="flex items-center gap-2">
            <Button id="opportunity-detail-lose" size="sm" variant="ghost" onClick={() => onLose(detail.opportunity_id)}>
              {t('opportunities.detail.markLost', 'Mark lost')}
            </Button>
            <Button id="opportunity-detail-win" size="sm" variant="soft" onClick={() => onWin(detail.opportunity_id)}>
              {t('opportunities.detail.markWon', 'Mark won')}
            </Button>
          </div>
        </section>
      ) : null}

      {/* Timeline */}
      {timeline ? (
        <section className="rounded-xl border border-[rgb(var(--color-border-200))] bg-white p-4">
          <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[rgb(var(--color-text-400))]">
            {t('opportunities.detail.timeline', 'Timeline')}
          </h2>
          {timeline}
        </section>
      ) : null}
    </div>
  );
}
