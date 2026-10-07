'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Mail } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import {
  EmailRecipientsInput,
  type EmailRecipientChip,
  type EmailRecipientSuggestion,
} from '@alga-psa/ui/components/EmailRecipientsInput';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { MAX_COMMENT_EMAIL_RECIPIENTS } from '@shared/lib/tickets/commentEmailRecipientsCore';
import { getContactsByClient } from '../../actions/clientLookupActions';
import { getAllUsers } from '@alga-psa/user-composition/actions/userQueryActions';

export const COMMENT_EMAIL_RECIPIENTS_TOGGLE_ID = 'ticket-comment-cc-bcc-toggle';
export const COMMENT_EMAIL_RECIPIENTS_CC_ID = 'ticket-comment-cc-input';
export const COMMENT_EMAIL_RECIPIENTS_BCC_ID = 'ticket-comment-bcc-input';

export interface CommentEmailRecipientsDraft {
  cc: EmailRecipientChip[];
  bcc: EmailRecipientChip[];
  invalidCc: string[];
  invalidBcc: string[];
}

export const emptyCommentEmailRecipientsDraft = (): CommentEmailRecipientsDraft => ({
  cc: [],
  bcc: [],
  invalidCc: [],
  invalidBcc: [],
});

export const commentEmailRecipientsDraftCount = (draft: CommentEmailRecipientsDraft): number =>
  draft.cc.length + draft.bcc.length;

/** True once the draft carries more recipients than the server will accept. */
export const commentEmailRecipientsDraftOverLimit = (draft: CommentEmailRecipientsDraft): boolean =>
  commentEmailRecipientsDraftCount(draft) > MAX_COMMENT_EMAIL_RECIPIENTS;

/**
 * True while an entered address is not a valid email, or the list is over the
 * ceiling the server enforces: either way Send stays disabled with an inline
 * message rather than failing in the action.
 */
export const commentEmailRecipientsDraftHasErrors = (draft: CommentEmailRecipientsDraft): boolean =>
  draft.invalidCc.length > 0 ||
  draft.invalidBcc.length > 0 ||
  commentEmailRecipientsDraftOverLimit(draft);

/** What the composers hand to the server actions. */
export type CommentEmailRecipientsPayload = { cc?: string[]; bcc?: string[] };

/** The payload shape the server actions take. Empty lists become undefined. */
export const commentEmailRecipientsPayload = (
  draft: CommentEmailRecipientsDraft
): CommentEmailRecipientsPayload | undefined => {
  const cc = draft.cc.map((entry) => entry.email);
  const bcc = draft.bcc.map((entry) => entry.email);
  if (cc.length === 0 && bcc.length === 0) {
    return undefined;
  }
  return {
    ...(cc.length > 0 ? { cc } : {}),
    ...(bcc.length > 0 ? { bcc } : {}),
  };
};

/**
 * Builds the suggestion searcher for a ticket: the ticket client's contacts
 * first, then internal users. Both lists are fetched once and filtered locally
 * so typing doesn't hit the server on every keystroke.
 */
