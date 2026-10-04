import type { InputMapping } from '@alga-psa/workflows/runtime';

import { buildReferenceExpression } from './referenceValue';
import { TypeCompatibility, canSendAsOneItemList, getTypeCompatibility } from './typeCompatibility';

/** A source an input could be filled from, e.g. `vars.clientDetails.client.client_id`. */
export type AutoMappingSource = {
  path: string;
  type?: string;
  /** Entity kind from schema metadata (contact, user, client, ticket…). */
  kind?: string;
};

export type AutoMappingTarget = {
  name: string;
  type: string;
  enum?: ReadonlyArray<unknown>;
  constraints?: { itemType?: string };
  editor?: { kind?: string; picker?: { resource?: string } };
  picker?: { kind?: string };
};

export type AutoMappingSuggestion = {
  targetField: string;
  sourcePath: string;
  /** The expression to write: the path, or `[path]` when a single value fills a list input. */
  expression: string;
  /**
   * 'exact': same field name and type.
   * 'kind': a different name, but the same kind of record (e.g. a ticket's contact for a contact input).
   * 'partial': all words of one name appear in the other. A hint only.
   */
  confidence: 'exact' | 'kind' | 'partial';
  /** True when the source type is known to fit the input exactly. */
  typeMatched: boolean;
};

