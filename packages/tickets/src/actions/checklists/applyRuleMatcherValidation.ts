/**
 * Save-time normalisation + validation for the matcher columns of a checklist
 * auto-apply rule. Pure (no 'use server') so the settings UI and unit tests can
 * share the same limits as the server actions.
 */

export const APPLY_RULE_MAX_KEYWORDS = 20;
export const APPLY_RULE_MAX_KEYWORD_LENGTH = 64;

export const APPLY_RULE_TICKET_ORIGINS = [
  'internal',
  'client_portal',
  'inbound_email',
  'api',
  'recurring',
] as const;

export const APPLY_RULE_KEYWORD_MODES = ['any', 'all'] as const;
export const APPLY_RULE_KEYWORD_TARGETS = ['title', 'description', 'title_and_description'] as const;

export const APPLY_RULE_TOO_MANY_KEYWORDS = `A rule can have at most ${APPLY_RULE_MAX_KEYWORDS} keywords.`;
export const APPLY_RULE_KEYWORD_TOO_LONG = `Each keyword can be at most ${APPLY_RULE_MAX_KEYWORD_LENGTH} characters.`;
export const APPLY_RULE_ORIGIN_INVALID = 'One of the selected ticket sources is not valid.';

/** Trim, drop empties, de-duplicate (case-insensitively, first spelling wins). */
export function normalizeRuleKeywords(keywords: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of keywords ?? []) {
    const keyword = String(raw).trim();
    if (!keyword) continue;
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(keyword);
  }
  return result;
}

/** Normalise then enforce limits. Returns null when no keywords remain. */
export function validateRuleKeywords(keywords: readonly string[] | null | undefined): string[] | null {
  const normalized = normalizeRuleKeywords(keywords);
  if (normalized.length > APPLY_RULE_MAX_KEYWORDS) {
    throw new Error(APPLY_RULE_TOO_MANY_KEYWORDS);
  }
  if (normalized.some((k) => k.length > APPLY_RULE_MAX_KEYWORD_LENGTH)) {
    throw new Error(APPLY_RULE_KEYWORD_TOO_LONG);
  }
  return normalized.length > 0 ? normalized : null;
}

export function validateRuleOrigins(origins: readonly string[] | null | undefined): string[] | null {
  const unique = Array.from(new Set((origins ?? []).filter(Boolean)));
  if (unique.some((o) => !(APPLY_RULE_TICKET_ORIGINS as readonly string[]).includes(o))) {
    throw new Error(APPLY_RULE_ORIGIN_INVALID);
  }
  return unique.length > 0 ? unique : null;
}

export function uniqueIdsOrNull(ids: readonly string[] | null | undefined): string[] | null {
  const unique = Array.from(new Set((ids ?? []).filter(Boolean)));
  return unique.length > 0 ? unique : null;
}

export const APPLY_RULE_CLIENT_OUTSIDE_TEMPLATE_SCOPE =
  'This template belongs to one client, so its rules cannot target other clients.';
export const TEMPLATE_RULES_TARGET_OTHER_CLIENTS =
  "Some of this template's auto-apply rules target other clients. Remove those clients from the rules before assigning the template to one client.";

/**
 * The client matcher of a rule on a template owned by `templateClientId`.
 *
 * Ownership (checklist_templates.client_id) is a hard boundary enforced at apply time; the rule's
 * client matcher is targeting inside that boundary. On an owned template the only client a rule
 * could ever fire for is the owner, so naming another client would save a rule that silently never
 * applies there: rejected. Naming only the owner is redundant with ownership and is stored as
 * "any client" (null), so the rule follows the template if its owner is later released.
 * Tenant-wide templates (no owner) keep the list as given.
 */
export function ruleClientIdsForTemplate(
  templateClientId: string | null | undefined,
  clientIds: readonly string[] | null | undefined
): string[] | null {
  const ids = uniqueIdsOrNull(clientIds);
  if (!templateClientId || !ids) return ids;
  if (ids.some((id) => id !== templateClientId)) {
    throw new Error(APPLY_RULE_CLIENT_OUTSIDE_TEMPLATE_SCOPE);
  }
  return null;
}
