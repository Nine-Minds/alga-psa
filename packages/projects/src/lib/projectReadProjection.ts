import type { IProject } from '@alga-psa/types';

export type ProjectReadDecision = {
  allowed: boolean;
  redactedFields: string[];
};

type ProjectRecord = Partial<IProject> & Record<string, unknown>;

const PROJECT_FIELD_SOURCES: Record<string, string[]> = {
  client_name: ['client_id', 'client_name'],
  assigned_to_first_name: ['assigned_to', 'assigned_to_first_name', 'assigned_to_last_name', 'assigned_user'],
  assigned_to_last_name: ['assigned_to', 'assigned_to_first_name', 'assigned_to_last_name', 'assigned_user'],
  assigned_user: ['assigned_to', 'assigned_user', 'assigned_to_first_name', 'assigned_to_last_name'],
  contact_name: ['contact_name_id', 'contact_name'],
  status_name: ['status', 'status_name', 'is_closed'],
  is_closed: ['status', 'status_name', 'is_closed'],
};

export function isProjectFieldRedacted(redactedFields: readonly string[], field: string): boolean {
  return redactedFields.some((redacted) =>
    redacted === '*' || redacted === field || redacted === `projects.${field}` || redacted === `project.${field}`
  );
}

export function assertProjectFieldsWritable(redactedFields: readonly string[], fields: readonly string[]): void {
  const hidden = fields.filter((field) => {
    const related = [field];
    for (const [derivedField, sources] of Object.entries(PROJECT_FIELD_SOURCES)) {
      if (sources.includes(field)) related.push(derivedField);
      if (derivedField === field) related.push(...sources);
    }
    return related.some((candidate) => isProjectFieldRedacted(redactedFields, candidate));
  });
  if (hidden.length > 0) {
    throw new Error(`Permission denied: Cannot update redacted project field${hidden.length === 1 ? '' : 's'}`);
  }
}

/** Removes hidden source fields and any display values derived from those sources. */
export function projectRecord<T extends ProjectRecord>(record: T, redactedFields: readonly string[]): T {
  if (redactedFields.length === 0) return record;

  const projected: Record<string, unknown> = { ...record };
  for (const field of redactedFields) {
    const source = field.replace(/^(projects|project)\./, '');
    delete projected[source];
    for (const [derivedField, sources] of Object.entries(PROJECT_FIELD_SOURCES)) {
      if (derivedField === source) {
        for (const relatedSource of sources) delete projected[relatedSource];
      }
      if (sources.includes(source)) delete projected[derivedField];
    }
  }

  for (const [derivedField, sources] of Object.entries(PROJECT_FIELD_SOURCES)) {
    if (sources.some((source) => isProjectFieldRedacted(redactedFields, source))) {
      delete projected[derivedField];
    }
  }

  return projected as T;
}

export async function authorizeAndProjectProjectRecords<T extends object>(
  records: T[],
  authorize: (record: T) => Promise<ProjectReadDecision>,
): Promise<T[]> {
  const decisions = await Promise.all(records.map((record) => authorize(record)));
  return records.flatMap((record, index) => {
    const decision = decisions[index];
    return decision?.allowed ? [projectRecord(record as ProjectRecord, decision.redactedFields ?? []) as T] : [];
  });
}
