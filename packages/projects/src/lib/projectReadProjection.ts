import type { IProject } from '@alga-psa/types';

export type ProjectReadDecision = {
  allowed: boolean;
  redactedFields: string[];
};

type ProjectRecord = Partial<IProject> & Record<string, unknown>;

export const PROJECT_SEARCH_INDEX_TYPES = ['project', 'project_phase', 'project_task', 'project_task_comment'] as const;
export type ProjectSearchIndexType = typeof PROJECT_SEARCH_INDEX_TYPES[number];

/** Canonical sources for indexed project text, used to rebuild fields before matching. */
const PROJECT_INDEX_FIELD_SOURCES = {
  project: { title: ['projects.project_name'], subtitle: [], body: ['projects.description'] },
  project_phase: { title: ['project_phases.phase_name'], subtitle: ['projects.project_name'], body: ['project_phases.description'] },
  project_task: { title: ['project_tasks.task_name'], subtitle: ['projects.project_name'], body: ['project_tasks.description'] },
  project_task_comment: { title: ['project_tasks.task_name'], subtitle: ['projects.project_name'], body: ['project_task_comments.body'] },
} as const;
export const PROJECT_SEARCH_INDEX_FIELD_SOURCES: Record<ProjectSearchIndexType, Record<string, readonly string[]>> = {
  project: PROJECT_INDEX_FIELD_SOURCES.project,
  project_phase: PROJECT_INDEX_FIELD_SOURCES.project_phase,
  project_task: PROJECT_INDEX_FIELD_SOURCES.project_task,
  project_task_comment: PROJECT_INDEX_FIELD_SOURCES.project_task_comment,
};

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
    redacted === '*' || redacted === 'projects.*' || redacted === 'project.*' ||
    redacted === field || redacted === `projects.${field}` || redacted === `project.${field}`
  );
}

export function isWholeProjectRedacted(redactedFields: readonly string[]): boolean {
  return redactedFields.some((field) => field === '*' || field === 'projects.*' || field === 'project.*');
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

  // A wildcard decision covers the complete record, including fields not yet
  // known to this projection (and every display value added by enrichment).
  if (isWholeProjectRedacted(redactedFields)) {
    return {} as T;
  }

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
    return decision?.allowed && !isWholeProjectRedacted(decision.redactedFields ?? [])
      ? [projectRecord(record as ProjectRecord, decision.redactedFields ?? []) as T]
      : [];
  });
}

/** Shared list/detail pipeline: project before enrichment and reapply each decision afterward. */
export async function authorizeProjectRecordsForDisplay<T extends object>(
  records: T[],
  authorize: (record: T) => Promise<ProjectReadDecision>,
  enrich: (records: T[]) => Promise<T[]>,
): Promise<T[]> {
  const decisions = await Promise.all(records.map((record) => authorize(record)));
  const authorized = records.flatMap((record, index) =>
    decisions[index]?.allowed && !isWholeProjectRedacted(decisions[index].redactedFields ?? [])
      ? [{ record: projectRecord(record as ProjectRecord, decisions[index].redactedFields ?? []) as T, decision: decisions[index] }]
      : [],
  );
  if (authorized.length === 0) return [];
  const enriched = await enrich(authorized.map(({ record }) => record));
  return enriched.flatMap((record, index) => {
    const redactedFields = authorized[index].decision.redactedFields ?? [];
    return isWholeProjectRedacted(redactedFields) ? [] : [projectRecord(record as ProjectRecord, redactedFields) as T];
  });
}
