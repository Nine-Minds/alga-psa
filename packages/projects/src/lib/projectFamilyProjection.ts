import { projectReadableRecord } from '@alga-psa/authorization/recordProjection';

/**
 * What the project read decision hides, applied to the phases and tasks of that project.
 *
 * The kernel has one `project` resource: a phase and a task are read through the decision made on their project
 * (`assertProjectReadAllowedById` resolves task -> phase -> project and decides once), so the fields that decision
 * redacts are the fields every row of the family loses. A seat technician's decision closes budget, billing and
 * rate columns (`SEAT_AUTHORITY_PROJECTION.project`); a reader with nothing redacted gets the rows back untouched,
 * the same array, so the MSP read paths allocate nothing and return what they always returned.
 *
 * A redacted field is OMITTED from the row, not nulled: the key never leaves the server.
 */
export type ProjectFamilyKind = 'phase' | 'task';

export function projectFamilyRow<T extends Record<string, any>>(
  kind: ProjectFamilyKind,
  row: T,
  redactedFields: readonly string[] | null | undefined,
): T {
  if (!redactedFields || redactedFields.length === 0) return row;
  // Fail closed: a row whose identity the redactions hide is not returned at all, never returned unprojected.
  const readable = projectReadableRecord(kind, row, redactedFields);
  if (!readable) throw new Error('Permission denied: Cannot read project');
  return readable;
}

export function projectFamilyRows<T extends Record<string, any>>(
  kind: ProjectFamilyKind,
  rows: readonly T[],
  redactedFields: readonly string[] | null | undefined,
): T[] {
  if (!redactedFields || redactedFields.length === 0) return rows as T[];
  return rows.map((row) => projectFamilyRow(kind, row, redactedFields));
}
