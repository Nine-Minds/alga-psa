import type { IProjectTask } from '@alga-psa/types';

type ProjectTaskWebhookChange = {
  previous: unknown;
  new: unknown;
};

function normalizeWebhookChangeValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

function valuesEqualForWebhookChange(previous: unknown, next: unknown): boolean {
  return normalizeWebhookChangeValue(previous) === normalizeWebhookChangeValue(next);
}

export function buildProjectTaskWebhookChanges(
  before: IProjectTask,
  after: IProjectTask,
  changedFields: readonly string[]
): Record<string, ProjectTaskWebhookChange> {
  const changes: Record<string, ProjectTaskWebhookChange> = {};
  const beforeRecord = before as unknown as Record<string, unknown>;
  const afterRecord = after as unknown as Record<string, unknown>;

  for (const field of changedFields) {
    const previousValue = normalizeWebhookChangeValue(beforeRecord[field]);
    const newValue = normalizeWebhookChangeValue(afterRecord[field]);

    if (!valuesEqualForWebhookChange(previousValue, newValue)) {
      changes[field] = {
        previous: previousValue,
        new: newValue,
      };
    }
  }

  return changes;
}
