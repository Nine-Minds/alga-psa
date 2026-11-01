'use client';

/**
 * Accept / reject panel for the public (email-link) quote page - alga-2026-0002820 (4/6).
 *
 * Mounted by PublicQuoteReview as the footer of the shared QuoteDocumentView. Typed
 * name + agreement checkbox is the signature (no drawn pad). Optional-item toggles
 * and the live preview belong to the document view (the caller owns the selection,
 * exactly as in the client portal); this panel commits that selection on Accept.
 * The server re-validates everything - nothing rendered here is trusted.
 */
import React, { useCallback, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Dialog, DialogContent, DialogDescription } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';

export interface QuoteLinkAgreement {
  version: string;
  text: string;
  hash: string;
}

export interface QuoteLinkDecisionPanelProps {
  /** The raw access token from the URL; only used to address the decision route. */
  token: string;
  /** Current agreement wording from the server (getCurrentQuoteAgreement). */
  agreement: QuoteLinkAgreement;
  /** Fingerprint of the quote content rendered on the page; the server compares it on submit. */
  quoteFingerprint: string;
  /** Optional items the recipient currently has switched on; committed by Accept. */
  selectedOptionalIds: ReadonlyArray<string>;
  /** Optional signer prefill, e.g. the recipient's name. */
  defaultSignerName?: string;
  /** Lets the owner of the document view lock its toggles while a request is in flight. */
  onSubmittingChange?: (submitting: boolean) => void;
  /**
   * Called once a result replaces the form (decided, already decided, changed, invalid).
   * `decision` is the outcome the SERVER confirmed ('decided' / 'already_decided'); it is null
   * for changed / invalid, so the owner never shows a state the server did not confirm.
   */
  onSettled?: (decision: 'accepted' | 'rejected' | null) => void;
}

type PanelState =
  | { kind: 'form' }
  | { kind: 'decided'; decision: 'accepted' | 'rejected'; decidedAt?: string; already: boolean }
  | { kind: 'changed' }
  | { kind: 'invalid' };

const QuoteLinkDecisionPanel: React.FC<QuoteLinkDecisionPanelProps> = ({
  token, agreement, quoteFingerprint, selectedOptionalIds, defaultSignerName, onSubmittingChange, onSettled,
}) => {
  const { t } = useTranslation('features/billing');
  const { formatDate } = useFormatters();

  const [state, setState] = useState<PanelState>({ kind: 'form' });
  const [name, setName] = useState(defaultSignerName ?? '');
  const [title, setTitle] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [comment, setComment] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Synchronous guard: state updates are async, a fast double click could otherwise send twice.
  const inFlight = React.useRef(false);

  const submit = useCallback(async (action: 'accept' | 'reject') => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    onSubmittingChange?.(true);
    setError(null);
    try {
      const response = await fetch(`/api/quote/${encodeURIComponent(token)}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          signerName: name,
          signerTitle: title,
          agreed,
          agreementVersion: agreement.version,
          agreementTextHash: agreement.hash,
          quoteFingerprint,
          selectedOptionalQuoteItemIds: action === 'accept' ? [...selectedOptionalIds] : [],
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
      inFlight.current = false;
      setSubmitting(false);
      onSubmittingChange?.(false);
      setRejectOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, name, title, agreed, agreement, quoteFingerprint, selectedOptionalIds, comment, t, onSubmittingChange]);

  // A settled result replaces the form; tell the owner so it can lock the optional-item toggles.
  const settled = state.kind !== 'form';
  const confirmedDecision = state.kind === 'decided' ? state.decision : null;
  React.useEffect(() => { if (settled) onSettled?.(confirmedDecision); }, [settled, confirmedDecision, onSettled]);

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
    // Same generic copy as the server-rendered not-valid page: no reason is ever given.
    return (
      <Alert id="quote-link-invalid" variant="destructive">
        <AlertTitle>{t('quotes.public.outcome.unavailable.title', { defaultValue: "This link isn't available" })}</AlertTitle>
        <AlertDescription>
          {t('quotes.public.outcome.unavailable.body', { defaultValue: 'The link may be mistyped or may no longer be active.' })}
          {' '}
          {t('quotes.public.outcome.help', { defaultValue: 'Need help? Reply to the email you received this link in.' })}
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

  return (
    <div className="space-y-4 rounded-lg border border-border p-4" id="quote-link-decision-panel">
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
