'use client';

import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

import { Input } from './Input';
import { parseEmailRecipients, EMAIL_RECIPIENT_PATTERN } from '../lib/emailRecipients';
import { useTranslation } from '../lib/i18n/client';

export interface EmailRecipientChip {
  email: string;
  name?: string;
  contact_id?: string;
  user_id?: string;
}

export interface EmailRecipientSuggestion extends EmailRecipientChip {
  /** Shown under the name so an agent can tell two Janes apart. */
  secondaryLabel?: string;
}

export interface EmailRecipientsInputProps {
  id: string;
  label?: string;
  value: EmailRecipientChip[];
  onChange: (value: EmailRecipientChip[]) => void;
  /** Free-text entries that failed validation; they block Send upstream. */
  invalidEntries?: string[];
  onInvalidEntriesChange?: (entries: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Ticket-client contacts first, then internal users. */
  searchSuggestions?: (query: string) => Promise<EmailRecipientSuggestion[]>;
}

const SUGGESTION_DEBOUNCE_MS = 200;

/**
 * A chip input for one-off email recipients: type or paste addresses (comma,
 * semicolon or newline separated), pick from async suggestions, remove with the
 * chip's x or Backspace on an empty input. Invalid entries stay visible as
 * error chips so the caller can block sending.
 */
export function EmailRecipientsInput({
  id,
  label,
  value,
  onChange,
  invalidEntries = [],
  onInvalidEntriesChange,
  placeholder,
  disabled,
  searchSuggestions,
}: EmailRecipientsInputProps): React.ReactElement {
  const { t } = useTranslation('common');
  const [draft, setDraft] = useState('');
  const [suggestions, setSuggestions] = useState<EmailRecipientSuggestion[]>([]);
  const latestQuery = useRef('');

  const setInvalid = (entries: string[]) => onInvalidEntriesChange?.(entries);

  const addRecipients = (incoming: EmailRecipientChip[]) => {
    if (incoming.length === 0) return;
    const existing = new Set(value.map((entry) => entry.email.toLowerCase()));
    const added = incoming.filter((entry) => {
      const key = entry.email.toLowerCase();
      if (existing.has(key)) return false;
      existing.add(key);
      return true;
    });
    if (added.length > 0) {
      onChange([...value, ...added]);
    }
  };

  const commitDraft = () => {
    const text = draft.trim();
    if (!text) {
      setInvalid([]);
      return;
    }
    const parsed = parseEmailRecipients(text);
    addRecipients(parsed.recipients);
    setInvalid(parsed.invalid);
    setDraft(parsed.invalid.join(', '));
    setSuggestions([]);
  };

  useEffect(() => {
    if (!searchSuggestions) return;
    const query = draft.trim();
    latestQuery.current = query;
    if (query.length < 2 || EMAIL_RECIPIENT_PATTERN.test(query)) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const results = await searchSuggestions(query);
        if (latestQuery.current !== query) return;
        const chosen = new Set(value.map((entry) => entry.email.toLowerCase()));
        setSuggestions(results.filter((result) => !chosen.has(result.email.toLowerCase())).slice(0, 8));
      } catch {
        setSuggestions([]);
      }
    }, SUGGESTION_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `value` is read inside the timer only to filter already-chosen chips.
  }, [draft, searchSuggestions, value]);

  return (
    <div className="space-y-1" id={id}>
      {label && (
        <span className="text-xs font-medium uppercase tracking-wide text-[rgb(var(--color-text-500))]">
          {label}
        </span>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((recipient) => (
          <span
            key={recipient.email}
            id={`${id}-chip-${recipient.email}`}
            className="inline-flex items-center gap-1 rounded-full border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] px-2 py-0.5 text-xs text-[rgb(var(--color-text-700))]"
            title={recipient.email}
          >
            {recipient.name ? `${recipient.name} <${recipient.email}>` : recipient.email}
            <button
              id={`${id}-remove-${recipient.email}`}
              type="button"
              className="text-[rgb(var(--color-text-500))] hover:text-[rgb(var(--color-text-900))] disabled:opacity-50"
              onClick={() => onChange(value.filter((entry) => entry.email !== recipient.email))}
              disabled={disabled}
              aria-label={t('emailRecipients.remove', { defaultValue: 'Remove {{email}}', email: recipient.email })}
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </span>
        ))}
        {invalidEntries.map((entry) => (
          <span
            key={`invalid-${entry}`}
            id={`${id}-invalid-chip-${entry}`}
            role="alert"
            className="inline-flex items-center gap-1 rounded-full border border-destructive bg-destructive/10 px-2 py-0.5 text-xs text-destructive"
          >
            {entry}
          </span>
        ))}
      </div>
      <Input
        id={`${id}-input`}
        value={draft}
        placeholder={placeholder ?? t('emailRecipients.placeholder', {
          defaultValue: 'Type an address and press Enter',
        })}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onPaste={(event) => {
          const text = event.clipboardData.getData('text');
          if (!/[,;\n]/.test(text)) return;
          event.preventDefault();
          const parsed = parseEmailRecipients(text);
          addRecipients(parsed.recipients);
          setInvalid(parsed.invalid);
          setDraft(parsed.invalid.join(', '));
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',' || event.key === ';') {
            event.preventDefault();
            commitDraft();
            return;
          }
          if (event.key === 'Backspace' && draft === '' && value.length > 0) {
            event.preventDefault();
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={commitDraft}
      />
      {suggestions.length > 0 && (
        <ul
          id={`${id}-suggestions`}
          className="max-h-48 overflow-auto rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-bg-50))] text-sm"
        >
          {suggestions.map((suggestion) => (
            <li key={`${suggestion.email}-${suggestion.contact_id ?? suggestion.user_id ?? ''}`}>
              <button
                id={`${id}-suggestion-${suggestion.email}`}
                type="button"
                className="flex w-full flex-col items-start px-2 py-1 text-left hover:bg-[rgb(var(--color-border-50))]"
                onClick={() => {
                  addRecipients([{
                    email: suggestion.email,
                    ...(suggestion.name ? { name: suggestion.name } : {}),
                    ...(suggestion.contact_id ? { contact_id: suggestion.contact_id } : {}),
                    ...(suggestion.user_id ? { user_id: suggestion.user_id } : {}),
                  }]);
                  setDraft('');
                  setInvalid([]);
                  setSuggestions([]);
                }}
              >
                <span>{suggestion.name ? `${suggestion.name} <${suggestion.email}>` : suggestion.email}</span>
                {suggestion.secondaryLabel && (
                  <span className="text-xs text-[rgb(var(--color-text-500))]">{suggestion.secondaryLabel}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default EmailRecipientsInput;
