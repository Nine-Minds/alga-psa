'use client';

import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  WORKFLOW_AI_SCHEMA_TYPE_LABEL_DEFAULTS,
  WORKFLOW_AI_SCHEMA_TYPE_VALUES,
  WORKFLOW_CANVAS_VIEW_LABEL_DEFAULTS,
  WORKFLOW_CANVAS_VIEW_VALUES,
  WORKFLOW_EVENT_STATUS_LABEL_DEFAULTS,
  WORKFLOW_EVENT_STATUS_VALUES,
  WORKFLOW_INPUT_SOURCE_MODE_LABEL_DEFAULTS,
  WORKFLOW_INPUT_SOURCE_MODE_VALUES,
  WORKFLOW_LOG_LEVEL_LABEL_DEFAULTS,
  WORKFLOW_LOG_LEVEL_VALUES,
  WORKFLOW_ON_ERROR_LABEL_DEFAULTS,
  WORKFLOW_ON_ERROR_VALUES,
  WORKFLOW_REFERENCE_SECTION_LABEL_DEFAULTS,
  WORKFLOW_REFERENCE_SECTION_VALUES,
  WORKFLOW_RUN_SORT_LABEL_DEFAULTS,
  WORKFLOW_RUN_SORT_VALUES,
  WORKFLOW_RUN_STATUS_LABEL_DEFAULTS,
  WORKFLOW_RUN_STATUS_VALUES,
  WORKFLOW_STEP_STATUS_LABEL_DEFAULTS,
  WORKFLOW_STEP_STATUS_VALUES,
  WORKFLOW_TRIGGER_MODE_LABEL_DEFAULTS,
  WORKFLOW_TRIGGER_MODE_VALUES,
  WORKFLOW_WAIT_MODE_LABEL_DEFAULTS,
  WORKFLOW_WAIT_MODE_VALUES,
  WORKFLOW_WAIT_TIMING_LABEL_DEFAULTS,
  WORKFLOW_WAIT_TIMING_VALUES,
  type WorkflowAiSchemaType,
  type WorkflowCanvasView,
  type WorkflowEventStatus,
  type WorkflowInputSourceMode,
  type WorkflowLogLevel,
  type WorkflowOnError,
  type WorkflowReferenceSection,
  type WorkflowRunSort,
  type WorkflowRunStatus,
  type WorkflowStepStatus,
  type WorkflowTriggerMode,
  type WorkflowWaitMode,
  type WorkflowWaitTiming,
} from '../constants/workflowEnums';

const WORKFLOW_NAMESPACE = 'msp/workflows';

export interface LocalizedOption<V extends string> {
  value: V;
  label: string;
}

function useEnumOptions<V extends string>(
  keyRoot: string,
  values: readonly V[],
  labelDefaults: Record<V, string>,
): LocalizedOption<V>[] {
  const { t } = useTranslation(WORKFLOW_NAMESPACE);

  return values.map((value) => ({
    value,
    label: t(`${keyRoot}.${value}`, {
      defaultValue: labelDefaults[value],
    }),
  }));
}

function useEnumFormatter<V extends string>(
  keyRoot: string,
  labelDefaults: Record<V, string>,
): (value: string) => string {
  const { t } = useTranslation(WORKFLOW_NAMESPACE);

  return (value: string) => {
    const fallback = labelDefaults[value as V] ?? value;
    return t(`${keyRoot}.${value}`, { defaultValue: fallback });
  };
}

export function useWorkflowRunStatusOptions(): LocalizedOption<WorkflowRunStatus>[] {
  return useEnumOptions(
    'enums.workflowRunStatus',
    WORKFLOW_RUN_STATUS_VALUES,
    WORKFLOW_RUN_STATUS_LABEL_DEFAULTS,
  );
}

export function useFormatWorkflowRunStatus(): (value: string) => string {
  return useEnumFormatter('enums.workflowRunStatus', WORKFLOW_RUN_STATUS_LABEL_DEFAULTS);
}

export function useWorkflowRunSortOptions(): LocalizedOption<WorkflowRunSort>[] {
  return useEnumOptions(
    'enums.workflowRunSort',
    WORKFLOW_RUN_SORT_VALUES,
    WORKFLOW_RUN_SORT_LABEL_DEFAULTS,
  );
}

export function useFormatWorkflowRunSort(): (value: string) => string {
  return useEnumFormatter('enums.workflowRunSort', WORKFLOW_RUN_SORT_LABEL_DEFAULTS);
}

export function useWorkflowEventStatusOptions(): LocalizedOption<WorkflowEventStatus>[] {
  return useEnumOptions(
    'enums.workflowEventStatus',
    WORKFLOW_EVENT_STATUS_VALUES,
    WORKFLOW_EVENT_STATUS_LABEL_DEFAULTS,
  );
}

export function useFormatWorkflowEventStatus(): (value: string) => string {
  return useEnumFormatter('enums.workflowEventStatus', WORKFLOW_EVENT_STATUS_LABEL_DEFAULTS);
}

export function useWorkflowStepStatusOptions(): LocalizedOption<WorkflowStepStatus>[] {
  return useEnumOptions(
    'enums.workflowStepStatus',
    WORKFLOW_STEP_STATUS_VALUES,
    WORKFLOW_STEP_STATUS_LABEL_DEFAULTS,
  );
}

