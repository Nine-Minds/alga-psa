import type { NodeStep, Step } from '@alga-psa/workflows/runtime/client';
import { getStepBranches } from './workflowStepTree';

/**
 * Generate a smart default saveAs variable name from an action ID.
 * Converts snake_case or kebab-case to camelCase and adds "Result" suffix.
 * e.g., "lookup_threading_headers" → "threadingHeadersResult"
 *       "create_ticket_from_email" → "ticketFromEmailResult"
 */
export const generateSaveAsName = (actionId: string): string => {
  // Normalize namespaces like "tickets.add_comment" → "tickets_add_comment"
  const normalizedId = actionId.replace(/\./g, '_');

  // Remove common prefixes like "get_", "create_", "update_", "delete_", "find_", "lookup_", "resolve_"
  const prefixPattern = /^(get_|create_|update_|delete_|find_|lookup_|resolve_|fetch_|load_|process_|send_|call_)/i;
  let cleaned = normalizedId.replace(prefixPattern, '');

  // If cleaning removed everything, use the original
  if (!cleaned) cleaned = actionId;

  // Convert snake_case or kebab-case to camelCase
  const camelCase = cleaned
    .toLowerCase()
    .replace(/[-_](.)/g, (_, char) => char.toUpperCase());

  // Add "Result" suffix
  return camelCase + 'Result';
};

/** Every saveAs name in a step list, including those inside if/try/forEach branches. */
export const collectSaveAsNames = (steps: Step[], options?: { excludeStepId?: string }): string[] =>
  steps.flatMap((item) => {
    const saveAs = ((item as NodeStep).config as Record<string, unknown> | undefined)?.saveAs;
    const own = item.id !== options?.excludeStepId && typeof saveAs === 'string' && saveAs ? [saveAs] : [];
    return [
      ...own,
      ...getStepBranches(item).flatMap((branch) => collectSaveAsNames(branch.steps, options)),
    ];
  });

/** `base`, or `base2`, `base3`… — the first that isn't already taken. */
export const uniqueSaveAsName = (base: string, taken: Iterable<string>): string => {
  const takenNames = new Set(taken);
  let name = base;
  for (let suffix = 2; takenNames.has(name); suffix += 1) {
    name = `${base}${suffix}`;
  }
  return name;
};

/**
 * The default saveAs name for an action, made unique across the whole workflow so a second step
 * running the same action (e.g. in an Else branch) doesn't collide with the first one's output.
 * Pass the id of the step being (re)named so its own current name doesn't count as taken.
 */
export const generateUniqueSaveAsName = (
  actionId: string,
  steps: Step[],
  options?: { excludeStepId?: string }
): string => uniqueSaveAsName(generateSaveAsName(actionId), collectSaveAsNames(steps, options));

/** True when `saveAs` is `base` or `base` with a uniqueness suffix (see uniqueSaveAsName). */
export const isSaveAsNameFromBase = (saveAs: string, base: string): boolean =>
  saveAs === base || (saveAs.startsWith(base) && /^(?:[2-9]|[1-9]\d+)$/.test(saveAs.slice(base.length)));
