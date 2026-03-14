import {
  getWorkflowDesignerCatalogRecordForAction,
  type WorkflowDesignerCatalogKind,
  type WorkflowDesignerCatalogRecord,
} from '@alga-psa/workflows/authoring';
import type { NodeStep, Step } from '@alga-psa/workflows/runtime/client';

type GroupedActionSelection = {
  actionId?: string;
  actionVersion?: number;
  groupKey?: string;
  groupLabel?: string;
  tileKind?: WorkflowDesignerCatalogKind;
};

type GroupedActionConfig = {
  actionId?: string;
  version?: number;
  saveAs?: string;
  designerGroupKey?: string;
  designerTileKind?: WorkflowDesignerCatalogKind;
  designerAppKey?: string;
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

export const buildGroupedActionStepConfig = (
  selection: GroupedActionSelection,
  options?: { generateSaveAsName?: (actionId: string) => string }
): GroupedActionConfig => {
  const config: GroupedActionConfig = {};

  if (selection.groupKey) {
    config.designerGroupKey = selection.groupKey;
  }

  if (selection.tileKind) {
    config.designerTileKind = selection.tileKind;
    if (selection.tileKind === 'app' && selection.groupKey) {
      config.designerAppKey = selection.groupKey;
    }
  }

  if (selection.actionId) {
    config.actionId = selection.actionId;
    config.version = selection.actionVersion ?? 1;
    const saveAs = options?.generateSaveAsName?.(selection.actionId);
    if (saveAs) {
      config.saveAs = saveAs;
    }
  }

  return config;
};

export const applyGroupedActionSelectionToStep = (
  step: NodeStep,
  selection: GroupedActionSelection,
  options?: { generateSaveAsName?: (actionId: string) => string }
): NodeStep => {
  const nextConfig = {
    ...(asRecord(step.config) ?? {}),
    ...buildGroupedActionStepConfig(selection, options),
  };

  return {
    ...step,
    name: selection.groupLabel ?? step.name,
    config: Object.keys(nextConfig).length > 0 ? nextConfig : undefined,
  };
};

export const getGroupedActionCatalogRecordForStep = (
  step: Pick<Step, 'type'> & { config?: unknown },
  catalog: WorkflowDesignerCatalogRecord[]
): WorkflowDesignerCatalogRecord | undefined => {
  if (step.type !== 'action.call') return undefined;

  const config = asRecord(step.config);
  const storedAppKey = typeof config?.designerAppKey === 'string' ? config.designerAppKey : undefined;
  const storedGroupKey = typeof config?.designerGroupKey === 'string' ? config.designerGroupKey : undefined;
  const storedCatalogKey = storedAppKey ?? storedGroupKey;

  if (storedCatalogKey) {
    const storedRecord = catalog.find((record) => record.groupKey === storedCatalogKey);
    if (storedRecord) return storedRecord;
  }

  const actionId = typeof config?.actionId === 'string' ? config.actionId : undefined;
  return getWorkflowDesignerCatalogRecordForAction(catalog, actionId);
};