/** "assigned_to", "assignedTo" → ["assigned", "to"]. */
export const splitFieldNameWords = (name: string): string[] =>
  name
    .replace(/\[\]$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const lastSegment = (path: string): string => path.split('.').pop() ?? path;

const targetTypeOf = (target: AutoMappingTarget): string => {
  const itemType = target.constraints?.itemType;
  return target.type === 'array' && itemType && itemType !== 'unknown' && itemType !== 'any'
    ? `array<${itemType}>`
    : target.type;
};

const targetKindOf = (target: AutoMappingTarget): string | undefined =>
  target.editor?.picker?.resource ?? target.picker?.kind;

const containsAllWords = (container: string[], words: string[]): boolean =>
  words.length > 0 && words.every((word) => container.includes(word));

/**
 * Words that say who did something (actorUserId, assignedByUserId, createdBy…). Such a field is
 * the person who acted, not the record's subject or requester, so it only fills an input that
 * asks for that same role.
 */
const ACTION_ROLE_WORDS = new Set(['actor', 'by']);
const roleWords = (words: string[]): string[] => words.filter((word) => ACTION_ROLE_WORDS.has(word));

/**
 * Words naming text the author writes (a comment to post, a title to show, a message to send).
 * A field with the same name elsewhere is text someone else wrote for another purpose (a
 * notification's title is not the ticket's title; a comment to add is not the latest comment
 * read), so these inputs get no automatic hints. The value-source control still lists fitting
 * fields, same names first.
 */
const AUTHORED_TEXT_WORDS = new Set([
  'body', 'comment', 'content', 'description', 'html', 'message', 'note', 'reason', 'subject',
  'summary', 'text', 'title',
]);
const isAuthoredTextTarget = (target: AutoMappingTarget, words: string[]): boolean =>
  target.type === 'string' &&
  !target.enum?.length &&
  !targetKindOf(target) &&
  words.length > 0 &&
  AUTHORED_TEXT_WORDS.has(words[words.length - 1]);

// Workflow bookkeeping, never a business value.
const isBookkeepingPath = (path: string): boolean => path.startsWith('meta.') || path.startsWith('error.');

type Candidate = AutoMappingSuggestion & { rank: number };

/**
 * Suggests a source for each unmapped input. A suggestion has to make sense, not just share a
 * word:
 * - the source type must fit the input (no id text for a number, no free text for a choice list);
 * - entity ids must be the same kind of record (contact vs user);
 * - fields naming who acted (actor…, …By…) never fill other roles such as the requester;
 * - names must agree as whole words, so "cc" never matches "occursOn".
 */
export const findAutoMappingSuggestions = (
  targets: AutoMappingTarget[],
  sources: AutoMappingSource[],
  currentMappings: InputMapping
): AutoMappingSuggestion[] => {
  const suggestions: AutoMappingSuggestion[] = [];

  for (const target of targets) {
    if (currentMappings[target.name] !== undefined) continue;
    const targetWords = splitFieldNameWords(target.name);
    const targetKey = targetWords.join('');
    const targetType = targetTypeOf(target);
    const targetKind = targetKindOf(target);
    const targetRoles = roleWords(targetWords);
    const targetIsChoice = Boolean(target.enum?.length);
    if (isAuthoredTextTarget(target, targetWords)) continue;

    let best: Candidate | null = null;
    for (const source of sources) {
      // Bare containers (payload, vars.step) are whole objects, not fields.
      if (source.path.split('.').length < 2 || isBookkeepingPath(source.path)) continue;
      const sourceWords = splitFieldNameWords(lastSegment(source.path));
      const sourceRoles = roleWords(sourceWords);
      if (sourceRoles.some((role) => !targetRoles.includes(role))) continue;

      if (targetKind && source.kind && targetKind !== source.kind) continue;

      const compatibility = getTypeCompatibility(source.type, targetType);
      const wrapsAsList = canSendAsOneItemList(source.type, targetType);
      const typeMatched = compatibility === TypeCompatibility.EXACT || wrapsAsList;
      const typeUnknown = compatibility === TypeCompatibility.UNKNOWN;
      // Conversions (text → number…) are allowed when writing by hand, never suggested.
      if (!typeMatched && !typeUnknown) continue;

      const nameExact = sourceWords.join('') === targetKey;
      const sameKind = Boolean(targetKind && source.kind === targetKind);
      const confidence: AutoMappingSuggestion['confidence'] | null = nameExact
        ? 'exact'
        : sameKind && typeMatched
          ? 'kind'
          : containsAllWords(sourceWords, targetWords) || containsAllWords(targetWords, sourceWords)
            ? 'partial'
            : null;
      if (!confidence) continue;
      if (typeUnknown && confidence !== 'exact') continue;
      // A similar name alone says little about plain text (an assignment "comment" vs the ticket's
      // "latest_comment"): only records of a known kind may match on part of a name.
      if (confidence === 'partial' && !targetKind) continue;
      // A choice list only takes a source that is plainly the same field.
      if (targetIsChoice && confidence !== 'exact') continue;
      // An id for a kind of record needs a source known to be that kind, or the very same name.
      if (targetKind && !source.kind && confidence !== 'exact') continue;

      const rank =
        (confidence === 'exact' ? 4 : confidence === 'kind' ? 2 : 0) +
        (typeMatched ? 1 : 0) +
        (sameKind ? 1 : 0) +
        // Prefer an earlier step's looked-up record over raw trigger fields for the same match.
        (source.path.startsWith('vars.') ? 0.5 : 0);
      const candidate: Candidate = {
        targetField: target.name,
        sourcePath: source.path,
        expression: buildReferenceExpression(source.path, source.type, targetType),
        confidence,
        typeMatched,
        rank,
      };
      if (!best || candidate.rank > best.rank) best = candidate;
    }

    if (best) {
      const { rank: _rank, ...suggestion } = best;
      suggestions.push(suggestion);
    }
  }

  return suggestions;
};

/** A same-name suggestion whose type is known to fit. Anything weaker is only a hint. */
export const isApplicableSuggestion = (suggestion: AutoMappingSuggestion | undefined): boolean =>
  Boolean(suggestion && suggestion.confidence === 'exact' && suggestion.typeMatched);

/**
 * The suggestions "Apply suggestions" may fill in one click: same-name, type-matched matches for
 * REQUIRED inputs that are still empty. Optional inputs are never bulk-filled, because filling one
 * changes what the step does (attachments re-attach files, a comment posts text, a flag notifies
 * someone); they keep their per-field hint and the author decides.
 */
export const selectBulkApplicableSuggestions = (
  suggestions: AutoMappingSuggestion[],
  targets: ReadonlyArray<{ name: string; required?: boolean; explicitChoice?: unknown }>,
  isFilled: (fieldName: string) => boolean
): AutoMappingSuggestion[] => {
  // A choice the author must make themselves (comment visibility) is never made for them.
  const requiredNames = new Set(
    targets.filter((target) => target.required && !target.explicitChoice).map((target) => target.name)
  );
  return suggestions.filter(
    (suggestion) =>
      isApplicableSuggestion(suggestion) &&
      requiredNames.has(suggestion.targetField) &&
      !isFilled(suggestion.targetField)
  );
};

const ID_FIELD_NAME = /(?:_id|Id|_ids|Ids)$/;

/**
 * A suggestion good enough to fill an input on its own: an id input (client_id, ticket_id…) with a
 * same-name source of a matching type. Ids name one specific record, so the match is unambiguous;
 * free-text names such as "title" often mean different things (a notification title is not the
 * ticket's title), so those are only offered, never applied.
 */
export const isStrongSuggestion = (
  suggestion: AutoMappingSuggestion | undefined,
  target?: { name: string; editor?: { kind?: string } }
): boolean =>
  Boolean(
    isApplicableSuggestion(suggestion) &&
    target &&
    (target.editor?.kind === 'picker' || ID_FIELD_NAME.test(target.name))
  );

/**
 * What a field's own Fill button applies: everything strong, plus a same-kind match on a picker
 * input (a contact id from "Contact name ID"), where the field and the source name the same kind
 * of record. Similar-name guesses stay hints, because they say "check before using".
 */
export const isFillableSuggestion = (
  suggestion: AutoMappingSuggestion | undefined,
  target?: { name: string; editor?: { kind?: string } }
): boolean =>
  isStrongSuggestion(suggestion, target) ||
  Boolean(suggestion && suggestion.confidence === 'kind' && target?.editor?.kind === 'picker');

export type RankedSource = {
  source: AutoMappingSource;
  /** Lower is better: 0 same name, 1 same kind of record, 2 similar name, 3 fits the type, 4 who-acted fields. */
  tier: 0 | 1 | 2 | 3 | 4;
  expression: string;
};

/**
 * Every source that can fill the input, best first, for a field-by-field chooser. Sources whose
 * type can't fill the input, or that are a different kind of record, are left out; fields naming
 * who acted are kept but listed last.
 */
export const rankSourcesForTarget = (
  target: AutoMappingTarget,
  sources: AutoMappingSource[]
): RankedSource[] => {
  const targetWords = splitFieldNameWords(target.name);
  const targetKey = targetWords.join('');
  const targetType = targetTypeOf(target);
  const targetKind = targetKindOf(target);
  const targetRoles = roleWords(targetWords);
  const ranked: Array<RankedSource & { order: number }> = [];

  sources.forEach((source, order) => {
    if (source.path.split('.').length < 2 && !/^[A-Za-z_$][\w$]*$/.test(source.path)) return;
    if (source.path.startsWith('meta.')) return;
    if (targetKind && source.kind && targetKind !== source.kind) return;
    const compatibility = getTypeCompatibility(source.type, targetType);
    const wrapsAsList = canSendAsOneItemList(source.type, targetType);
    const fits =
      compatibility === TypeCompatibility.EXACT ||
      compatibility === TypeCompatibility.UNKNOWN ||
      wrapsAsList ||
      // Any value can be written into free text (not into a record id).
      (targetType === 'string' && !targetKind && compatibility === TypeCompatibility.COERCIBLE);
    if (!fits) return;

    const sourceWords = splitFieldNameWords(lastSegment(source.path));
    const roleMismatch = roleWords(sourceWords).some((role) => !targetRoles.includes(role));
    const tier: RankedSource['tier'] = roleMismatch
      ? 4
      : sourceWords.join('') === targetKey
        ? 0
        : targetKind && source.kind === targetKind
          ? 1
          : containsAllWords(sourceWords, targetWords) || containsAllWords(targetWords, sourceWords)
            ? 2
            : 3;
    ranked.push({ source, tier, expression: buildReferenceExpression(source.path, source.type, targetType), order });
  });

  return ranked
    .sort((left, right) => left.tier - right.tier || left.order - right.order)
    .map(({ order: _order, ...entry }) => entry);
};
