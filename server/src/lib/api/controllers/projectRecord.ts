import { projectApiRecord } from './apiRecordProjection';

/** Project a REST project row through the authorization kernel's field policy. */
export function projectRecord<T extends Record<string, any>>(
  record: T,
  redactedFields: readonly string[],
): Partial<T> | null {
  return projectApiRecord('project', record, redactedFields);
}
