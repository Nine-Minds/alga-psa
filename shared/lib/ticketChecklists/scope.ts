/**
 * Pure checklist-template scope helpers. Deliberately has NO imports: client ('use client')
 * modules import this file directly via `@alga-psa/shared/lib/ticketChecklists/scope`, and
 * pulling the barrel instead drags @alga-psa/db -> knex -> pg-connection-string -> fs into the
 * browser bundle.
 */

/** Why a template was not applied, when that is not simply "already applied" / "no items". */
export const CHECKLIST_TEMPLATE_CLIENT_MISMATCH = 'template-client-mismatch' as const;

/**
 * Template scope predicate: a template with no client is tenant-wide; otherwise it is only in
 * scope for tickets of that client. Independent of auto-apply rule matching.
 */
export function isChecklistTemplateInScopeForClient(
  templateClientId: string | null | undefined,
  ticketClientId: string | null | undefined
): boolean {
  return !templateClientId || templateClientId === ticketClientId;
}
