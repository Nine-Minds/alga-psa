import type { CoManagedTicketEditField, CoManagedTicketEditPatch } from '@alga-psa/co-managed';
import type { SharedTicketData } from './sharedTicketDataTypes';

/**
 * Pure, client-safe translation between the native ticket screen's shapes and
 * the shared (co-managed) commands. No I/O, no session access: everything the
 * mapping needs is passed in, so it is unit-testable and cannot reach a
 * native ticket-id action.
 */

const EDITABLE_FIELDS: readonly CoManagedTicketEditField[] = ['title', 'url', 'status_id', 'priority_id', 'due_date', 'response_state', 'description', 'category_id'];

export type SharedEditMapping =
  | { ok: true; patch: CoManagedTicketEditPatch }
  | { ok: false; code: 'invalid' | 'forbidden' };

const nullable = (value: unknown): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null || value === '' || value === 'unassigned') return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : undefined;
  return typeof value === 'string' ? value : undefined;
};

/**
 * Translate the native screen's `changes` object into a shared edit patch.
 * Anything the shared model cannot write (assignee, board, client, ...) is
 * `forbidden`, never silently dropped; a field the caller may not edit is
 * `forbidden` too. The category change clears the subcategory on the server,
 * so a null/absent `subcategory_id` that rides along is not a change.
 */
export function toSharedEditPatch(changes: Record<string, unknown>, editable: readonly CoManagedTicketEditField[]): SharedEditMapping {
  const patch: Record<string, string | null> = {};
  for (const [key, raw] of Object.entries(changes ?? {})) {
    if (key === 'attributes') {
      // The native description save sends the whole attributes object; only the description is a shared field.
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, code: 'invalid' };
      if (!('description' in raw)) continue;
      const description = (raw as { description?: unknown }).description;
      if (description !== null && typeof description !== 'string') return { ok: false, code: 'invalid' };
      patch.description = description as string | null;
      continue;
    }
    if (key === 'subcategory_id') {
      if (raw === undefined || raw === null || raw === '') continue;
      return { ok: false, code: 'forbidden' };
    }
    if (!(EDITABLE_FIELDS as readonly string[]).includes(key)) return { ok: false, code: 'forbidden' };
    const value = nullable(raw);
    if (value === undefined) return { ok: false, code: 'invalid' };
    patch[key] = value;
  }
  for (const field of Object.keys(patch)) {
    if (!editable.includes(field as CoManagedTicketEditField)) return { ok: false, code: 'forbidden' };
  }
  return { ok: true, patch: patch as CoManagedTicketEditPatch };
}

/** Stable identity of one intended edit, so a retry replays the same operation id. */
export const sharedEditKey = (expected: CoManagedTicketEditPatch, patch: CoManagedTicketEditPatch): string =>
  JSON.stringify([Object.entries(expected).sort(), Object.entries(patch).sort()]);

// LEVERAGE: friction shared-ticket-conversation — conversation item mapping (comments, author attribution) belongs to L4a and is not ported here.

/** The ticket data the native container renders, with the workspace name where the client name sits. */
export function withWorkspaceHeader(data: SharedTicketData, customerName: string): SharedTicketData {
  const end = data.client?.client_name?.trim();
  return { ...data, client: { client_name: end && end !== customerName ? `${customerName} · ${end}` : customerName } };
}
