/**
 * A smart search candidate is one row of an entity list rendered as the JSON
 * Jev reads: a head of named facts, a description, and ordered sections of
 * child rows (a ticket's comments, a project's tasks and comments). Entities
 * decide what goes in; this module decides how much fits.
 *
 * Budgeting is deliberate: the description is truncated first, then each
 * section is filled in order, newest item first, until the per-candidate
 * budget is spent. Everything that does not fit is dropped, except that the
 * newest item is truncated rather than dropped when the candidate would
 * otherwise carry no child at all, so the most recent state always reaches
 * the model.
 * The numbers live in budgets.ts.
 */

import { flattenBlockNote, flattenMarkdown } from '@alga-psa/search/normalize';

import { SMART_SEARCH_BUDGETS, approxTokens, charsForTokens, type CandidateBudgets } from './budgets';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface SmartSearchCandidate {
  id: string;
  /** What Jev sees for this candidate. Never carries the id or the token estimate. */
  state: JsonObject;
  approxTokens: number;
}

/** A child row. `text` is the free-text part that gets truncated when the row is the only one that fits. */
export type CandidateChild = JsonObject & { text: string };

export interface CandidateSection {
  /** Key under which the kept children land in the state, e.g. `comments`. */
  key: string;
  /** Newest first. */
  items: CandidateChild[];
}

export interface CandidateAssemblyInput {
  id: string;
  /** Named facts in the order Jev should read them (number, title, status, dates, …). */
  head: JsonObject;
  /** Raw description: markdown or BlockNote JSON. Normalized and truncated here. */
  description: string | null | undefined;
  /** Filled in order; an earlier section takes budget before a later one. */
  sections: CandidateSection[];
}

/** Plain text from markdown or BlockNote JSON, trimmed. */
export function normalizeRichText(raw: string | null | undefined): string {
  const value = raw?.trim() ?? '';
  if (!value) {
    return '';
  }
  const looksLikeBlockNoteJson = value.startsWith('[') || value.startsWith('{');
  return (looksLikeBlockNoteJson ? flattenBlockNote(value) : flattenMarkdown(value)).trim();
}

/** Cut at the last sentence end (or word) inside `maxChars`; append an ellipsis. */
export function truncateAtBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  const window = text.slice(0, maxChars);
  const sentenceEnd = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '));
  const cutAt = sentenceEnd >= maxChars * 0.5
    ? sentenceEnd + 1
    : Math.max(window.lastIndexOf(' '), Math.floor(maxChars * 0.8));
  return `${window.slice(0, cutAt).trimEnd()} …`;
}

export function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function fullName(first: string | null | undefined, last: string | null | undefined): string | null {
  return nonEmpty(`${first ?? ''} ${last ?? ''}`);
}

function tokensOf(value: JsonValue): number {
  return approxTokens(JSON.stringify(value));
}

/**
 * Pure budgeting step, exported for tests.
 */
export function assembleCandidate(
  input: CandidateAssemblyInput,
  budgets: CandidateBudgets = SMART_SEARCH_BUDGETS
): SmartSearchCandidate {
  const description = truncateAtBoundary(
    normalizeRichText(input.description),
    charsForTokens(budgets.descriptionMaxTokens)
  );

  let used = tokensOf(input.head) + approxTokens(description);
  const state: JsonObject = { ...input.head, description };
  let keptAny = false;

  for (const section of input.sections) {
    const kept: CandidateChild[] = [];
    for (const child of section.items) {
      const remaining = budgets.tokensPerCandidate - used;
      if (remaining <= 0) {
        break;
      }
      const cost = tokensOf(child);
      if (cost <= remaining) {
        kept.push(child);
        keptAny = true;
        used += cost;
        continue;
      }
      if (!keptAny) {
        // The newest child that does not fit is truncated rather than dropped,
        // but only while the candidate has no child at all: a sliver of a
        // later section behind a full earlier one is noise, not signal.
        const room = remaining - tokensOf({ ...child, text: '' });
        if (room > 0) {
          const truncated: CandidateChild = { ...child, text: truncateAtBoundary(child.text, charsForTokens(room)) };
          kept.push(truncated);
          keptAny = true;
          used += tokensOf(truncated);
        }
      }
      break;
    }
    state[section.key] = kept;
  }

  return { id: input.id, state, approxTokens: used };
}
