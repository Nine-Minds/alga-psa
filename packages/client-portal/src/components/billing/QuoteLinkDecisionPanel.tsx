'use client';

/**
 * Accept / reject panel for the public (email-link) quote page - alga-2026-0002820 (4/6).
 *
 * Self-contained: it receives the resolved quote view-model and the access token and
 * mounts anywhere on the public quote page. Typed name + agreement checkbox is the
 * signature (no drawn pad). Optional-item toggles only change the local preview; the
 * selection is committed by Accept, exactly as in the client portal. The server
 * re-validates everything - nothing rendered here is trusted.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { computeQuoteTotals, isOptional, isQuoteItemIncluded } from '@alga-psa/core';
import type { IQuoteItem } from '@alga-psa/types';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Dialog, DialogContent, DialogDescription } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Switch } from '@alga-psa/ui/components/Switch';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { useCurrencyFormat } from '@alga-psa/ui/lib';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';

export interface QuoteLinkAgreement {
  version: string;
  text: string;
  hash: string;
}

export interface QuoteLinkDecisionPanelProps {
  /** The raw access token from the URL; only used to address the decision route. */
  token: string;
  /** Quote lines. Optional rows need `tax_amount_if_included` for the live preview. */
  items: IQuoteItem[];
  currencyCode?: string;
  /** Persisted totals, shown when no preview is available. */
  totals: { subtotal: number; discount_total?: number; tax: number; total_amount: number };
  /** Current agreement wording from the server (getCurrentQuoteAgreement). */
  agreement: QuoteLinkAgreement;
  /** The quote's status when the page was rendered; the panel only acts on `sent`. */
  quoteStatus: string;
  /** Optional signer prefill, e.g. the recipient's name. */
  defaultSignerName?: string;
}

type PanelState =
  | { kind: 'form' }
  | { kind: 'decided'; decision: 'accepted' | 'rejected'; decidedAt?: string; already: boolean }
  | { kind: 'changed' }
  | { kind: 'invalid' };

const UNASSIGNED = '__unassigned__';

