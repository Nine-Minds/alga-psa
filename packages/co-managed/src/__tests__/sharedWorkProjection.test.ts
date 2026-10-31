import { describe, expect, it } from 'vitest';
import { maskCoManagedSnapshot, CO_MANAGED_TASK_NAME_ALIASES, CO_MANAGED_PROJECT_NAME_ALIASES, CO_MANAGED_TASK_RESOURCE_ALIASES, isCoManagedTaskResourceHidden } from '../sharedWorkProjection';

const row = { taskName: 'Fix', projectName: 'Rollout', revision: 3 };
const spec = { taskName: CO_MANAGED_TASK_NAME_ALIASES, projectName: CO_MANAGED_PROJECT_NAME_ALIASES };

describe('maskCoManagedSnapshot', () => {
  it('returns the row unchanged when nothing is redacted', () => {
    expect(maskCoManagedSnapshot([], row, spec)).toEqual(row);
  });
  it('nulls (does not drop) a hidden field and leaves others intact', () => {
    const masked = maskCoManagedSnapshot(['task_name'], row, spec);
    expect(masked).toEqual({ taskName: null, projectName: 'Rollout', revision: 3 });
    expect(Object.keys(masked)).toEqual(Object.keys(row));
  });
  it('honours alias, nested-prefix and fields. forms', () => {
    expect(maskCoManagedSnapshot(['fields.projects.project_name'], row, spec).projectName).toBeNull();
    expect(maskCoManagedSnapshot(['project_tasks'], row, spec).taskName).toBeNull();
  });
  it('wildcard nulls every spec field but not unspecified ones', () => {
    expect(maskCoManagedSnapshot(['*'], row, spec)).toEqual({ taskName: null, projectName: null, revision: 3 });
  });
  it('does not mutate its input', () => {
    maskCoManagedSnapshot(['*'], row, spec);
    expect(row.taskName).toBe('Fix');
  });
});

describe('isCoManagedTaskResourceHidden', () => {
  it('is true for the whole-resource aliases', () => {
    expect(isCoManagedTaskResourceHidden(['tasks'])).toBe(true);
    expect(isCoManagedTaskResourceHidden(['project_tasks'])).toBe(true);
  });
  it('is false for a single field or no redactions', () => {
    expect(isCoManagedTaskResourceHidden(['task_name'])).toBe(false);
    expect(isCoManagedTaskResourceHidden([])).toBe(false);
  });
  it('is built into the task-name aliases from one definition', () => {
    for (const alias of CO_MANAGED_TASK_RESOURCE_ALIASES) expect(CO_MANAGED_TASK_NAME_ALIASES).toContain(alias);
  });
});