export function useFormatWorkflowStepStatus(): (value: string) => string {
  return useEnumFormatter('enums.workflowStepStatus', WORKFLOW_STEP_STATUS_LABEL_DEFAULTS);
}

export function useWorkflowLogLevelOptions(): LocalizedOption<WorkflowLogLevel>[] {
  return useEnumOptions(
    'enums.workflowLogLevel',
    WORKFLOW_LOG_LEVEL_VALUES,
    WORKFLOW_LOG_LEVEL_LABEL_DEFAULTS,
  );
}

export function useFormatWorkflowLogLevel(): (value: string) => string {
  return useEnumFormatter('enums.workflowLogLevel', WORKFLOW_LOG_LEVEL_LABEL_DEFAULTS);
}

export function useWorkflowAiSchemaTypeOptions(): LocalizedOption<WorkflowAiSchemaType>[] {
  return useEnumOptions(
    'enums.workflowAiSchemaType',
    WORKFLOW_AI_SCHEMA_TYPE_VALUES,
    WORKFLOW_AI_SCHEMA_TYPE_LABEL_DEFAULTS,
  );
}

export function useFormatWorkflowAiSchemaType(): (value: string) => string {
  return useEnumFormatter('enums.workflowAiSchemaType', WORKFLOW_AI_SCHEMA_TYPE_LABEL_DEFAULTS);
}

export function useWorkflowInputSourceModeOptions(): LocalizedOption<WorkflowInputSourceMode>[] {
  return useEnumOptions(
    'enums.workflowInputSourceMode',
    WORKFLOW_INPUT_SOURCE_MODE_VALUES,
    WORKFLOW_INPUT_SOURCE_MODE_LABEL_DEFAULTS,
  );
}

export function useFormatWorkflowInputSourceMode(): (value: string) => string {
  return useEnumFormatter(
    'enums.workflowInputSourceMode',
    WORKFLOW_INPUT_SOURCE_MODE_LABEL_DEFAULTS,
  );
}

export function useWorkflowReferenceSectionOptions(): LocalizedOption<WorkflowReferenceSection>[] {
  return useEnumOptions(
    'enums.workflowReferenceSection',
    WORKFLOW_REFERENCE_SECTION_VALUES,
    WORKFLOW_REFERENCE_SECTION_LABEL_DEFAULTS,
  );
}

export function useFormatWorkflowReferenceSection(): (value: string) => string {
  return useEnumFormatter(
    'enums.workflowReferenceSection',
    WORKFLOW_REFERENCE_SECTION_LABEL_DEFAULTS,
  );
}

export function useWorkflowTriggerModeOptions(): LocalizedOption<WorkflowTriggerMode>[] {
  return useEnumOptions(
    'enums.workflowTriggerMode',
    WORKFLOW_TRIGGER_MODE_VALUES,
    WORKFLOW_TRIGGER_MODE_LABEL_DEFAULTS,
  );
}

export function useFormatWorkflowTriggerMode(): (value: string) => string {
  return useEnumFormatter('enums.workflowTriggerMode', WORKFLOW_TRIGGER_MODE_LABEL_DEFAULTS);
}

export function useWorkflowCanvasViewOptions(): LocalizedOption<WorkflowCanvasView>[] {
  return useEnumOptions(
    'enums.workflowCanvasView',
    WORKFLOW_CANVAS_VIEW_VALUES,
    WORKFLOW_CANVAS_VIEW_LABEL_DEFAULTS,
  );
}

export function useFormatWorkflowCanvasView(): (value: string) => string {
  return useEnumFormatter('enums.workflowCanvasView', WORKFLOW_CANVAS_VIEW_LABEL_DEFAULTS);
}

export function useWorkflowOnErrorOptions(): LocalizedOption<WorkflowOnError>[] {
  return useEnumOptions(
    'enums.workflowOnError',
    WORKFLOW_ON_ERROR_VALUES,
    WORKFLOW_ON_ERROR_LABEL_DEFAULTS,
  );
}

export function useFormatWorkflowOnError(): (value: string) => string {
  return useEnumFormatter('enums.workflowOnError', WORKFLOW_ON_ERROR_LABEL_DEFAULTS);
}

export function useWorkflowWaitModeOptions(): LocalizedOption<WorkflowWaitMode>[] {
  return useEnumOptions(
    'enums.workflowWaitMode',
    WORKFLOW_WAIT_MODE_VALUES,
    WORKFLOW_WAIT_MODE_LABEL_DEFAULTS,
  );
}

export function useFormatWorkflowWaitMode(): (value: string) => string {
  return useEnumFormatter('enums.workflowWaitMode', WORKFLOW_WAIT_MODE_LABEL_DEFAULTS);
}

export function useWorkflowWaitTimingOptions(): LocalizedOption<WorkflowWaitTiming>[] {
  return useEnumOptions(
    'enums.workflowWaitTiming',
    WORKFLOW_WAIT_TIMING_VALUES,
    WORKFLOW_WAIT_TIMING_LABEL_DEFAULTS,
  );
}

export function useFormatWorkflowWaitTiming(): (value: string) => string {
  return useEnumFormatter('enums.workflowWaitTiming', WORKFLOW_WAIT_TIMING_LABEL_DEFAULTS);
}