const QuoteLinkDecisionPanel: React.FC<QuoteLinkDecisionPanelProps> = ({
  token, items, currencyCode, totals, agreement, quoteStatus, defaultSignerName,
}) => {
  const { t } = useTranslation('features/billing');
  const { money } = useCurrencyFormat();
  const { formatDate } = useFormatters();

  const [state, setState] = useState<PanelState>({ kind: 'form' });
  const [name, setName] = useState(defaultSignerName ?? '');
  const [title, setTitle] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [comment, setComment] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(items.filter((i) => isOptional(i) && isQuoteItemIncluded(i)).map((i) => i.quote_item_id)),
  );

  const optionalItems = useMemo(() => items.filter((i) => i.is_optional), [items]);
  const canDecide = quoteStatus === 'sent';

  const previewItems = useMemo(
    () => items.map((i) => (i.is_optional ? { ...i, is_selected: selected.has(i.quote_item_id) } : i)),
    [items, selected],
  );
  const preview = useMemo(() => {
    if (!canDecide || optionalItems.length === 0) return null;
    const base = previewItems.filter((i) => !i.is_discount);
    if (base.some((i) => typeof i.tax_amount_if_included !== 'number')) return null;
    return computeQuoteTotals(
      previewItems.map((i) => ({
        ...i,
        id: i.quote_item_id,
        groupKey: i.location_id && i.location_id.trim().length > 0 ? i.location_id : UNASSIGNED,
        taxAmountIfIncluded: i.tax_amount_if_included ?? 0,
      })),
    );
  }, [canDecide, optionalItems.length, previewItems]);

  const shown = preview
    ? { subtotal: preview.subtotal, tax: preview.tax, total: preview.totalAmount }
    : { subtotal: totals.subtotal, tax: totals.tax, total: totals.total_amount };

  const submit = useCallback(async (action: 'accept' | 'reject') => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/quote-link/${encodeURIComponent(token)}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          signerName: name,
          signerTitle: title,
          agreed,
          agreementVersion: agreement.version,
          agreementTextHash: agreement.hash,
          selectedOptionalQuoteItemIds: [...selected],
          comment,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (body.status === 'decided') {
        setState({ kind: 'decided', decision: body.decision, decidedAt: body.decidedAt, already: false });
      } else if (body.status === 'already_decided') {
        setState({ kind: 'decided', decision: body.decision, decidedAt: body.decidedAt, already: true });
      } else if (body.status === 'changed') {
        setState({ kind: 'changed' });
      } else if (body.status === 'invalid_link') {
        setState({ kind: 'invalid' });
      } else if (body.status === 'invalid_input') {
        setError(inputProblemMessage(body.problem));
      } else {
        setError(t('quotes.publicDecision.errors.generic', { defaultValue: 'Something went wrong. Please try again.' }));
      }
    } catch {
      setError(t('quotes.publicDecision.errors.generic', { defaultValue: 'Something went wrong. Please try again.' }));
    } finally {
      setSubmitting(false);
      setRejectOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, name, title, agreed, agreement, selected, comment, t]);

  function inputProblemMessage(problem: string): string {
    switch (problem) {
      case 'name_required':
        return t('quotes.publicDecision.errors.nameRequired', { defaultValue: 'Please type your full name.' });
      case 'agreement_required':
        return t('quotes.publicDecision.errors.agreementRequired', { defaultValue: 'Please confirm the agreement to accept this quote.' });
      case 'agreement_outdated':
        return t('quotes.publicDecision.errors.agreementOutdated', { defaultValue: 'The agreement wording has been updated. Please reload this page and try again.' });
      case 'comment_required':
        return t('quotes.publicDecision.errors.commentRequired', { defaultValue: 'Please add a short comment before rejecting this quote.' });
      case 'too_long':
        return t('quotes.publicDecision.errors.tooLong', { defaultValue: 'One of your entries is too long.' });
      default:
        return t('quotes.publicDecision.errors.generic', { defaultValue: 'Something went wrong. Please try again.' });
    }
  }

  if (state.kind === 'invalid') {
    return (
      <Alert id="quote-link-invalid" variant="destructive">
        <AlertTitle>{t('quotes.publicDecision.invalid.title', { defaultValue: 'This link is not valid' })}</AlertTitle>
        <AlertDescription>
          {t('quotes.publicDecision.invalid.body', { defaultValue: 'This link can no longer be used. Please contact the sender for a new one.' })}
        </AlertDescription>
      </Alert>
    );
  }

  if (state.kind === 'changed') {
    return (
      <Alert id="quote-link-changed" variant="warning">
        <AlertTitle>{t('quotes.publicDecision.changed.title', { defaultValue: 'This quote has changed' })}</AlertTitle>
        <AlertDescription>
          {t('quotes.publicDecision.changed.body', { defaultValue: 'This quote has changed since you opened it. Please contact us.' })}
        </AlertDescription>
      </Alert>
    );
  }

  if (state.kind === 'decided') {
    const date = state.decidedAt ? formatDate(state.decidedAt) : '';
    const accepted = state.decision === 'accepted';
    return (
      <Alert id="quote-link-decided" variant={state.already ? 'info' : accepted ? 'success' : 'default'}>
        <AlertTitle>
          {state.already
            ? t('quotes.publicDecision.already.title', { defaultValue: 'This quote has already been answered' })
            : accepted
              ? t('quotes.publicDecision.accepted.title', { defaultValue: 'Quote accepted' })
              : t('quotes.publicDecision.rejected.title', { defaultValue: 'Quote rejected' })}
        </AlertTitle>
        <AlertDescription>
          {state.already
            ? (accepted
                ? t('quotes.publicDecision.already.accepted', { defaultValue: 'This quote was accepted on {{date}}.', date })
                : t('quotes.publicDecision.already.rejected', { defaultValue: 'This quote was rejected on {{date}}.', date }))
            : (accepted
                ? t('quotes.publicDecision.accepted.body', { defaultValue: 'Thank you. Your acceptance has been recorded and we have been notified.' })
                : t('quotes.publicDecision.rejected.body', { defaultValue: 'Your response has been recorded and we have been notified.' }))}
        </AlertDescription>
      </Alert>
    );
  }

  if (!canDecide) return null;

  const toggle = (id: string, on: boolean) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (on) next.add(id); else next.delete(id);
      return next;
    });

  return (
    <div className="space-y-4 rounded-lg border border-border p-4" id="quote-link-decision-panel">
      {optionalItems.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{t('quotes.publicDecision.optionalItems', { defaultValue: 'Optional items' })}</h3>
          <p className="text-xs text-muted-foreground">
            {t('quotes.publicDecision.optionalHint', { defaultValue: 'Choose the optional items you want. Your choices are sent when you accept.' })}
          </p>
          {optionalItems.map((item) => (
            <div key={item.quote_item_id} className="flex items-center justify-between gap-3">
              <Switch
                id={`quote-link-optional-${item.quote_item_id}`}
                label={item.description}
                checked={selected.has(item.quote_item_id)}
                onCheckedChange={(checked: boolean) => toggle(item.quote_item_id, checked)}
                disabled={submitting}
              />
              <span className="text-sm">{money(item.total_price ?? 0, currencyCode)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1 text-sm" aria-live="polite">
        <div className="flex justify-between"><span>{t('quotes.publicDecision.subtotal', { defaultValue: 'Subtotal' })}</span><span>{money(shown.subtotal, currencyCode)}</span></div>
        <div className="flex justify-between"><span>{t('quotes.publicDecision.tax', { defaultValue: 'Tax' })}</span><span>{money(shown.tax, currencyCode)}</span></div>
        <div className="flex justify-between font-semibold"><span>{t('quotes.publicDecision.total', { defaultValue: 'Total' })}</span><span>{money(shown.total, currencyCode)}</span></div>
      </div>

      <div className="space-y-3">
        <Input
          id="quote-link-signer-name"
          label={t('quotes.publicDecision.fullName', { defaultValue: 'Full name' })}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
          required
          disabled={submitting}
        />
        <Input
          id="quote-link-signer-title"
          label={t('quotes.publicDecision.titleOptional', { defaultValue: 'Title (optional)' })}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          disabled={submitting}
        />
        <Checkbox
          id="quote-link-agree"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          disabled={submitting}
          label={agreement.text}
        />
        <p className="text-xs text-muted-foreground">
          {t('quotes.publicDecision.agreementVersion', { defaultValue: 'Agreement version {{version}}', version: agreement.version })}
        </p>
      </div>

      {error && (
        <Alert id="quote-link-error" variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button id="quote-link-reject-open" variant="outline" onClick={() => { setError(null); setRejectOpen(true); }} disabled={submitting}>
          {t('quotes.publicDecision.reject', { defaultValue: 'Reject quote' })}
        </Button>
        <Button
          id="quote-link-accept"
          onClick={() => void submit('accept')}
          disabled={submitting || !name.trim() || !agreed}
        >
          {submitting
            ? t('quotes.publicDecision.submitting', { defaultValue: 'Submitting...' })
            : t('quotes.publicDecision.accept', { defaultValue: 'Accept quote' })}
        </Button>
      </div>

      <Dialog
        id="quote-link-reject-dialog"
        isOpen={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title={t('quotes.publicDecision.rejectTitle', { defaultValue: 'Reject quote' })}
        footer={
          <div className="flex justify-end space-x-2">
            <Button id="quote-link-reject-cancel" variant="outline" onClick={() => setRejectOpen(false)} disabled={submitting}>
              {t('quotes.publicDecision.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button id="quote-link-reject-submit" onClick={() => void submit('reject')} disabled={submitting || !comment.trim()}>
              {submitting
                ? t('quotes.publicDecision.submitting', { defaultValue: 'Submitting...' })
                : t('quotes.publicDecision.rejectConfirm', { defaultValue: 'Reject' })}
            </Button>
          </div>
        }
      >
        <DialogContent>
          <DialogDescription>
            {t('quotes.publicDecision.rejectHint', { defaultValue: 'Tell us what needs to change. We may revise and resend the quote.' })}
          </DialogDescription>
          <TextArea
            id="quote-link-reject-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={4000}
            disabled={submitting}
            className="min-h-24"
          />
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default QuoteLinkDecisionPanel;
