'use client';

import React, { useState } from 'react';
import { X } from 'lucide-react';

import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { InputMapping, MappingValue } from '@alga-psa/workflows/runtime';

import { WorkflowActionInputFixedMultiPicker } from './WorkflowActionInputFixedPicker';

// Recipient pickers here have no dependencies; a shared constant keeps their props stable.
const NO_DEPENDENCY_MAPPING: InputMapping = {};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isDynamicValue = (value: unknown): boolean =>
  isPlainObject(value) && ('$expr' in value || '$secret' in value);

/** Reads a list of fixed strings; null when the list (or an item) is computed. */
const readStringList = (value: unknown): string[] | null => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return null;
    if (item.trim()) items.push(item);
  }
  return items;
};

// ---------------------------------------------------------------------------
// Send In-App Notification: recipients { user_ids, role_ids, role_names }
// ---------------------------------------------------------------------------

export type NotificationRecipientsLiteral = {
  userIds: string[];
  roleIds: string[];
  roleNames: string[];
};

/**
 * Reads fixed notification recipients. Returns null when any part is computed (a reference or an
 * expression), which only the field-by-field editor can show.
 */
export const readNotificationRecipientsLiteral = (
  value: MappingValue | undefined | null
): NotificationRecipientsLiteral | null => {
  if (value === undefined || value === null) return { userIds: [], roleIds: [], roleNames: [] };
  if (!isPlainObject(value) || isDynamicValue(value)) return null;
  const record = value as Record<string, unknown>;
  const userIds = readStringList(record.user_ids);
  const roleIds = readStringList(record.role_ids);
  const roleNames = readStringList(record.role_names);
  if (!userIds || !roleIds || !roleNames) return null;
  return { userIds, roleIds, roleNames };
};

/** The action input shape; empty lists are left out so the saved value stays minimal. */
export const writeNotificationRecipientsLiteral = (recipients: NotificationRecipientsLiteral): MappingValue => {
  const result: Record<string, string[]> = {};
  if (recipients.userIds.length) result.user_ids = recipients.userIds;
  if (recipients.roleIds.length) result.role_ids = recipients.roleIds;
  if (recipients.roleNames.length) result.role_names = recipients.roleNames;
  return result;
};

/** Splits typed role names on commas or semicolons. */
export const parseRoleNames = (text: string): string[] =>
  Array.from(new Set(text.split(/[,;]/).map((name) => name.trim()).filter(Boolean)));

/**
 * One-level "users / roles" editor. `purpose` selects the copy: 'notify' for Send In-App
 * Notification's recipients, 'email' for the users and roles Send Email addresses.
 */