export function useCommentEmailRecipientSuggestions(clientId?: string | null) {
  const contactsRef = useRef<EmailRecipientSuggestion[] | null>(null);
  const usersRef = useRef<EmailRecipientSuggestion[] | null>(null);

  return useCallback(async (query: string): Promise<EmailRecipientSuggestion[]> => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];

    if (contactsRef.current === null) {
      contactsRef.current = [];
      if (clientId) {
        try {
          const contacts = await getContactsByClient(clientId, 'active');
          contactsRef.current = (contacts ?? [])
            .filter((contact) => Boolean(contact.email))
            .map((contact) => ({
              email: contact.email as string,
              name: contact.full_name ?? undefined,
              contact_id: contact.contact_name_id,
            }));
        } catch {
          contactsRef.current = [];
        }
      }
    }

    if (usersRef.current === null) {
      usersRef.current = [];
      try {
        const users = await getAllUsers(false, 'internal');
        usersRef.current = (users ?? [])
          .filter((user) => Boolean(user.email))
          .map((user) => ({
            email: user.email as string,
            name: `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || undefined,
            user_id: user.user_id,
          }));
      } catch {
        usersRef.current = [];
      }
    }

    const matches = (entry: EmailRecipientSuggestion) =>
      entry.email.toLowerCase().includes(needle) ||
      (entry.name ?? '').toLowerCase().includes(needle);

    // Client contacts rank ahead of internal users.
    return [...contactsRef.current.filter(matches), ...usersRef.current.filter(matches)];
  }, [clientId]);
}

export interface CommentEmailRecipientsControlProps {
  idPrefix: string;
  value: CommentEmailRecipientsDraft;
  /**
   * A React setState: the chip input commits recipients and invalid entries in
   * two calls, so updates must apply to the latest draft, not a stale closure.
   */
  onChange: React.Dispatch<React.SetStateAction<CommentEmailRecipientsDraft>>;
  /** Internal notes never email anyone outside the MSP. */
  isInternal?: boolean;
  disabled?: boolean;
  searchSuggestions?: (query: string) => Promise<EmailRecipientSuggestion[]>;
  /** Rendered in the editor footer; the rows go above the editor body. */
  variant: 'toggle' | 'rows';
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}

/**
 * The one implementation of the per-comment Cc/Bcc control, shared by the
 * classic composer, the bento composer and both reply composers. `variant`
 * picks which half renders: the footer toggle or the Cc/Bcc rows.
 *
 * While Internal is on, both halves are hidden and the entered values are
 * preserved, so turning Internal off restores them. They are never sent with
 * an internal note.
 */
export function CommentEmailRecipientsControl({
  idPrefix,
  value,
  onChange,
  isInternal = false,
  disabled = false,
  searchSuggestions,
  variant,
  expanded,
  onExpandedChange,
}: CommentEmailRecipientsControlProps): React.ReactElement | null {
  const { t } = useTranslation('features/tickets');
  const count = commentEmailRecipientsDraftCount(value);

  if (isInternal) {
    // Keep the entered values; just say they won't be sent.
    if (variant === 'rows' && count > 0) {
      return (
        <p
          id={`${idPrefix}-internal-note`}
          className="mb-2 text-xs text-[rgb(var(--color-text-500))]"
        >
          {t(
            'conversation.ccBccNotSentOnInternal',
            'Cc and Bcc are not sent with an internal note. Turn Internal off to use them.'
          )}
        </p>
      );
    }
    return null;
  }

  if (variant === 'toggle') {
    return (
      <Button
        id={`${idPrefix}-${COMMENT_EMAIL_RECIPIENTS_TOGGLE_ID}`}
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => onExpandedChange(!expanded)}
      >
        <Mail className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
        {t('conversation.ccBcc', 'Cc/Bcc')}
        {!expanded && count > 0 && (
          <span
            id={`${idPrefix}-${COMMENT_EMAIL_RECIPIENTS_TOGGLE_ID}-count`}
            className="ml-1 rounded-full bg-[rgb(var(--color-border-100))] px-1.5 text-xs text-[rgb(var(--color-text-700))]"
          >
            {count}
          </span>
        )}
      </Button>
    );
  }

  if (!expanded) {
    return null;
  }

  return (
    <div id={`${idPrefix}-email-recipients`} className="mb-2 space-y-2">
      <EmailRecipientsInput
        id={`${idPrefix}-${COMMENT_EMAIL_RECIPIENTS_CC_ID}`}
        label={t('conversation.cc', 'Cc')}
        value={value.cc}
        onChange={(cc) => onChange((prev) => ({ ...prev, cc }))}
        invalidEntries={value.invalidCc}
        onInvalidEntriesChange={(invalidCc) => onChange((prev) => ({ ...prev, invalidCc }))}
        disabled={disabled}
        searchSuggestions={searchSuggestions}
      />
      <EmailRecipientsInput
        id={`${idPrefix}-${COMMENT_EMAIL_RECIPIENTS_BCC_ID}`}
        label={t('conversation.bcc', 'Bcc')}
        value={value.bcc}
        onChange={(bcc) => onChange((prev) => ({ ...prev, bcc }))}
        invalidEntries={value.invalidBcc}
        onInvalidEntriesChange={(invalidBcc) => onChange((prev) => ({ ...prev, invalidBcc }))}
        disabled={disabled}
        searchSuggestions={searchSuggestions}
      />
      {(value.invalidCc.length > 0 || value.invalidBcc.length > 0) && (
        <p role="alert" className="text-xs text-destructive">
          {t('conversation.ccBccInvalid', 'Fix the highlighted addresses before sending.')}
        </p>
      )}
      {commentEmailRecipientsDraftOverLimit(value) && (
        <p id={`${idPrefix}-email-recipients-limit`} role="alert" className="text-xs text-destructive">
          {t('conversation.ccBccTooMany', {
            defaultValue: 'At most {{max}} Cc and Bcc recipients can be copied on one comment.',
            max: MAX_COMMENT_EMAIL_RECIPIENTS,
          })}
        </p>
      )}
    </div>
  );
}

/** Convenience hook: draft state plus the expanded flag and a reset. */
export function useCommentEmailRecipientsDraft() {
  const [draft, setDraft] = useState<CommentEmailRecipientsDraft>(emptyCommentEmailRecipientsDraft);
  const [expanded, setExpanded] = useState(false);
  const reset = useCallback(() => {
    setDraft(emptyCommentEmailRecipientsDraft());
    setExpanded(false);
  }, []);
  const payload = useMemo(() => commentEmailRecipientsPayload(draft), [draft]);
  const hasErrors = commentEmailRecipientsDraftHasErrors(draft);
  return { draft, setDraft, expanded, setExpanded, reset, payload, hasErrors };
}

export default CommentEmailRecipientsControl;
