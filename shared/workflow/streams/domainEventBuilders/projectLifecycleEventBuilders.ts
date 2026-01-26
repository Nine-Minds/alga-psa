type ProjectLike = Record<string, unknown> & {
  project_id: string;
};

function snakeToCamel(value: string): string {
  return value.replace(/_([a-z])/g, (_, c) => String(c).toUpperCase());
}

function normalizeChangeValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function areValuesEqual(a: unknown, b: unknown): boolean {
  const na = normalizeChangeValue(a);
  const nb = normalizeChangeValue(b);
  if (na === nb) return true;
  if (typeof na !== 'object' || na === null) return false;
  if (typeof nb !== 'object' || nb === null) return false;

  try {
    return JSON.stringify(na) === JSON.stringify(nb);
  } catch {
    return false;
  }
}

export function buildProjectUpdatedPayload(params: {
  projectId: string;
  before: ProjectLike;
  after: ProjectLike;
  updatedFieldKeys: string[];
  updatedAt?: Date | string;
}): Record<string, unknown> {
  const updatedFields: string[] = [];
  const changes: Record<string, { previous: unknown; new: unknown }> = {};

  for (const key of params.updatedFieldKeys) {
    if (key === 'tenant') continue;
    if (key === 'updated_at') continue;
    if (key === 'created_at') continue;

    const previousValue = params.before[key];
    const newValue = params.after[key];

    if (areValuesEqual(previousValue, newValue)) continue;

    const path = snakeToCamel(key);
    updatedFields.push(path);
    changes[path] = {
      previous: normalizeChangeValue(previousValue),
      new: normalizeChangeValue(newValue),
    };
  }

  return {
    projectId: params.projectId,
    ...(params.updatedAt ? { updatedAt: normalizeChangeValue(params.updatedAt) } : {}),
    ...(updatedFields.length ? { updatedFields } : {}),
    ...(Object.keys(changes).length ? { changes } : {}),
  };
}

export function buildProjectStatusChangedPayload(params: {
  projectId: string;
  previousStatus: string;
  newStatus: string;
  changedAt?: Date | string;
}): Record<string, unknown> {
  return {
    projectId: params.projectId,
    previousStatus: params.previousStatus,
    newStatus: params.newStatus,
    ...(params.changedAt ? { changedAt: normalizeChangeValue(params.changedAt) } : {}),
  };
}