export const WorkflowUserRecipientsEditor: React.FC<{
  idPrefix: string;
  value: NotificationRecipientsLiteral;
  onChange: (value: MappingValue) => void;
  disabled?: boolean;
  purpose: 'notify' | 'email';
}> = ({ idPrefix, value, onChange, disabled, purpose }) => {
  const { t } = useTranslation('msp/workflows');
  const copyKey = purpose === 'email' ? 'emailUserRecipientsEditor' : 'notificationRecipientsEditor';
  const usersLabel = purpose === 'email' ? 'Email users' : 'Notify users';
  const rolesLabel = purpose === 'email' ? 'Email everyone with these roles' : 'Notify everyone with these roles';
  const emptyHint =
    purpose === 'email' ? 'Choose users or roles, or pick a ticket below.' : 'Choose at least one user or role to notify.';
  const [roleNamesText, setRoleNamesText] = useState(() => value.roleNames.join(', '));
  const update = (next: NotificationRecipientsLiteral) => onChange(writeNotificationRecipientsLiteral(next));

  return (
    <div className="space-y-3" id={`${idPrefix}-${purpose === 'email' ? 'email-user-recipients' : 'notification-recipients'}`}>
      <WorkflowActionInputFixedMultiPicker
        idPrefix={`${idPrefix}-users`}
        field={{
          name: t(`${copyKey}.users`, { defaultValue: usersLabel }),
          editor: {
            kind: 'picker',
            picker: { resource: 'user' },
            fixedValueHint: t(`${copyKey}.usersHint`, { defaultValue: 'Search users' }),
          },
        }}
        values={value.userIds}
        onChange={(userIds) => update({ ...value, userIds })}
        rootInputMapping={NO_DEPENDENCY_MAPPING}
        disabled={disabled}
      />
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-roles-literal-picker`}>{t(`${copyKey}.roles`, { defaultValue: rolesLabel })}</Label>
        <WorkflowActionInputFixedMultiPicker
          idPrefix={`${idPrefix}-roles`}
          field={{
            name: t(`${copyKey}.roles`, { defaultValue: rolesLabel }),
            editor: {
              kind: 'picker',
              picker: { resource: 'role' },
              fixedValueHint: t(`${copyKey}.rolesHint`, { defaultValue: 'Add a role' }),
            },
          }}
          values={value.roleIds}
          onChange={(roleIds) => update({ ...value, roleIds })}
          rootInputMapping={NO_DEPENDENCY_MAPPING}
          disabled={disabled}
        />
      </div>
      <Input
        id={`${idPrefix}-role-names`}
        label={t(`${copyKey}.roleNames`, { defaultValue: 'Role names (optional)' })}
        value={roleNamesText}
        placeholder={t(`${copyKey}.roleNamesPlaceholder`, {
          defaultValue: 'e.g. Technician, Dispatcher (matched by name when the workflow runs)',
        })}
        onChange={(event) => {
          setRoleNamesText(event.target.value);
          update({ ...value, roleNames: parseRoleNames(event.target.value) });
        }}
        disabled={disabled}
      />
      {value.userIds.length + value.roleIds.length + value.roleNames.length === 0 && (
        <p className="text-[11px] text-[rgb(var(--color-text-500))]">
          {t(`${copyKey}.empty`, { defaultValue: emptyHint })}
        </p>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Send Email: to / cc / bcc lists of { email, name? }
// ---------------------------------------------------------------------------

export type EmailRecipient = { email: string; name?: string };

const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** Reads a fixed list of email recipients; null when the list or an entry is computed. */
export const readEmailRecipientsLiteral = (value: MappingValue | undefined | null): EmailRecipient[] | null => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const recipients: EmailRecipient[] = [];
  for (const item of value) {
    if (!isPlainObject(item) || isDynamicValue(item)) return null;
    const { email, name } = item as Record<string, unknown>;
    if (typeof email !== 'string') return null;
    if (name !== undefined && name !== null && typeof name !== 'string') return null;
    if (email.trim()) recipients.push(typeof name === 'string' && name ? { email, name } : { email });
  }
  return recipients;
};

export const writeEmailRecipientsLiteral = (recipients: EmailRecipient[]): MappingValue =>
  recipients.map((recipient) => (recipient.name ? { email: recipient.email, name: recipient.name } : { email: recipient.email }));

/**
 * Parses typed or pasted addresses: comma, semicolon or newline separated, each either
 * `ada@example.com` or `Ada Lovelace <ada@example.com>`. Returns valid recipients and the entries
 * that aren't addresses.
 */
export const parseEmailRecipients = (text: string): { recipients: EmailRecipient[]; invalid: string[] } => {
  const recipients: EmailRecipient[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[,;\n]/)) {
    const entry = raw.trim();
    if (!entry) continue;
    const named = /^(.*?)\s*<([^>]+)>$/.exec(entry);
    const email = (named ? named[2] : entry).trim();
    const name = named ? named[1].trim().replace(/^"|"$/g, '') : '';
    if (EMAIL_PATTERN.test(email)) {
      recipients.push(name ? { email, name } : { email });
    } else {
      invalid.push(entry);
    }
  }
  return { recipients, invalid };
};

/** A list of email recipients: type or paste addresses, remove them from the chips. */
export const WorkflowEmailRecipientsEditor: React.FC<{
  idPrefix: string;
  value: EmailRecipient[];
  onChange: (value: MappingValue) => void;
  disabled?: boolean;
}> = ({ idPrefix, value, onChange, disabled }) => {
  const { t } = useTranslation('msp/workflows');
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState<string[]>([]);

  const commitDraft = () => {
    if (!draft.trim()) return;
    const parsed = parseEmailRecipients(draft);
    const existing = new Set(value.map((recipient) => recipient.email.toLowerCase()));
    const added = parsed.recipients.filter((recipient) => !existing.has(recipient.email.toLowerCase()));
    if (added.length) onChange(writeEmailRecipientsLiteral([...value, ...added]));
    setInvalid(parsed.invalid);
    setDraft(parsed.invalid.join(', '));
  };

  return (
    <div className="space-y-2" id={`${idPrefix}-email-recipients`}>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((recipient) => (
            <span
              key={recipient.email}
              className="inline-flex items-center gap-1 rounded-full border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] px-2 py-0.5 text-xs text-[rgb(var(--color-text-700))]"
              title={recipient.email}
            >
              {recipient.name ? `${recipient.name} <${recipient.email}>` : recipient.email}
              <button
                id={`${idPrefix}-email-remove-${recipient.email}`}
                type="button"
                className="text-[rgb(var(--color-text-500))] hover:text-[rgb(var(--color-text-900))] disabled:opacity-50"
                onClick={() => onChange(writeEmailRecipientsLiteral(value.filter((item) => item.email !== recipient.email)))}
                disabled={disabled}
                aria-label={t('emailRecipientsEditor.remove', { defaultValue: 'Remove {{email}}', email: recipient.email })}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Input
        id={`${idPrefix}-email-input`}
        value={draft}
        placeholder={t('emailRecipientsEditor.placeholder', {
          defaultValue: 'Type an address and press Enter, e.g. Ada Lovelace <ada@example.com>',
        })}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',' || event.key === ';') {
            event.preventDefault();
            commitDraft();
          }
        }}
        onBlur={commitDraft}
        disabled={disabled}
      />
      {invalid.length > 0 && (
        <p className="text-[11px] text-destructive" role="alert">
          {t('emailRecipientsEditor.invalid', {
            defaultValue: 'Not an email address: {{entries}}',
            entries: invalid.join(', '),
          })}
        </p>
      )}
    </div>
  );
};
