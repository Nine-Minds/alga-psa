// Create-ticket extras: linked assets, watchers and free-form custom fields.
//
// Deliberately NOT a 'use server' module: the validator below is the one definition used by both the
// create form (inline errors) and `addTicket` (authoritative rejection), so it must be importable from
// client code. Ticket custom fields have no board/category definitions; they are free-form
// `attributes.custom_fields`, so "required" reduces to structural rules: non-blank unique names, bounded
// value length and a bounded field count.

import { z } from 'zod';

export const TICKET_CUSTOM_FIELD_LIMITS = {
  /** Same cap the ticket template schema applies to `custom_fields`. */
  maxFields: 100,
  maxNameLength: 100,
  maxValueLength: 2000,
} as const;

export const TICKET_CREATE_LIMITS = {
  maxAssets: 50,
  maxWatchers: 50,
} as const;

export type TicketCustomFieldIssueCode =
  | 'name_blank'
  | 'name_reserved'
  | 'name_too_long'
  | 'name_duplicate'
  | 'value_too_long'
  | 'too_many_fields';

export interface TicketCustomFieldIssue {
  code: TicketCustomFieldIssueCode;
  /** Index of the offending entry (absent for `too_many_fields`). */
  index?: number;
  /** The trimmed field name, when there is one. */
  name?: string;
}

export interface TicketCustomFieldEntry {
  name: string;
  value: unknown;
}

const RESERVED_NAMES = new Set(['__proto__']);

function valueLength(value: unknown): number {
  if (typeof value === 'string') return value.length;
  if (value === null || value === undefined) return 0;
  try {
    return JSON.stringify(value).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * The shared validator. Names are compared trimmed and case-insensitively. Returns every issue found
 * (empty array = valid) so the form can mark each row.
 */
export function validateTicketCustomFieldEntries(
  entries: ReadonlyArray<TicketCustomFieldEntry>
): TicketCustomFieldIssue[] {
  const issues: TicketCustomFieldIssue[] = [];
  if (entries.length > TICKET_CUSTOM_FIELD_LIMITS.maxFields) {
    issues.push({ code: 'too_many_fields' });
  }

  const seen = new Map<string, number>();
  entries.forEach((entry, index) => {
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!name) {
      issues.push({ code: 'name_blank', index });
    } else {
      if (RESERVED_NAMES.has(name.toLowerCase())) {
        issues.push({ code: 'name_reserved', index, name });
      }
      if (name.length > TICKET_CUSTOM_FIELD_LIMITS.maxNameLength) {
        issues.push({ code: 'name_too_long', index, name });
      }
      const key = name.toLowerCase();
      if (seen.has(key)) {
        issues.push({ code: 'name_duplicate', index, name });
      } else {
        seen.set(key, index);
      }
    }
    if (valueLength(entry.value) > TICKET_CUSTOM_FIELD_LIMITS.maxValueLength) {
      issues.push({ code: 'value_too_long', index, name: name || undefined });
    }
  });
  return issues;
}

export function ticketCustomFieldRecordToEntries(
  fields: Record<string, unknown>
): TicketCustomFieldEntry[] {
  return Object.entries(fields).map(([name, value]) => ({ name, value }));
}

export function validateTicketCustomFields(fields: Record<string, unknown>): TicketCustomFieldIssue[] {
  return validateTicketCustomFieldEntries(ticketCustomFieldRecordToEntries(fields));
}

/** Trim names. Call only after validation (duplicates would otherwise collapse silently). */
export function normalizeTicketCustomFields(fields: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(fields)) {
    normalized[name.trim()] = value;
  }
  return normalized;
}

/** English text for server errors / logs; the form maps `code` to i18n keys instead. */
export function describeTicketCustomFieldIssue(issue: TicketCustomFieldIssue): string {
  const label = issue.name ? `"${issue.name}"` : issue.index !== undefined ? `#${issue.index + 1}` : '';
  switch (issue.code) {
    case 'name_blank':
      return `custom field ${label} has a blank name`;
    case 'name_reserved':
      return `custom field ${label} uses a reserved name`;
    case 'name_too_long':
      return `custom field ${label} name is longer than ${TICKET_CUSTOM_FIELD_LIMITS.maxNameLength} characters`;
    case 'name_duplicate':
      return `custom field ${label} is listed more than once (names are case-insensitive)`;
    case 'value_too_long':
      return `custom field ${label} value is longer than ${TICKET_CUSTOM_FIELD_LIMITS.maxValueLength} characters`;
    case 'too_many_fields':
      return `at most ${TICKET_CUSTOM_FIELD_LIMITS.maxFields} custom fields are allowed`;
  }
}

const uuid = z.string().uuid();

/**
 * The optional create-payload additions. All three are optional so existing `addTicket` callers
 * (which send none of them) behave exactly as before.
 */
export const ticketCreateExtrasSchema = z
  .object({
    asset_ids: z.array(uuid).max(TICKET_CREATE_LIMITS.maxAssets).optional(),
    watcher_ids: z.array(uuid).max(TICKET_CREATE_LIMITS.maxWatchers).optional(),
    custom_fields: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export interface TicketCreateExtras {
  /** Deduplicated. Empty when none were supplied. */
  assetIds: string[];
  /** Deduplicated user ids. Empty when none were supplied. */
  watcherIds: string[];
  /** Present (possibly empty) only when the caller sent `custom_fields`; it then replaces template/duplicate values. */
  customFields?: Record<string, unknown>;
}

interface FormDataLike {
  get(name: string): unknown;
}

function readJson(data: FormDataLike, name: string): unknown {
  const raw = data.get(name);
  if (raw === null || raw === undefined || raw === '') return undefined;
  if (typeof raw !== 'string') {
    throw new Error(`Invalid ticket create payload: ${name} must be a JSON string`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Invalid ticket create payload: ${name} is not valid JSON`);
  }
}

/**
 * Reads `asset_ids`, `watcher_ids` (JSON arrays of uuids) and `custom_fields` (JSON object) off the
 * create FormData, validating shape and custom fields. Throws before anything is written.
 */
export function parseTicketCreateExtras(data: FormDataLike): TicketCreateExtras {
  const parsed = ticketCreateExtrasSchema.safeParse({
    asset_ids: readJson(data, 'asset_ids'),
    watcher_ids: readJson(data, 'watcher_ids'),
    custom_fields: readJson(data, 'custom_fields'),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Invalid ticket create payload: ${issue.path.join('.') || 'payload'} ${issue.message}`);
  }

  const { asset_ids, watcher_ids, custom_fields } = parsed.data;
  const result: TicketCreateExtras = {
    assetIds: Array.from(new Set(asset_ids ?? [])),
    watcherIds: Array.from(new Set(watcher_ids ?? [])),
  };

  if (custom_fields !== undefined) {
    const issues = validateTicketCustomFields(custom_fields);
    if (issues.length > 0) {
      throw new Error(`Invalid custom fields: ${issues.map(describeTicketCustomFieldIssue).join('; ')}`);
    }
    result.customFields = normalizeTicketCustomFields(custom_fields);
  }
  return result;
}
