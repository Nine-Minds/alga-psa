// Pure, client-safe merge-field resolver for canned ticket responses. No db, knex or server imports:
// the editor picker (client) and createComment (server) both call it, so there is one resolver.
//
// Token syntax: `{{ path.to_field }}` (inner whitespace allowed, lookup is case-insensitive).
//
// Behavior for tokens (documented contract, covered by mergeFields.test.ts):
//   - A RECOGNISED token whose value is missing or empty resolves to the empty string.
//   - An UNRECOGNISED token is left exactly as written, so typos stay visible to the agent and
//     literal `{{ ... }}` text in a message that is not a merge field is never destroyed.
//   - Substitution is a single pass: a value that itself contains `{{...}}` is not re-expanded.
//   - Only text is resolved. Link hrefs, mention props and other attributes are never touched.
//   - A token must sit inside one styled text run. `{{contact.<b>first_name</b>}}` is split across
//     runs and is left alone (the picker inserts unstyled tokens, so this only affects hand-typed ones).

import type { CannedResponseMergeContext } from '@alga-psa/types';

export const MERGE_FIELD_KEYS = [
  'contact.first_name',
  'contact.last_name',
  'contact.name',
  'ticket.number',
  'ticket.title',
  'agent.name',
  'client.name',
] as const;

export type MergeFieldKey = (typeof MERGE_FIELD_KEYS)[number];

/** Rendered by the editor's merge-field helper; `exampleKey` is the i18n sub-key under `cannedResponses.mergeFields`. */
export function mergeFieldToken(key: MergeFieldKey): string {
  return `{{${key}}}`;
}

const TOKEN_PATTERN = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;
const KNOWN_KEYS: ReadonlySet<string> = new Set(MERGE_FIELD_KEYS);

export function emptyMergeContext(): CannedResponseMergeContext {
  return {
    contact: { first_name: null, last_name: null, name: null },
    ticket: { number: null, title: null },
    agent: { name: null },
    client: { name: null },
  };
}

/**
 * `contacts` stores one `full_name`. First name is the first whitespace-separated word; last name is the
 * last word when there are at least two. "Mary Ann Smith" -> first "Mary", last "Smith".
 */
export function splitFullName(fullName: string | null | undefined): { first_name: string | null; last_name: string | null } {
  const words = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { first_name: null, last_name: null };
  return { first_name: words[0], last_name: words.length > 1 ? words[words.length - 1] : null };
}

function lookup(context: CannedResponseMergeContext, key: MergeFieldKey): string {
  const [group, field] = key.split('.') as [keyof CannedResponseMergeContext, string];
  const value = (context[group] as Record<string, string | null | undefined> | undefined)?.[field];
  return value ?? '';
}

/** True when `text` contains anything shaped like a merge token (recognised or not). */
export function hasMergeTokens(text: string): boolean {
  TOKEN_PATTERN.lastIndex = 0;
  return TOKEN_PATTERN.test(text);
}

export function resolveMergeFieldsInText(text: string, context: CannedResponseMergeContext): string {
  return text.replace(TOKEN_PATTERN, (match, rawKey: string) => {
    const key = rawKey.toLowerCase();
    return KNOWN_KEYS.has(key) ? lookup(context, key as MergeFieldKey) : match;
  });
}

/**
 * Resolves tokens in every `{ type: 'text', text }` node of a BlockNote document (blocks, nested children,
 * links, table cells). Returns the same reference when nothing changed.
 */
export function resolveMergeFieldsInBlocks<T>(blocks: T, context: CannedResponseMergeContext): T {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      let changed = false;
      const next = node.map((child) => {
        const resolved = walk(child);
        if (resolved !== child) changed = true;
        return resolved;
      });
      return changed ? next : node;
    }
    if (node && typeof node === 'object') {
      const record = node as Record<string, unknown>;
      let changed = false;
      const next: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(record)) {
        let resolved: unknown;
        if (record.type === 'text' && field === 'text' && typeof value === 'string') {
          resolved = resolveMergeFieldsInText(value, context);
        } else if (field === 'props' || field === 'styles') {
          resolved = value; // attributes are never merge-resolved
        } else {
          resolved = walk(value);
        }
        if (resolved !== value) changed = true;
        next[field] = resolved;
      }
      return changed ? next : node;
    }
    return node;
  };
  return walk(blocks) as T;
}

/**
 * Same as resolveMergeFieldsInBlocks for a serialized note (`comments.note` / `canned_responses.body`).
 * Returns the input string untouched when nothing resolves; a note that is not a JSON document is
 * treated as plain text.
 */
export function resolveMergeFieldsInNote(note: string, context: CannedResponseMergeContext): string {
  if (!hasMergeTokens(note)) return note;
  let parsed: unknown;
  try {
    parsed = JSON.parse(note);
  } catch {
    return resolveMergeFieldsInText(note, context);
  }
  if (typeof parsed === 'string') return resolveMergeFieldsInText(note, context);
  const resolved = resolveMergeFieldsInBlocks(parsed, context);
  return resolved === parsed ? note : JSON.stringify(resolved);
}
