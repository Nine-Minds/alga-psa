/**
 * Title tokens for "Duplicate for contacts".
 *
 *   {{contact}}  the copy's contact (full name)
 *   {{client}}   the source ticket's client name
 *
 * Pure and safe for the client bundle: it must not import `ticketDuplicate.ts` (knex). The dialog
 * renders titles with this and `duplicateTicketBatch` validates the final strings with
 * `validateDuplicateTitle`, so what was reviewed is exactly what is created.
 */

import { findUnknownTokens, hasTokens, substituteTokens } from './titleTokens';

export const DUPLICATE_TITLE_TOKENS = ['contact', 'client'] as const;
export type DuplicateTitleToken = (typeof DUPLICATE_TITLE_TOKENS)[number];

export interface DuplicateTitleContext {
  contactName: string | null;
  clientName: string;
}

export type DuplicateTitleRenderResult =
  | { title: string }
  | { error: 'unknown_token'; tokens: string[] }
  | { error: 'contact_required' };

export function renderDuplicateTitle(template: string, context: DuplicateTitleContext): DuplicateTitleRenderResult {
  const unknown = findUnknownTokens(template, DUPLICATE_TITLE_TOKENS);
  if (unknown.length > 0) return { error: 'unknown_token', tokens: unknown };

  const contactName = context.contactName?.trim() ? context.contactName : null;
  if (contactName === null && /\{\{\s*contact\s*\}\}/.test(template)) return { error: 'contact_required' };

  const values: Record<DuplicateTitleToken, () => string> = {
    contact: () => contactName ?? '',
    client: () => context.clientName,
  };
  return { title: substituteTokens(template, values) };
}

/** Shared by client and server. No maximum length: ticket schemas set none. */
export function validateDuplicateTitle(title: string): 'empty' | 'unresolved_token' | null {
  if (title.trim().length === 0) return 'empty';
  if (hasTokens(title)) return 'unresolved_token';
  return null;
}
