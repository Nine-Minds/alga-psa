import type { WorkflowEventCatalogOptionV2 } from '@alga-psa/workflows/actions';

export const WORKFLOW_TRIGGER_EVENT_CATEGORY_KEY_OTHER = '__other__';
export const WORKFLOW_TRIGGER_EVENT_CATEGORY_KEY_UNKNOWN = '__unknown__';

export const getWorkflowTriggerEventCategoryKey = (category?: string | null): string => {
  if (typeof category !== 'string') return WORKFLOW_TRIGGER_EVENT_CATEGORY_KEY_OTHER;
  const trimmed = category.trim();
  return trimmed.length > 0 ? trimmed : WORKFLOW_TRIGGER_EVENT_CATEGORY_KEY_OTHER;
};

export const getWorkflowTriggerEventCategoryLabel = (categoryKey: string): string => {
  if (categoryKey === WORKFLOW_TRIGGER_EVENT_CATEGORY_KEY_OTHER) return 'Other';
  if (categoryKey === WORKFLOW_TRIGGER_EVENT_CATEGORY_KEY_UNKNOWN) return 'Unknown event';
  return categoryKey;
};

export const buildWorkflowTriggerEventCategoryOptions = (
  entries: WorkflowEventCatalogOptionV2[],
  selectedEventName?: string
): Array<{ value: string; label: string }> => {
  const categoryMap = new Map<string, { value: string; label: string }>();
  entries.forEach((entry) => {
    const value = getWorkflowTriggerEventCategoryKey(entry.category);
    if (!categoryMap.has(value)) {
      categoryMap.set(value, {
        value,
        label: getWorkflowTriggerEventCategoryLabel(value),
      });
    }
  });

  if (selectedEventName && !entries.some((entry) => entry.event_type === selectedEventName)) {
    categoryMap.set(WORKFLOW_TRIGGER_EVENT_CATEGORY_KEY_UNKNOWN, {
      value: WORKFLOW_TRIGGER_EVENT_CATEGORY_KEY_UNKNOWN,
      label: getWorkflowTriggerEventCategoryLabel(WORKFLOW_TRIGGER_EVENT_CATEGORY_KEY_UNKNOWN),
    });
  }

  return Array.from(categoryMap.values()).sort((left, right) => left.label.localeCompare(right.label));
};

export const buildWorkflowTriggerEventOptions = (
  entries: WorkflowEventCatalogOptionV2[],
  selectedCategory: string,
  selectedEventName?: string
): Array<{ value: string; label: string }> => {
  const options = entries
    .filter((entry) => getWorkflowTriggerEventCategoryKey(entry.category) === selectedCategory)
    .map((entry) => ({
      value: entry.event_type,
      label: `${entry.name} (${entry.event_type})`
    }));

  if (
    selectedEventName &&
    selectedCategory === WORKFLOW_TRIGGER_EVENT_CATEGORY_KEY_UNKNOWN &&
    !entries.some((entry) => entry.event_type === selectedEventName)
  ) {
    options.unshift({ value: selectedEventName, label: `Unknown event (${selectedEventName})` });
  }

  return options;
};
