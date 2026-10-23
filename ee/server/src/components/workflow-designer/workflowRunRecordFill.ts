/**
 * "Fill from a real record" for the Run dialog: after the user picks an entity (a contract, a
 * ticket, a client) in a payload field, the related fields beside it fill in from that record, so
 * a test payload describes one real, consistent record instead of hand-copied ids and dates.
 *
 * Resolvers are keyed by picker kind and return the record's fields under canonical snake_case
 * names (client_id, end_date, ...). Payload keys match them by name regardless of case style
 * (clientId, client_id), so this works for any payload schema without per-trigger code.
 */

export type WorkflowRecordFields = Record<string, string | number | boolean | null | undefined>;
export type WorkflowRecordResolver = (id: string) => Promise<WorkflowRecordFields | null>;

/** Picker kind → the record fields of that kind, first non-empty wins. */
export type WorkflowRecordKindFields = Partial<Record<string, readonly string[]>>;

export type WorkflowRecordSource = {
  /** Every field the record can provide, so the dialog can say what will fill before the lookup. */
  fields: readonly string[];
  /**
   * Payload fields whose name doesn't match a record field but that pick the same kind of record
   * (assignedToUserId, newAssigneeId) take the record's field of that kind.
   */
  kindFields?: WorkflowRecordKindFields;
  resolve: WorkflowRecordResolver;
};
export type WorkflowRecordSources = Partial<Record<string, WorkflowRecordSource>>;

const normalizeKey = (key: string): string => key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

const keyWords = (key: string): string[] =>
  key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/**
 * Words naming a different person or value than the record's own (previousAssigneeId,
 * assignedByUserId, actorUserId). Such fields only fill by exact name, never by kind.
 */
const OTHER_ROLE_WORDS = new Set(['previous', 'prior', 'old', 'by', 'actor']);
const namesOtherRole = (key: string): boolean => keyWords(key).some((word) => OTHER_ROLE_WORDS.has(word));

/** Record fields that may fill `sibling`, best first: the same name, then the same kind of record. */
const recordFieldCandidates = (sibling: RecordFillField, kindFields?: WorkflowRecordKindFields): string[] => {
  const candidates = [normalizeKey(sibling.key)];
  if (sibling.pickerKind && !namesOtherRole(sibling.key)) {
    candidates.push(...(kindFields?.[sibling.pickerKind] ?? []).map(normalizeKey));
  }
  return candidates;
};

const isEmptyValue = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

/** YYYY-MM-DD for date-only fields; record dates may arrive as timestamps. */
export const toDateOnly = (value: unknown): string | null => {
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  const text = value instanceof Date ? value.toISOString() : value;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text.trim());
  return match ? match[1] : null;
};

export type RecordFillField = {
  key: string;
  /** Picker kind of the payload field, when it holds an entity id. */
  pickerKind?: string;
  /** True for date-only (YYYY-MM-DD) fields. */
  isDateOnly?: boolean;
};

/**
 * Values to write into the sibling payload fields of a picked record. A field is filled when it is
 * empty or when `canOverwrite` says its value wasn't entered by the user (a sample, template, or
 * earlier record value), so nothing the user typed is overwritten and placeholder data such as
 * "Sample Name" never survives a real pick. The picked field itself is left alone.
 */
export const buildRecordFill = (
  record: WorkflowRecordFields,
  pickedKey: string,
  siblings: RecordFillField[],
  currentValues: Record<string, unknown>,
  canOverwrite: (key: string) => boolean = () => false,
  kindFields?: WorkflowRecordKindFields
): Record<string, unknown> => {
  const recordByKey = new Map<string, unknown>();
  for (const [key, value] of Object.entries(record)) {
    if (!isEmptyValue(value)) recordByKey.set(normalizeKey(key), value);
  }

  const fill: Record<string, unknown> = {};
  for (const sibling of siblings) {
    if (sibling.key === pickedKey) continue;
    if (!isEmptyValue(currentValues[sibling.key]) && !canOverwrite(sibling.key)) continue;
    const value = recordFieldCandidates(sibling, kindFields)
      .map((candidate) => recordByKey.get(candidate))
      .find((candidate) => candidate !== undefined);
    if (value === undefined) continue;
    if (sibling.isDateOnly) {
      const date = toDateOnly(value);
      if (date) fill[sibling.key] = date;
      continue;
    }
    fill[sibling.key] = value;
  }
  return fill;
};

/**
 * The sibling fields a record of this source can fill, in form order. Used to tell the user exactly
 * which fields a pick fills; whether each one fills still depends on the record having a value.
 */
export const listRecordFillTargets = (
  source: Pick<WorkflowRecordSource, 'fields' | 'kindFields'>,
  pickedKey: string,
  siblings: RecordFillField[]
): string[] => {
  const available = new Set(source.fields.map(normalizeKey));
  return siblings
    .filter((sibling) => sibling.key !== pickedKey)
    .filter((sibling) => recordFieldCandidates(sibling, source.kindFields).some((candidate) => available.has(candidate)))
    .map((sibling) => sibling.key);
};

/** Stable key for a payload path, used to remember which fields the user edited. */
export const payloadPathKey = (path: Array<string | number>): string => JSON.stringify(path);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Paths of the leaf values that differ between two payloads. The Run dialog uses it to record
 * which fields a user edit actually changed, whichever editor (form field or JSON) made it.
 */
export const collectChangedPayloadPaths = (
  previous: unknown,
  next: unknown,
  path: Array<string | number> = []
): Array<Array<string | number>> => {
  if (Object.is(previous, next)) return [];
  if (isPlainObject(previous) && isPlainObject(next)) {
    const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
    return Array.from(keys).flatMap((key) => collectChangedPayloadPaths(previous[key], next[key], [...path, key]));
  }
  if (Array.isArray(previous) && Array.isArray(next)) {
    const length = Math.max(previous.length, next.length);
    return Array.from({ length }, (_, index) => index).flatMap((index) =>
      collectChangedPayloadPaths(previous[index], next[index], [...path, index])
    );
  }
  if (!isPlainObject(previous) && !isPlainObject(next) && !Array.isArray(previous) && !Array.isArray(next)
    && JSON.stringify(previous) === JSON.stringify(next)) {
    return [];
  }
  return [path];
};

/** True when `path` or one of its parents or children was edited by the user. */
export const isPayloadPathEdited = (editedPaths: ReadonlySet<string>, path: Array<string | number>): boolean => {
  for (let length = 1; length <= path.length; length += 1) {
    if (editedPaths.has(payloadPathKey(path.slice(0, length)))) return true;
  }
  const prefix = payloadPathKey(path).slice(0, -1);
  for (const edited of editedPaths) {
    if (edited.startsWith(`${prefix},`)) return true;
  }
  return false;
};
