'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DragDropContext, Draggable, Droppable, DropResult, type DraggableProvided } from '@hello-pangea/dnd';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'react-hot-toast';
import { createPortal } from 'react-dom';
import {
  Plus, ChevronRight, ChevronDown, AlertTriangle, Copy, Info, HelpCircle,
  Check, Play, Trash2,
  // Dense palette icons
  GitBranch, Repeat, Shield, CornerDownRight, ArrowRight, Clock, User, Settings,
  Zap, Database, Link, Workflow, Mail, Send, Inbox, MailOpen,
  FileText, Layers, Box, Cog, Terminal, Globe, Search, GripVertical,
  // Business operations icons
  MessageSquare, Edit, UserPlus, CheckCircle, Paperclip, Building, Users, Bot,
  Bell, Calendar, SquareCheck, StickyNote, ClipboardList, Ticket,
  FolderKanban, Handshake, Contact, Wand2, AppWindow, Hourglass, ShieldAlert,
  CalendarPlus, Timer, BellRing
} from 'lucide-react';
import {
  getStepTypeColor,
  getStepTypeIcon,
  PipelineStart,
  PipelineConnector,
  EmptyPipeline,
  StepCardSummary,
  BranchLabel,
  CollapsibleBlock
} from './pipeline/PipelineComponents';

import { Button } from '@alga-psa/ui/components/Button';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Input } from '@alga-psa/ui/components/Input';
import ViewSwitcher from '@alga-psa/ui/components/ViewSwitcher';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Card } from '@alga-psa/ui/components/Card';
import { Badge } from '@alga-psa/ui/components/Badge';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import CustomTabs from '@alga-psa/ui/components/CustomTabs';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Label } from '@alga-psa/ui/components/Label';
import SearchableSelect from '@alga-psa/ui/components/SearchableSelect';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { DateTimePicker } from '@alga-psa/ui/components/DateTimePicker';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { TFunction } from 'i18next';
import { mapWorkflowServerError } from './workflowServerErrors';
import { analytics } from '@alga-psa/analytics/client';
import WorkflowRunList from './WorkflowRunList';
import WorkflowDeadLetterQueue from './WorkflowDeadLetterQueue';
import WorkflowEventList from './WorkflowEventList';
import WorkflowRunDialog from './WorkflowRunDialog';
import WorkflowGraph from '../workflow-graph/WorkflowGraph';
import WorkflowListV2 from '@alga-psa/workflows/components/automation-hub/WorkflowList';
import EventsCatalogV2 from '@alga-psa/workflows/components/automation-hub/EventsCatalogV2';
import type { WorkflowPickerActions } from '@alga-psa/workflows/components/automation-hub/WorkflowActionInputFixedPicker';
import { getAllContacts, getContactsByClient } from '@alga-psa/clients/actions';
import { getAvailableStatuses, getTicketFieldOptions } from '@alga-psa/integrations/actions';
import { getTicketById, getTicketsForList } from '@alga-psa/tickets/actions';
import WorkflowSchedules from './WorkflowSchedules';
import { MappingPanel, type ActionInputField } from './mapping';
import { ExpressionEditor, type ExpressionEditorHandle, type ExpressionContext, type JsonSchema as ExprJsonSchema } from './expression-editor';
import { getCurrentUser, getCurrentUserPermissions } from '@alga-psa/user-composition/actions';
import {
  useWorkflowCanvasViewOptions,
  useWorkflowOnErrorOptions,
  useWorkflowTriggerModeOptions,
  useWorkflowWaitModeOptions,
  useWorkflowWaitTimingOptions,
} from '@alga-psa/workflows/hooks/useWorkflowEnumOptions';
import { getEventCatalogEntryByEventType } from '@alga-psa/workflows/actions';
import { listEventCatalogOptionsV2Action, type WorkflowEventCatalogOptionV2 } from '@alga-psa/workflows/actions';
import {
  createWorkflowDefinitionAction,
  getWorkflowSchemaAction,
  getWorkflowDefinitionVersionAction,
  listWorkflowDesignerActionCatalogAction,
  listWorkflowSchemaRefsAction,
  listWorkflowSchemasMetaAction,
  listWorkflowDefinitionsAction,
  listWorkflowRegistryActionsAction,
  listWorkflowRegistryNodesAction,
  listWorkflowRunsAction,
  publishWorkflowDefinitionAction,
  updateWorkflowDefinitionDraftAction,
  updateWorkflowDefinitionMetadataAction
} from '@alga-psa/workflows/actions';
import {
  buildWorkflowDesignerActionCatalog,
  type WorkflowDesignerCatalogRecord
} from '@alga-psa/workflows/authoring';
import {
  buildPaletteSearchIndex,
  groupPaletteItemsByCategory,
  matchesPaletteSearchQuery,
} from './paletteSearch';
import { ActionSchemaReference } from './ActionSchemaReference';
import { WorkflowAiSchemaSection } from './WorkflowAiSchemaSection';
import { WorkflowComposeTextSection } from './WorkflowComposeTextSection';
import { buildDataContext } from './workflowDataContext';
import {
  applyGroupedActionSelectionToStep,
  buildGroupedActionStepConfig,
  getGroupedActionCatalogRecordForStep,
} from './groupedActionStep';
import { GroupedActionConfigSection } from './GroupedActionConfigSection';
import { applyCatalogActionChoiceToStep } from './groupedActionSelection';
import { WorkflowDesignerPalette } from './WorkflowDesignerPalette';
import { buildActionInputEditorState } from './actionInputEditorState';
import { PaletteItemWithTooltip } from './PaletteItemWithTooltip';
import { WorkflowStepNameField } from './WorkflowStepNameField';
import { WorkflowStepSaveOutputSection } from './WorkflowStepSaveOutputSection';
import { WorkflowActionInputSection } from './WorkflowActionInputSection';
import { WorkflowActionInputFixedPicker } from './WorkflowActionInputFixedPicker';
import { buildWorkflowReferenceFieldOptions } from './workflowReferenceOptions';
import { shouldRenderWorkflowAiSchemaSection } from './workflowAiStepUtils';
import { applyWorkflowActionPresentationHintsToList } from './workflowActionPresentation';
import {
  buildWorkflowTriggerEventCategoryOptions,
  buildWorkflowTriggerEventOptions,
  getWorkflowTriggerEventCategoryKey,
  WORKFLOW_TRIGGER_EVENT_CATEGORY_KEY_UNKNOWN,
} from './workflowTriggerEventOptions';
import {
  DEFAULT_WORKFLOW_DESIGNER_SIDEBAR_WIDTH,
  MIN_WORKFLOW_DESIGNER_SIDEBAR_WIDTH,
  getWorkflowDesignerSidebarWidthFromDrag,
} from './workflowDesignerSidebarSizing';

import type {
  WorkflowDefinition,
  WorkflowTrigger,
  Step,
  NodeStep,
  IfBlock,
  ForEachBlock,
  TryCatchBlock,
  CallWorkflowBlock,
  ReturnStep,
  Expr,
  PublishError,
  InputMapping
} from '@alga-psa/workflows/runtime/client';
import { WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF } from '@alga-psa/workflows/authoring';
import { EMPTY_WORKFLOW_PAYLOAD_SCHEMA_REF } from '@alga-psa/shared/workflow/runtime/schemas/emptyWorkflowPayloadSchema';
import {
  isWorkflowAiInferAction,
  isWorkflowComposeTextAction,
  resolveComposeTextOutputSchemaFromConfig,
  resolveWorkflowAiSchemaFromConfig,
} from '@alga-psa/workflows/authoring';
import { validateExpressionSource } from '@alga-psa/workflows/authoring';
import { partitionStepExpressionValidations, validateStepExpressions } from './expressionValidation';
import {
  composeTimeWaitDurationMs,
  decomposeTimeWaitDurationMs,
  formatTimeWaitDurationPart,
  parseTimeWaitDurationPart,
} from './timeWaitDuration';
import { useRouter, useSearchParams } from 'next/navigation';

type WorkflowDefinitionRecord = {
  workflow_id: string;
  name: string;
  description?: string | null;
  payload_schema_ref: string;
  payload_schema_mode?: 'inferred' | 'pinned' | string | null;
  pinned_payload_schema_ref?: string | null;
  payload_schema_provenance?: string | null;
  trigger?: Record<string, unknown> | null;
  draft_definition: WorkflowDefinition;
  draft_version: number;
  status: string;
  validation_status?: string | null;
  validation_errors?: PublishError[] | null;
  validation_warnings?: PublishError[] | null;
  validated_at?: string | null;
  is_system?: boolean;
  is_visible?: boolean;
  is_paused?: boolean;
  concurrency_limit?: number | null;
  auto_pause_on_failure?: boolean;
  failure_rate_threshold?: number | string | null;
  failure_rate_min_runs?: number | null;
  retention_policy_override?: Record<string, unknown> | null;
  published_version?: number | null;
  schedule_state?: {
    status?: 'scheduled' | 'paused' | 'disabled' | 'completed' | 'failed' | null;
    enabled?: boolean;
    trigger_type?: 'schedule' | 'recurring' | null;
    run_at?: string | null;
    cron?: string | null;
    timezone?: string | null;
    last_fire_at?: string | null;
    next_fire_at?: string | null;
    last_run_status?: string | null;
    last_error?: string | null;
  } | null;
};

type NodeRegistryItem = {
  id: string;
  ui?: {
    label?: string;
    description?: string;
    category?: string;
    icon?: string;
  };
  configSchema: JsonSchema;
  examples?: Record<string, unknown> | null;
  defaultRetry?: Record<string, unknown> | null;
};

type ActionRegistryItem = {
  id: string;
  version: number;
  ui?: {
    label?: string;
    description?: string;
    category?: string;
    icon?: string;
  };
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
};

type ActionInputMappingStatus = {
  requiredCount: number;
  mappedRequiredCount: number;
  unmappedRequiredCount: number;
};

type JsonSchema = {
  type?: string | string[];
  title?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: Array<string | number | boolean | null>;
  items?: JsonSchema;
  additionalProperties?: boolean | JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  default?: unknown;
  format?: string;
  examples?: unknown[];
  $ref?: string;
  definitions?: Record<string, JsonSchema>;
  'x-workflow-picker-kind'?: string;
  'x-workflow-picker-dependencies'?: string[];
  'x-workflow-picker-fixed-value-hint'?: string;
  'x-workflow-picker-allow-dynamic-reference'?: boolean;
  'x-workflow-editor'?: import('@alga-psa/shared/workflow/runtime').WorkflowEditorJsonSchemaMetadata;
};

type WorkflowPlaywrightOverrides = {
  failPermissions?: boolean;
  failRegistries?: boolean;
  failSaveDraft?: boolean;
  failSaveSettings?: boolean;
  failPublish?: boolean;
  saveDraftDelayMs?: number;
  saveSettingsDelayMs?: number;
  publishDelayMs?: number;
  registryNodes?: NodeRegistryItem[];
  registryActions?: ActionRegistryItem[];
};

type TriggerTypeSelection = 'manual' | 'event';

const getWorkflowPlaywrightOverrides = (): WorkflowPlaywrightOverrides | null => {
  if (typeof window === 'undefined') return null;
  return (window as typeof window & { __ALGA_PLAYWRIGHT_WORKFLOW__?: WorkflowPlaywrightOverrides })
    .__ALGA_PLAYWRIGHT_WORKFLOW__ ?? null;
};

const delayIfNeeded = async (delayMs?: number) => {
  if (delayMs && delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
};

const stableSerialize = (value: unknown): string =>
  JSON.stringify(value, (_key, currentValue) => {
    if (!currentValue || typeof currentValue !== 'object' || Array.isArray(currentValue)) {
      return currentValue;
    }
    const sortedEntries = Object.entries(currentValue as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(sortedEntries);
  });

const areStructurallyEqual = (left: unknown, right: unknown): boolean => stableSerialize(left) === stableSerialize(right);

const DESIGNER_FLOAT_EDGE_GUTTER = 8;
const DESIGNER_FLOAT_PANEL_OFFSET = 16;
const DESIGNER_FLOAT_MIN_HEIGHT = 160;
const DESIGNER_PALETTE_WIDTH = 280;
const DESIGNER_PALETTE_COLLAPSED_WIDTH = 32;
// Toggle chevron pokes ~16px beyond the palette's right edge (right: -12px + half button width)
const DESIGNER_PALETTE_TOGGLE_OVERHANG = 16;
const DESIGNER_CENTER_LEFT_EXTRA_PADDING = 16;
const DESIGNER_CENTER_RIGHT_EXTRA_PADDING = 24;
const DESIGNER_CENTER_MIN_WIDTH = 640;
const DESIGNER_CENTER_MAX_WIDTH = 896;

type PipeSegment = {
  index: number;
  branch: 'then' | 'else' | 'try' | 'catch' | 'body';
};

type PipeLocation = {
  pipePath: string;
  label: string;
};

const workflowPickerActions: WorkflowPickerActions = {
  getAllContacts,
  getContactsByClient,
  getAvailableStatuses,
  getTicketFieldOptions,
  getTicketById,
  getTicketsForList: async ({ boardFilterState, searchQuery }) => {
    const result = await getTicketsForList({ boardFilterState, searchQuery });
    return {
      tickets: (result?.tickets ?? [])
        .filter((ticket): ticket is typeof ticket & { ticket_id: string } => Boolean(ticket.ticket_id))
        .map((ticket) => ({
          ticket_id: ticket.ticket_id,
          ticket_number: ticket.ticket_number,
          title: ticket.title,
          status_name: ticket.status_name,
        })),
    };
  },
};

const CONTROL_BLOCKS: Array<{ id: Step['type']; label: string; category: string; description: string }> = [
  { id: 'control.if', label: 'If', category: 'Control', description: 'Conditional branching' },
  { id: 'control.forEach', label: 'For Each', category: 'Control', description: 'Iterate over items' },
  { id: 'control.tryCatch', label: 'Try/Catch', category: 'Control', description: 'Handle errors' },
  { id: 'control.callWorkflow', label: 'Call Workflow', category: 'Control', description: 'Invoke another workflow' },
  { id: 'control.return', label: 'Return', category: 'Control', description: 'Stop execution' }
];

const LEGACY_WORKFLOW_NODE_IDS = new Set<string>([
  'email.parseBody',
  'email.renderCommentBlocks'
]);

const isTimeTrigger = (trigger?: WorkflowTrigger | null): boolean =>
  trigger?.type === 'schedule' || trigger?.type === 'recurring';

const normalizeDesignerDefinition = (definition: WorkflowDefinition): WorkflowDefinition =>
  isTimeTrigger(definition.trigger)
    ? { ...definition, trigger: undefined }
    : definition;

type WorkflowDesignerMode = 'control-panel' | 'editor-list' | 'editor-designer';

type WorkflowDesignerProps = {
  mode?: WorkflowDesignerMode;
  workflowId?: string | null;
  isNew?: boolean;
};

type ControlPanelTab = 'schedules' | 'runs' | 'events' | 'event-catalog' | 'dead-letter';

const mapSectionToControlPanelTab = (section: string | null, canAdmin: boolean): ControlPanelTab => {
  const raw = (section ?? '').trim().toLowerCase();
  if (raw === 'schedules') return 'schedules';
  if (raw === 'events') return 'events';
  if (raw === 'event-catalog' || raw === 'events-catalog' || raw === 'event_catalog') return 'event-catalog';
  if ((raw === 'dead-letter' || raw === 'deadletter' || raw === 'dead_letter') && canAdmin) return 'dead-letter';
  return 'runs';
};

const mapControlPanelTabToSection = (tab: string): string => {
  if (tab === 'schedules') return 'schedules';
  if (tab === 'events') return 'events';
  if (tab === 'event-catalog') return 'event-catalog';
  if (tab === 'dead-letter') return 'dead-letter';
  return 'runs';
};

const createDefaultDefinition = (): WorkflowDefinition => ({
  id: uuidv4(),
  version: 1,
  name: 'New Workflow',
  description: '',
  payloadSchemaRef: EMPTY_WORKFLOW_PAYLOAD_SCHEMA_REF,
  steps: []
});

const isExprSchema = (schema: JsonSchema | undefined, root?: JsonSchema): boolean => {
  const resolved = schema ? resolveSchema(schema, root) : undefined;
  if (!resolved || resolved.type !== 'object' || !resolved.properties) return false;
  return Boolean(resolved.properties.$expr);
};

const mergeSchemaMetadata = (wrapper: JsonSchema, resolved: JsonSchema): JsonSchema => ({
  ...wrapper,
  ...resolved,
  title: resolved.title ?? wrapper.title,
  description: resolved.description ?? wrapper.description,
  examples: resolved.examples ?? wrapper.examples,
  default: resolved.default ?? wrapper.default,
  'x-workflow-picker-kind': (resolved as any)['x-workflow-picker-kind'] ?? (wrapper as any)['x-workflow-picker-kind'],
  'x-workflow-picker-dependencies': (resolved as any)['x-workflow-picker-dependencies'] ?? (wrapper as any)['x-workflow-picker-dependencies'],
  'x-workflow-picker-fixed-value-hint': (resolved as any)['x-workflow-picker-fixed-value-hint'] ?? (wrapper as any)['x-workflow-picker-fixed-value-hint'],
  'x-workflow-picker-allow-dynamic-reference': (resolved as any)['x-workflow-picker-allow-dynamic-reference'] ?? (wrapper as any)['x-workflow-picker-allow-dynamic-reference'],
  'x-workflow-editor': (resolved as any)['x-workflow-editor'] ?? (wrapper as any)['x-workflow-editor'],
});

const resolveSchema = (schema: JsonSchema, root?: JsonSchema): JsonSchema => {
  // Handle $ref
  if (schema.$ref && root?.definitions) {
    const refKey = schema.$ref.replace('#/definitions/', '');
    const resolved = root.definitions?.[refKey];
    if (resolved) return resolveSchema(resolved, root);
  }

  // Handle anyOf (used for nullable types) - extract the non-null variant
  if (schema.anyOf?.length) {
    const nonNullVariant = schema.anyOf.find(
      (variant) => variant.type !== 'null' && !(Array.isArray(variant.type) && variant.type.length === 1 && variant.type[0] === 'null')
    );
    if (nonNullVariant) {
      // Merge nullable info back into resolved schema
      const resolved = resolveSchema(nonNullVariant, root);
      const merged = mergeSchemaMetadata(schema, resolved);
      return {
        ...merged,
        // Mark as nullable if there was a null variant
        type: Array.isArray(resolved.type) ? resolved.type : resolved.type ? [resolved.type, 'null'] : ['null']
      };
    }
  }

  return schema;
};

const normalizeSchemaType = (schema?: JsonSchema): string | undefined => {
  if (!schema?.type) return undefined;
  if (Array.isArray(schema.type)) {
    return schema.type.find((t) => t !== 'null') ?? schema.type[0];
  }
  return schema.type;
};

// Types for data context tracking (§16 Schema Exposure)
type SchemaField = {
  name: string;
  type: string;
  required: boolean;
  nullable: boolean;
  description?: string;
  defaultValue?: unknown;
  children?: SchemaField[];
  // §16.4 - Additional constraints for tooltips
  constraints?: {
    enum?: unknown[];
    minimum?: number;
    maximum?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    format?: string;
    examples?: unknown[];
  };
};

type StepOutputContext = {
  stepId: string;
  stepName: string;
  saveAs: string;
  outputSchema: JsonSchema;
  fields: SchemaField[];
};

type DataContext = {
  payload: SchemaField[];
  payloadSchema: JsonSchema | null;
  steps: StepOutputContext[];
  globals: {
    env: SchemaField[];
    secrets: SchemaField[];
    meta: SchemaField[];
    error: SchemaField[];
  };
  // §17.3.1 - forEach loop context (available when editing steps inside forEach)
  forEach?: {
    itemVar: string;
    indexVar: string;
    itemType?: string;
  };
  // §17.3.1 - Indicates if we're inside a catch block (error context is available)
  inCatchBlock?: boolean;
};

// Extract fields from a JSON Schema for display
const extractSchemaFields = (schema: JsonSchema, root?: JsonSchema, isRequired = false): SchemaField[] => {
  const resolved = schema ? resolveSchema(schema, root) : schema;
  if (!resolved?.properties) return [];

  const requiredFields = resolved.required ?? [];
  return Object.entries(resolved.properties).map(([name, propSchema]) => {
    const resolvedProp = resolveSchema(propSchema, root);
    const type = normalizeSchemaType(resolvedProp);
    const isNullable = Array.isArray(resolvedProp.type) && resolvedProp.type.includes('null');
    const isFieldRequired = requiredFields.includes(name);

    let children: SchemaField[] | undefined;
    if (type === 'object' && resolvedProp.properties) {
      children = extractSchemaFields(resolvedProp, root, isFieldRequired);
    } else if (type === 'array' && resolvedProp.items) {
      const itemSchema = resolveSchema(resolvedProp.items, root);
      if (itemSchema.properties) {
        children = extractSchemaFields(itemSchema, root);
      }
    }

    // §16.4 - Extract constraints for tooltips
    // Cast to access additional JSON Schema properties not in the base type
    const prop = resolvedProp as JsonSchema & {
      minimum?: number;
      maximum?: number;
      minLength?: number;
      maxLength?: number;
      pattern?: string;
      format?: string;
      examples?: unknown[];
    };
    const constraints: SchemaField['constraints'] = {};
    if (prop.enum) constraints.enum = prop.enum;
    if (prop.minimum !== undefined) constraints.minimum = prop.minimum;
    if (prop.maximum !== undefined) constraints.maximum = prop.maximum;
    if (prop.minLength !== undefined) constraints.minLength = prop.minLength;
    if (prop.maxLength !== undefined) constraints.maxLength = prop.maxLength;
    if (prop.pattern) constraints.pattern = prop.pattern;
    if (prop.format) constraints.format = prop.format;
    if (prop.examples) constraints.examples = prop.examples;

    return {
      name,
      type: type ?? 'unknown',
      required: isFieldRequired,
      nullable: isNullable,
      description: resolvedProp.description,
      defaultValue: resolvedProp.default,
      children,
      constraints: Object.keys(constraints).length > 0 ? constraints : undefined
    };
  });
};

// Format a schema type for display
const formatSchemaType = (schema: JsonSchema, root?: JsonSchema): string => {
  const resolved = schema ? resolveSchema(schema, root) : schema;
  if (!resolved) return 'unknown';

  const baseType = normalizeSchemaType(resolved);
  const isNullable = Array.isArray(resolved.type) && resolved.type.includes('null');

  if (baseType === 'array' && resolved.items) {
    const itemType = formatSchemaType(resolved.items, root);
    return `${itemType}[]${isNullable ? ' | null' : ''}`;
  }

  if (resolved.enum) {
    const enumStr = resolved.enum.slice(0, 3).map(v => JSON.stringify(v)).join(' | ');
    return resolved.enum.length > 3 ? `${enumStr} | ...` : enumStr;
  }

  return `${baseType ?? 'unknown'}${isNullable ? ' | null' : ''}`;
};

// §17 - Extract action input fields from a JSON Schema for InputMappingEditor
const extractActionInputFields = (schema: JsonSchema | undefined, root?: JsonSchema): ActionInputField[] => {
  if (!schema) return [];
  const resolved = resolveSchema(schema, root);
  if (!resolved?.properties) return [];

  const requiredFields = resolved.required ?? [];
  return Object.entries(resolved.properties).map(([name, propSchema]) => {
    const resolvedProp = resolveSchema(propSchema, root);
    const type = normalizeSchemaType(resolvedProp) ?? 'string';
    const isFieldRequired = requiredFields.includes(name);
    const rawResolved = resolvedProp as {
      format?: string;
      minItems?: number;
      maxItems?: number;
      minLength?: number;
      maxLength?: number;
      minimum?: number;
      maximum?: number;
      pattern?: string;
      items?: JsonSchema;
    };

    let children: ActionInputField[] | undefined;
    let itemType: string | undefined;
    if (type === 'object' && resolvedProp.properties) {
      children = extractActionInputFields(resolvedProp, root);
    } else if (type === 'array' && resolvedProp.items) {
      const itemSchema = resolveSchema(resolvedProp.items, root);
      itemType = normalizeSchemaType(itemSchema) ?? undefined;
      if (itemSchema.properties) {
        children = extractActionInputFields(itemSchema, root);
      }
    }

    const constraints = {
      format: rawResolved.format,
      minItems: rawResolved.minItems,
      maxItems: rawResolved.maxItems,
      minLength: rawResolved.minLength,
      maxLength: rawResolved.maxLength,
      minimum: rawResolved.minimum,
      maximum: rawResolved.maximum,
      pattern: rawResolved.pattern,
      itemType
    };
    const hasConstraints = Object.values(constraints).some((constraint) => constraint !== undefined);

    return {
      name,
      type,
      description: resolvedProp.description,
      required: isFieldRequired,
      enum: resolvedProp.enum,
      default: resolvedProp.default,
      constraints: hasConstraints ? constraints : undefined,
      children
    };
  });
};

const buildActionInputMappingStatusByStepId = (
  steps: Step[],
  actionRegistry: ActionRegistryItem[]
): Map<string, ActionInputMappingStatus> => {
  const statusByStepId = new Map<string, ActionInputMappingStatus>();

  const visit = (pipeSteps: Step[]) => {
    pipeSteps.forEach((step) => {
      if (step.type === 'action.call') {
        const inputEditorState = buildActionInputEditorState(step, actionRegistry);
        if (inputEditorState.requiredActionInputFields.length > 0) {
          statusByStepId.set(step.id, {
            requiredCount: inputEditorState.requiredActionInputFields.length,
            mappedRequiredCount: inputEditorState.mappedRequiredInputFieldCount,
            unmappedRequiredCount: inputEditorState.unmappedRequiredInputFieldCount
          });
        }
      }

      if (step.type === 'control.if') {
        const ifStep = step as IfBlock;
        visit(ifStep.then ?? []);
        visit(ifStep.else ?? []);
      } else if (step.type === 'control.tryCatch') {
        const tryCatchStep = step as TryCatchBlock;
        visit(tryCatchStep.try ?? []);
        visit(tryCatchStep.catch ?? []);
      } else if (step.type === 'control.forEach') {
        const forEachStep = step as ForEachBlock;
        visit(forEachStep.body ?? []);
      }
    });
  };

  visit(steps);
  return statusByStepId;
};

const buildDefaultValueFromSchema = (schema: JsonSchema, root: JsonSchema): unknown => {
  const resolved = resolveSchema(schema, root);
  if (resolved.default !== undefined) return resolved.default;
  if (isExprSchema(resolved, root)) return { $expr: '' };

  const type = normalizeSchemaType(resolved);
  if (type === 'string') return '';
  if (type === 'number' || type === 'integer') return 0;
  if (type === 'boolean') return false;
  if (type === 'array') return [];
  if (type === 'object') {
    if (resolved.properties) {
      // Only materialize required fields (and any fields with an explicit default).
      // This prevents generating invalid defaults for optional enum fields (e.g. onError.policy = ""),
      // which can break strict Zod schemas used by node config validation.
      const required = new Set(resolved.required ?? []);
      return Object.keys(resolved.properties).reduce<Record<string, unknown>>((acc, key) => {
        const child = resolved.properties?.[key];
        if (!child) return acc;
        if (!required.has(key) && child.default === undefined) return acc;
        acc[key] = buildDefaultValueFromSchema(child, root);
        return acc;
      }, {});
    }
    if (resolved.additionalProperties && typeof resolved.additionalProperties === 'object') {
      return {};
    }
    return {};
  }

  if (resolved.anyOf?.length) {
    return buildDefaultValueFromSchema(resolved.anyOf[0], root);
  }

  return null;
};

const parsePipePath = (pipePath: string): PipeSegment[] => {
  const segments: PipeSegment[] = [];
  const regex = /steps\[(\d+)\]\.(then|else|try|catch|body)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(pipePath)) !== null) {
    segments.push({ index: Number(match[1]), branch: match[2] as PipeSegment['branch'] });
  }
  return segments;
};

const getStepsAtPath = (steps: Step[], segments: PipeSegment[]): Step[] => {
  if (segments.length === 0) return steps;
  const [current, ...rest] = segments;
  const step = steps[current.index];
  if (!step) return [];
  if (step.type === 'control.if') {
    const ifStep = step as IfBlock;
    const branchSteps = current.branch === 'then' ? ifStep.then : ifStep.else ?? [];
    return getStepsAtPath(branchSteps, rest);
  }
  if (step.type === 'control.tryCatch') {
    const tcStep = step as TryCatchBlock;
    const branchSteps = current.branch === 'try' ? tcStep.try : tcStep.catch;
    return getStepsAtPath(branchSteps, rest);
  }
  if (step.type === 'control.forEach') {
    const feStep = step as ForEachBlock;
    return getStepsAtPath(feStep.body, rest);
  }
  return [];
};

const updateStepsAtPath = (steps: Step[], segments: PipeSegment[], nextSteps: Step[]): Step[] => {
  if (segments.length === 0) return nextSteps;
  const [current, ...rest] = segments;
  return steps.map((step, index) => {
    if (index !== current.index) return step;

    if (step.type === 'control.if') {
      const ifStep = step as IfBlock;
      if (current.branch === 'then') {
        return { ...ifStep, then: updateStepsAtPath(ifStep.then, rest, nextSteps) };
      }
      return { ...ifStep, else: updateStepsAtPath(ifStep.else ?? [], rest, nextSteps) };
    }

    if (step.type === 'control.tryCatch') {
      const tcStep = step as TryCatchBlock;
      if (current.branch === 'try') {
        return { ...tcStep, try: updateStepsAtPath(tcStep.try, rest, nextSteps) };
      }
      return { ...tcStep, catch: updateStepsAtPath(tcStep.catch, rest, nextSteps) };
    }

    if (step.type === 'control.forEach') {
      const feStep = step as ForEachBlock;
      return { ...feStep, body: updateStepsAtPath(feStep.body, rest, nextSteps) };
    }

    return step;
  });
};

const updateStepById = (steps: Step[], stepId: string, updater: (step: Step) => Step): Step[] => {
  return steps.map((step) => {
    if (step.id === stepId) {
      return updater(step);
    }
    if (step.type === 'control.if') {
      const ifStep = step as IfBlock;
      return {
        ...ifStep,
        then: updateStepById(ifStep.then, stepId, updater),
        else: ifStep.else ? updateStepById(ifStep.else, stepId, updater) : ifStep.else
      };
    }
    if (step.type === 'control.tryCatch') {
      const tcStep = step as TryCatchBlock;
      return {
        ...tcStep,
        try: updateStepById(tcStep.try, stepId, updater),
        catch: updateStepById(tcStep.catch, stepId, updater)
      };
    }
    if (step.type === 'control.forEach') {
      const feStep = step as ForEachBlock;
      return {
        ...feStep,
        body: updateStepById(feStep.body, stepId, updater)
      };
    }
    return step;
  });
};

const removeStepById = (steps: Step[], stepId: string): Step[] => {
  const filtered = steps.filter((step) => step.id !== stepId);
  return filtered.map((step) => {
    if (step.type === 'control.if') {
      const ifStep = step as IfBlock;
      return {
        ...ifStep,
        then: removeStepById(ifStep.then, stepId),
        else: ifStep.else ? removeStepById(ifStep.else, stepId) : ifStep.else
      };
    }
    if (step.type === 'control.tryCatch') {
      const tcStep = step as TryCatchBlock;
      return {
        ...tcStep,
        try: removeStepById(tcStep.try, stepId),
        catch: removeStepById(tcStep.catch, stepId)
      };
    }
    if (step.type === 'control.forEach') {
      const feStep = step as ForEachBlock;
      return {
        ...feStep,
        body: removeStepById(feStep.body, stepId)
      };
    }
    return step;
  });
};

const buildStepPathMap = (steps: Step[], prefix = 'root'): Record<string, string> => {
  const map: Record<string, string> = {};

  steps.forEach((step, index) => {
    const path = `${prefix}.steps[${index}]`;
    map[step.id] = path;

    if (step.type === 'control.if') {
      const ifStep = step as IfBlock;
      Object.assign(map, buildStepPathMap(ifStep.then, `${path}.then`));
      if (ifStep.else) {
        Object.assign(map, buildStepPathMap(ifStep.else, `${path}.else`));
      }
    }

    if (step.type === 'control.tryCatch') {
      const tcStep = step as TryCatchBlock;
      Object.assign(map, buildStepPathMap(tcStep.try, `${path}.try`));
      Object.assign(map, buildStepPathMap(tcStep.catch, `${path}.catch`));
    }

    if (step.type === 'control.forEach') {
      const feStep = step as ForEachBlock;
      Object.assign(map, buildStepPathMap(feStep.body, `${path}.body`));
    }
  });

  return map;
};

const buildPathBreadcrumbs = (steps: Step[], targetPath: string): string[] => {
  const crumbs: string[] = [];
  const regex = /steps\[(\d+)\](?:\.(then|else|try|catch|body))?/g;
  let match: RegExpExecArray | null;
  let currentSteps = steps;
  while ((match = regex.exec(targetPath)) !== null) {
    const index = Number(match[1]);
    const step = currentSteps[index];
    const label = (step && 'name' in step ? (step as NodeStep).name : undefined) || step?.type || `Step ${index + 1}`;
    crumbs.push(label);
    const branch = match[2];
    if (branch && step) {
      crumbs.push(branch.toUpperCase());
      if (step.type === 'control.if') {
        const ifStep = step as IfBlock;
        currentSteps = branch === 'then' ? ifStep.then : ifStep.else ?? [];
      } else if (step.type === 'control.tryCatch') {
        const tcStep = step as TryCatchBlock;
        currentSteps = branch === 'try' ? tcStep.try : tcStep.catch;
      } else if (step.type === 'control.forEach') {
        const feStep = step as ForEachBlock;
        currentSteps = feStep.body;
      }
    } else if (step && step.type === 'control.if') {
      const ifStep = step as IfBlock;
      currentSteps = ifStep.then;
    } else if (step && step.type === 'control.tryCatch') {
      const tcStep = step as TryCatchBlock;
      currentSteps = tcStep.try;
    } else if (step && step.type === 'control.forEach') {
      const feStep = step as ForEachBlock;
      currentSteps = feStep.body;
    }
  }
  return crumbs;
};

const collectSchemaPaths = (schema: JsonSchema, root: JsonSchema, prefix = 'payload'): string[] => {
  const resolved = resolveSchema(schema, root);
  const type = normalizeSchemaType(resolved);
  if (type !== 'object' || !resolved.properties) {
    return [prefix];
  }

  const paths: string[] = [prefix];
  Object.entries(resolved.properties).forEach(([key, child]) => {
    const childSchema = resolveSchema(child, root);
    const childType = normalizeSchemaType(childSchema);
    const nextPrefix = `${prefix}.${key}`;
    if (childType === 'object' && childSchema.properties) {
      paths.push(...collectSchemaPaths(childSchema, root, nextPrefix));
    } else if (childType === 'array' && childSchema.items) {
      const arrayPrefix = `${nextPrefix}[]`;
      paths.push(arrayPrefix);
      paths.push(...collectSchemaPaths(childSchema.items, root, arrayPrefix));
    } else {
      paths.push(nextPrefix);
    }
  });

  return paths;
};

const buildFieldOptions = (payloadSchema?: JsonSchema | null): SelectOption[] => {
  const options: SelectOption[] = [
    { value: 'payload', label: 'payload' },
    { value: 'vars', label: 'vars' },
    { value: 'meta', label: 'meta' },
    { value: 'meta.state', label: 'meta.state' },
    { value: 'meta.traceId', label: 'meta.traceId' },
    { value: 'error', label: 'error' },
    { value: 'error.message', label: 'error.message' }
  ];

  if (payloadSchema) {
    collectSchemaPaths(payloadSchema, payloadSchema).forEach((path) => {
      if (!options.some((opt) => opt.value === path)) {
        options.push({ value: path, label: path });
      }
    });
  }

  return options;
};

const getStepLabel = (
  step: Step,
  nodeRegistry: Record<string, NodeRegistryItem>,
  designerActionCatalog?: WorkflowDesignerCatalogRecord[],
  t?: TFunction,
): string => {
  const translate = (key: string, fallback: string): string =>
    t ? t(key, { defaultValue: fallback }) : fallback;

  if (step.type === 'control.if') return translate('designer.palette.controlBlocks.control.if.label', 'If');
  if (step.type === 'control.forEach') return translate('designer.palette.controlBlocks.control.forEach.label', 'For Each');
  if (step.type === 'control.tryCatch') return translate('designer.palette.controlBlocks.control.tryCatch.label', 'Try/Catch');
  if (step.type === 'control.callWorkflow') return translate('designer.palette.controlBlocks.control.callWorkflow.label', 'Call Workflow');
  if (step.type === 'control.return') return translate('designer.palette.controlBlocks.control.return.label', 'Return');

  const registryItem = nodeRegistry[step.type];
  const name = (step as NodeStep).name?.trim();

  // action.call → use the designer catalog's group label (translated via designer.palette.groups.<groupKey>.label)
  const groupedRecord = designerActionCatalog
    ? getGroupedActionCatalogRecordForStep(step, designerActionCatalog)
    : undefined;
  if (groupedRecord) {
    const groupLabelKey = `designer.palette.groups.${groupedRecord.groupKey}.label`;
    const translatedGroupLabel = translate(groupLabelKey, groupedRecord.label);
    // If the user never renamed the step (or named it the default English/translated group label),
    // render the translated group label so the pipeline card stays localized.
    if (!name || name === groupedRecord.label || name === translatedGroupLabel) {
      return translatedGroupLabel;
    }
    return name;
  }

  if (name) return name;

  // Fallback: translate registry node label under designer.palette.nodes.<nodeId>.label
  if (registryItem?.ui?.label) {
    return translate(`designer.palette.nodes.${step.type}.label`, registryItem.ui.label);
  }
  return step.type;
};

const getGraphSubtitle = (step: Step): string | null => {
  const truncate = (value: string, max = 40) => {
    const trimmed = value.trim();
    if (trimmed.length <= max) return trimmed;
    return `${trimmed.slice(0, max)}…`;
  };

  if (step.type === 'action.call') {
    const config = (step as NodeStep).config as { actionId?: string; saveAs?: string } | undefined;
    const actionId = config?.actionId?.trim();
    const saveAs = config?.saveAs?.trim();
    if (actionId && saveAs) return `${actionId} → ${saveAs}`;
    if (actionId) return actionId;
    if (saveAs) return `→ ${saveAs}`;
    return null;
  }

  if (step.type === 'state.set') {
    const config = (step as NodeStep).config as { state?: string } | undefined;
    const state = config?.state?.trim();
    return state ? `→ ${state}` : null;
  }

  if (step.type === 'control.if') {
    const condition = (step as IfBlock).condition?.$expr ?? '';
    return condition ? truncate(condition, 50) : null;
  }

  return null;
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const syntaxHighlightJson = (json: string) => {
  const COLOR_KEY = '#6d28d9'; // violet-700
  const COLOR_STRING = '#047857'; // emerald-700
  const COLOR_NUMBER = '#0369a1'; // sky-700
  const COLOR_BOOL = '#b45309'; // amber-700
  const COLOR_NULL = '#64748b'; // slate-500
  const COLOR_PUNCT = '#94a3b8'; // slate-400

  // Tokenize on the raw JSON (then escape per-token). Use separate alternatives so keys always include `:`.
  const tokenRegex =
    /"(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"\s*:|"(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"|\btrue\b|\bfalse\b|\bnull\b|-?\\d+(?:\\.\\d*)?(?:[eE][+\\-]?\\d+)?/g;

  return json.replace(tokenRegex, (match) => {
    if (match.startsWith('"')) {
      const trimmed = match.trimEnd();
      const isKey = trimmed.endsWith(':');

      if (isKey) {
        const withoutColon = trimmed.slice(0, -1);
        const lastQuote = withoutColon.lastIndexOf('"');
        const innerRaw = lastQuote > 0 ? withoutColon.slice(1, lastQuote) : withoutColon.slice(1);
        const afterQuoteRaw = lastQuote > 0 ? withoutColon.slice(lastQuote + 1) : '';
        return [
          `<span style="color:${COLOR_PUNCT} !important">"</span>`,
          `<span style="color:${COLOR_KEY} !important; font-weight:600">${escapeHtml(innerRaw)}</span>`,
          `<span style="color:${COLOR_PUNCT} !important">"</span>`,
          afterQuoteRaw ? `<span style="color:${COLOR_PUNCT} !important">${escapeHtml(afterQuoteRaw)}</span>` : '',
          `<span style="color:${COLOR_PUNCT} !important">:</span>`,
        ].join('');
      }

      const innerRaw = match.length >= 2 ? match.slice(1, -1) : '';
      return [
        `<span style="color:${COLOR_PUNCT} !important">"</span>`,
        `<span style="color:${COLOR_STRING} !important">${escapeHtml(innerRaw)}</span>`,
        `<span style="color:${COLOR_PUNCT} !important">"</span>`,
      ].join('');
    }

    if (match === 'true' || match === 'false') {
      return `<span style="color:${COLOR_BOOL} !important; font-weight:600">${escapeHtml(match)}</span>`;
    }
    if (match === 'null') {
      return `<span style="color:${COLOR_NULL} !important">${escapeHtml(match)}</span>`;
    }
    return `<span style="color:${COLOR_NUMBER} !important">${escapeHtml(match)}</span>`;
  });
};

/**
 * Build ExpressionContext for the Monaco expression editor from DataContext
 * This converts the workflow designer's DataContext to the format expected by the expression editor
 */
const buildExpressionContext = (
  payloadSchema: JsonSchema | null,
  dataContext: DataContext | null
): ExpressionContext => {
  // Build vars schema from step outputs
  const varsProperties: Record<string, ExprJsonSchema> = {};
  if (dataContext?.steps) {
    for (const stepOutput of dataContext.steps) {
      varsProperties[stepOutput.saveAs] = stepOutput.outputSchema as ExprJsonSchema;
    }
  }

  const varsSchema: ExprJsonSchema | undefined = Object.keys(varsProperties).length > 0
    ? { type: 'object', properties: varsProperties }
    : undefined;

  // Meta schema
  const metaSchema: ExprJsonSchema = {
    type: 'object',
    properties: {
      state: { type: 'string', description: 'Workflow state' },
      traceId: { type: 'string', description: 'Trace ID' },
      tags: { type: 'object', description: 'Workflow tags' },
    },
  };

  // Error schema (only relevant in catch blocks)
  const errorSchema: ExprJsonSchema | undefined = dataContext?.inCatchBlock ? {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Error name' },
      message: { type: 'string', description: 'Error message' },
      stack: { type: 'string', description: 'Stack trace' },
      nodePath: { type: 'string', description: 'Error location in workflow' },
    },
  } : undefined;

  return {
    payloadSchema: payloadSchema as ExprJsonSchema | undefined,
    varsSchema,
    metaSchema,
    errorSchema,
    inCatchBlock: dataContext?.inCatchBlock,
    forEachItemVar: dataContext?.forEach?.itemVar,
    forEachIndexVar: dataContext?.forEach?.indexVar,
  };
};

const ensureExpr = (value: Expr | undefined): Expr => ({ $expr: value?.$expr ?? '' });

const buildFixedTimeWaitUntilExpr = (value: Date): Expr => ({
  $expr: JSON.stringify(value.toISOString())
});

const parseStringLiteralExpression = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === 'string' ? parsed : null;
  } catch {
    // Fall through to single-quoted string support for older/manual expressions.
  }

  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/\\'/g, "'");
  }

  return null;
};

const parseFixedTimeWaitUntilExpr = (value: Expr | undefined): Date | null => {
  const literal = parseStringLiteralExpression(value?.$expr);
  if (!literal) {
    return null;
  }

  const parsedDate = new Date(literal);
  return Number.isFinite(parsedDate.getTime()) ? parsedDate : null;
};

const inferTimeWaitUntilAuthoringMode = (config: Record<string, unknown> | null): 'fixed' | 'expression' => {
  if (!config || config.mode !== 'until') {
    return 'fixed';
  }

  return parseFixedTimeWaitUntilExpr(config.until as Expr | undefined) ? 'fixed' : 'expression';
};

/**
 * Generate a smart default saveAs variable name from an action ID.
 * Converts snake_case or kebab-case to camelCase and adds "Result" suffix.
 * e.g., "lookup_threading_headers" → "threadingHeadersResult"
 *       "create_ticket_from_email" → "ticketFromEmailResult"
 */
const generateSaveAsName = (actionId: string): string => {
  // Normalize namespaces like "tickets.add_comment" → "tickets_add_comment"
  const normalizedId = actionId.replace(/\./g, '_');

  // Remove common prefixes like "get_", "create_", "update_", "delete_", "find_", "lookup_", "resolve_"
  const prefixPattern = /^(get_|create_|update_|delete_|find_|lookup_|resolve_|fetch_|load_|process_|send_|call_)/i;
  let cleaned = normalizedId.replace(prefixPattern, '');

  // If cleaning removed everything, use the original
  if (!cleaned) cleaned = actionId;

  // Convert snake_case or kebab-case to camelCase
  const camelCase = cleaned
    .toLowerCase()
    .replace(/[-_](.)/g, (_, char) => char.toUpperCase());

  // Add "Result" suffix
  return camelCase + 'Result';
};

const cloneWorkflowStepValue = <T,>(value: T): T => {
  if (value === undefined || value === null) {
    return value;
  }

  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
};

const duplicateWorkflowStepWithNewIds = (step: Step): Step => {
  const clonedStep = cloneWorkflowStepValue(step);

  if (clonedStep.type === 'control.if') {
    const ifStep = clonedStep as IfBlock;
    return {
      ...ifStep,
      id: uuidv4(),
      then: ifStep.then.map(duplicateWorkflowStepWithNewIds),
      else: ifStep.else ? ifStep.else.map(duplicateWorkflowStepWithNewIds) : ifStep.else
    } satisfies IfBlock;
  }

  if (clonedStep.type === 'control.tryCatch') {
    const tryCatchStep = clonedStep as TryCatchBlock;
    return {
      ...tryCatchStep,
      id: uuidv4(),
      try: tryCatchStep.try.map(duplicateWorkflowStepWithNewIds),
      catch: tryCatchStep.catch.map(duplicateWorkflowStepWithNewIds)
    } satisfies TryCatchBlock;
  }

  if (clonedStep.type === 'control.forEach') {
    const forEachStep = clonedStep as ForEachBlock;
    return {
      ...forEachStep,
      id: uuidv4(),
      body: forEachStep.body.map(duplicateWorkflowStepWithNewIds)
    } satisfies ForEachBlock;
  }

  return {
    ...clonedStep,
    id: uuidv4()
  } as Step;
};

const createStepFromPalette = (
  type: Step['type'],
  nodeRegistry: Record<string, NodeRegistryItem>
): Step => {
  const id = uuidv4();
  const createReturnStep = (): ReturnStep => ({ id: uuidv4(), type: 'control.return' });

  if (type === 'control.if') {
    return {
      id,
      type: 'control.if',
      condition: { $expr: '' },
      then: [createReturnStep()],
      else: [createReturnStep()]
    } satisfies IfBlock;
  }

  if (type === 'control.forEach') {
    return {
      id,
      type: 'control.forEach',
      items: { $expr: '' },
      itemVar: 'item',
      concurrency: 1,
      body: []
    } satisfies ForEachBlock;
  }

  if (type === 'control.tryCatch') {
    return {
      id,
      type: 'control.tryCatch',
      try: [createReturnStep()],
      catch: [createReturnStep()]
    } satisfies TryCatchBlock;
  }

  if (type === 'control.callWorkflow') {
    return {
      id,
      type: 'control.callWorkflow',
      workflowId: '',
      workflowVersion: 1,
      inputMapping: {},
      outputMapping: {}
    } satisfies CallWorkflowBlock;
  }

  if (type === 'control.return') {
    return { id, type: 'control.return' } satisfies ReturnStep;
  }

  const configSchema = nodeRegistry[type]?.configSchema;
  const baseConfig = configSchema ? buildDefaultValueFromSchema(configSchema, configSchema) : {};

  return {
    id,
    type: type,
    name: '',
    config: baseConfig
  } satisfies NodeStep;
};

const WorkflowDesigner: React.FC<WorkflowDesignerProps> = ({
  mode = 'editor-list',
  workflowId: workflowIdProp = null,
  isNew = false
}) => {
  const { t } = useTranslation('msp/workflows');
  const [activeTab, setActiveTab] = useState('Workflows');
  const [definitions, setDefinitions] = useState<WorkflowDefinitionRecord[]>([]);
  const [activeDefinition, setActiveDefinition] = useState<WorkflowDefinition | null>(null);
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(null);
  const [runStatusByWorkflow, setRunStatusByWorkflow] = useState<Map<string, string>>(new Map());
  const [runCountByWorkflow, setRunCountByWorkflow] = useState<Map<string, number>>(new Map());
  const [nodeRegistry, setNodeRegistry] = useState<NodeRegistryItem[]>([]);
  const [actionRegistry, setActionRegistry] = useState<ActionRegistryItem[]>([]);
  const [designerActionCatalog, setDesignerActionCatalog] = useState<WorkflowDesignerCatalogRecord[]>([]);
  const [payloadSchema, setPayloadSchema] = useState<JsonSchema | null>(null);
  const [payloadSchemaStatus, setPayloadSchemaStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [payloadSchemaLoadedRef, setPayloadSchemaLoadedRef] = useState<string | null>(null);
  const [triggerSourceSchema, setTriggerSourceSchema] = useState<JsonSchema | null>(null);
  const [triggerSourceSchemaStatus, setTriggerSourceSchemaStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [triggerSourceSchemaLoadedRef, setTriggerSourceSchemaLoadedRef] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [isPaletteCollapsed, setIsPaletteCollapsed] = useState(false);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [selectedPipePath, setSelectedPipePath] = useState<string>('root');
  // For insert-between functionality: stores where to insert the next step
  const [pendingInsertPosition, setPendingInsertPosition] = useState<{ pipePath: string; index: number } | null>(null);
  const [publishErrors, setPublishErrors] = useState<PublishError[]>([]);
  const [publishWarnings, setPublishWarnings] = useState<PublishError[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [userPermissions, setUserPermissions] = useState<string[]>([]);
  const [registryError, setRegistryError] = useState(false);
  const [registryStatus, setRegistryStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [schemaRefs, setSchemaRefs] = useState<string[]>([]);
  const [schemaMeta, setSchemaMeta] = useState<Map<string, { title: string | null; description: string | null }>>(
    new Map()
  );
  const [contractSettingsExpanded, setContractSettingsExpanded] = useState(false);
  const [schemaRefAdvanced, setSchemaRefAdvanced] = useState(false);
  const [showDiscardChangesDialog, setShowDiscardChangesDialog] = useState(false);
  const [showRunDialog, setShowRunDialog] = useState(false);
  const [showSchemaModal, setShowSchemaModal] = useState(false);
  const [schemaPreviewExpanded, setSchemaPreviewExpanded] = useState(false);
  const [schemaInferenceEnabled, setSchemaInferenceEnabled] = useState(true);
  const [inferredSchemaRef, setInferredSchemaRef] = useState<string | null>(null);
  const [inferredSchemaStatus, setInferredSchemaStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const lastAppliedInferredRef = useRef<string | null>(null);
  const lastCapturedUnknownSchemaRef = useRef<string | null>(null);
  const [showTriggerMapping, setShowTriggerMapping] = useState(false);
  const [showUseEventSchemaSuggestion, setShowUseEventSchemaSuggestion] = useState(false);
  const [hasExplicitContractEdits, setHasExplicitContractEdits] = useState(false);
  const [pendingEventSchemaPrompt, setPendingEventSchemaPrompt] = useState<{
    eventName: string;
    schemaRef: string;
  } | null>(null);
  const [eventCatalogOptions, setEventCatalogOptions] = useState<WorkflowEventCatalogOptionV2[]>([]);
  const [eventCatalogStatus, setEventCatalogStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [showTriggerSchemaModal, setShowTriggerSchemaModal] = useState(false);
  const [triggerSchemaModalRef, setTriggerSchemaModalRef] = useState<string | null>(null);
  const [triggerSchemaModalSchema, setTriggerSchemaModalSchema] = useState<JsonSchema | null>(null);
  const [triggerSchemaModalStatus, setTriggerSchemaModalStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [triggerSchemaModalTitle, setTriggerSchemaModalTitle] = useState<string>('Trigger schema');
  const [showPublishedContractModal, setShowPublishedContractModal] = useState(false);
  const [publishedContractModalStatus, setPublishedContractModalStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [publishedContractModalSchema, setPublishedContractModalSchema] = useState<JsonSchema | null>(null);
  const [publishedContractModalVersion, setPublishedContractModalVersion] = useState<number | null>(null);
  const [publishedContractModalError, setPublishedContractModalError] = useState<string | null>(null);
  const [publishedContractModalSource, setPublishedContractModalSource] = useState<'snapshot' | 'registry' | null>(null);
  const [metadataDraft, setMetadataDraft] = useState<{
    isVisible: boolean;
    isPaused: boolean;
    concurrencyLimit: string;
    autoPauseOnFailure: boolean;
    failureRateThreshold: string;
    failureRateMinRuns: string;
  } | null>(null);
  const [payloadSchemaModeDraft, setPayloadSchemaModeDraft] = useState<'inferred' | 'pinned'>('pinned');
  const [pinnedPayloadSchemaRefDraft, setPinnedPayloadSchemaRefDraft] = useState<string>('');
  const [triggerTypeSelection, setTriggerTypeSelection] = useState<TriggerTypeSelection>('manual');
  const [selectedTriggerEventCategory, setSelectedTriggerEventCategory] = useState<string>('');
  const [isSavingMetadata, setIsSavingMetadata] = useState(false);
  const [stepsViewMode, setStepsViewMode] = useState<'list' | 'graph'>('list');
  const workflowTriggerModeOptions = useWorkflowTriggerModeOptions() as Array<{
    value: TriggerTypeSelection;
    label: string;
  }>;
  const workflowCanvasViewOptions = useWorkflowCanvasViewOptions();
  const [designerSidebarWidth, setDesignerSidebarWidth] = useState(DEFAULT_WORKFLOW_DESIGNER_SIDEBAR_WIDTH);
  const designerFloatAnchorRef = useRef<HTMLDivElement | null>(null);
  const designerFloatAnchorRectRef = useRef<{
    top: number;
    left: number;
    right: number;
    bottom: number;
  } | null>(null);
  const designerSidebarResizeRef = useRef<{
    startClientX: number;
    startWidth: number;
  } | null>(null);
  const [designerFloatAnchorRect, setDesignerFloatAnchorRect] = useState<{
    top: number;
    left: number;
    right: number;
    bottom: number;
  } | null>(null);
  const [isDesignerSidebarResizing, setIsDesignerSidebarResizing] = useState(false);

  const nodeRegistryMap = useMemo(() => Object.fromEntries(nodeRegistry.map((node) => [node.id, node])), [nodeRegistry]);
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamsString = searchParams.toString();
  const didApplyWorkflowIdFromRoute = useRef<string | null>(null);
  const didApplyNewWorkflowFromRoute = useRef<boolean>(false);
  const pendingDiscardActionRef = useRef<(() => void) | null>(null);
  const controlPanelSectionFromQuery = searchParams.get('section');
  const requestedWorkflowId = mode === 'editor-designer' ? workflowIdProp : null;
  const requestedNewWorkflow = mode === 'editor-designer' && isNew;

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('workflow-designer:steps-view');
      if (stored === 'list' || stored === 'graph') {
        setStepsViewMode(stored);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem('workflow-designer:steps-view', stepsViewMode);
    } catch {}
  }, [stepsViewMode]);

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    if (activeTab !== 'Designer') {
      designerFloatAnchorRectRef.current = null;
      setDesignerFloatAnchorRect(null);
      return;
    }

    let rafId: number | null = null;
    const update = () => {
      if (rafId != null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        const el = designerFloatAnchorRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const nextRect = {
          top: rect.top,
          left: rect.left,
          right: rect.right,
          bottom: rect.bottom
        };
        const prevRect = designerFloatAnchorRectRef.current;
        if (
          !prevRect
          || prevRect.top !== nextRect.top
          || prevRect.left !== nextRect.left
          || prevRect.right !== nextRect.right
          || prevRect.bottom !== nextRect.bottom
        ) {
          designerFloatAnchorRectRef.current = nextRect;
          setDesignerFloatAnchorRect(nextRect);
        }
      });
    };

    const el = designerFloatAnchorRef.current;
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' && el
        ? new ResizeObserver(() => {
            update();
          })
        : null;

    if (resizeObserver && el) {
      resizeObserver.observe(el);
    }

    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    document.addEventListener('transitionend', update, true);
    document.addEventListener('animationend', update, true);
    return () => {
      if (rafId != null) window.cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      document.removeEventListener('transitionend', update, true);
      document.removeEventListener('animationend', update, true);
    };
  }, [activeTab]);

  const designerFloatingLayout = useMemo(() => {
    if (!designerFloatAnchorRect || typeof window === 'undefined') {
      return null;
    }

    const top = Math.min(
      Math.max(DESIGNER_FLOAT_EDGE_GUTTER, designerFloatAnchorRect.top + DESIGNER_FLOAT_PANEL_OFFSET),
      window.innerHeight - DESIGNER_FLOAT_MIN_HEIGHT
    );
    const currentPaletteWidth = isPaletteCollapsed
      ? DESIGNER_PALETTE_COLLAPSED_WIDTH
      : DESIGNER_PALETTE_WIDTH;
    const anchorWidth = designerFloatAnchorRect.right - designerFloatAnchorRect.left;
    const fixedFloatingWidth =
      (DESIGNER_FLOAT_PANEL_OFFSET * 2)
      + currentPaletteWidth
      + DESIGNER_PALETTE_TOGGLE_OVERHANG
      + DESIGNER_CENTER_LEFT_EXTRA_PADDING
      + DESIGNER_CENTER_RIGHT_EXTRA_PADDING;
    const minimumFloatingWidth =
      fixedFloatingWidth
      + DESIGNER_CENTER_MIN_WIDTH
      + MIN_WORKFLOW_DESIGNER_SIDEBAR_WIDTH;
    const isStacked = anchorWidth < minimumFloatingWidth;

    if (isStacked) {
      return {
        isStacked,
        paletteStyle: {
          position: 'relative',
          maxHeight: 'none',
        } as React.CSSProperties,
        sidebarStyle: {
          position: 'relative',
          width: '100%',
          maxHeight: 'none',
        } as React.CSSProperties,
        centerScrollStyle: {} as React.CSSProperties,
        centerPaneStyle: undefined,
      };
    }

    const availableEditorWidth = Math.max(
      DESIGNER_CENTER_MIN_WIDTH + MIN_WORKFLOW_DESIGNER_SIDEBAR_WIDTH,
      anchorWidth - fixedFloatingWidth
    );
    const preferredEditorWidth = DESIGNER_CENTER_MAX_WIDTH + designerSidebarWidth;
    const editorWidthShortfall = Math.max(0, preferredEditorWidth - availableEditorWidth);
    const sharedShrink = editorWidthShortfall / 2;
    let centerShrink = Math.min(DESIGNER_CENTER_MAX_WIDTH - DESIGNER_CENTER_MIN_WIDTH, sharedShrink);
    let sidebarShrink = Math.min(designerSidebarWidth - MIN_WORKFLOW_DESIGNER_SIDEBAR_WIDTH, sharedShrink);
    let remainingShrink = editorWidthShortfall - centerShrink - sidebarShrink;

    if (remainingShrink > 0) {
      const sidebarShrinkRoom = designerSidebarWidth - MIN_WORKFLOW_DESIGNER_SIDEBAR_WIDTH - sidebarShrink;
      const extraSidebarShrink = Math.min(sidebarShrinkRoom, remainingShrink);
      sidebarShrink += extraSidebarShrink;
      remainingShrink -= extraSidebarShrink;
    }

    if (remainingShrink > 0) {
      const centerShrinkRoom = DESIGNER_CENTER_MAX_WIDTH - DESIGNER_CENTER_MIN_WIDTH - centerShrink;
      centerShrink += Math.min(centerShrinkRoom, remainingShrink);
    }

    const effectiveCenterWidth = DESIGNER_CENTER_MAX_WIDTH - centerShrink;
    const effectiveSidebarWidth = designerSidebarWidth - sidebarShrink;

    const paletteLeft = Math.min(
      Math.max(DESIGNER_FLOAT_EDGE_GUTTER, designerFloatAnchorRect.left + DESIGNER_FLOAT_PANEL_OFFSET),
      window.innerWidth - DESIGNER_FLOAT_EDGE_GUTTER - currentPaletteWidth
    );
    const paletteRight = paletteLeft + currentPaletteWidth + DESIGNER_PALETTE_TOGGLE_OVERHANG;
    const sidebarLeft = Math.min(
      Math.max(
        DESIGNER_FLOAT_EDGE_GUTTER,
        designerFloatAnchorRect.right - DESIGNER_FLOAT_PANEL_OFFSET - effectiveSidebarWidth
      ),
      Math.max(DESIGNER_FLOAT_EDGE_GUTTER, window.innerWidth - DESIGNER_FLOAT_EDGE_GUTTER - effectiveSidebarWidth)
    );
    const maxHeight = Math.max(
      DESIGNER_FLOAT_MIN_HEIGHT,
      designerFloatAnchorRect.bottom - (designerFloatAnchorRect.top + DESIGNER_FLOAT_PANEL_OFFSET) - DESIGNER_FLOAT_PANEL_OFFSET
    );
    const centerPaddingLeft = Math.max(
      0,
      paletteRight - designerFloatAnchorRect.left + DESIGNER_CENTER_LEFT_EXTRA_PADDING
    );
    const centerPaddingRight = Math.max(
      0,
      designerFloatAnchorRect.right - sidebarLeft + DESIGNER_CENTER_RIGHT_EXTRA_PADDING
    );

    return {
      isStacked,
      paletteStyle: {
        position: 'fixed',
        top,
        left: paletteLeft,
        maxHeight,
      } as React.CSSProperties,
      sidebarStyle: {
        position: 'fixed',
        top,
        left: sidebarLeft,
        width: effectiveSidebarWidth,
        maxHeight,
      } as React.CSSProperties,
      centerScrollStyle: {
        paddingLeft: `${centerPaddingLeft}px`,
        paddingRight: `${centerPaddingRight}px`,
      } as React.CSSProperties,
      centerPaneStyle: {
        maxWidth: effectiveCenterWidth,
      } as React.CSSProperties,
    };
  }, [designerFloatAnchorRect, designerSidebarWidth, isPaletteCollapsed]);

  const stepPathMap = useMemo(() => {
    return activeDefinition ? buildStepPathMap(activeDefinition.steps as Step[]) : {};
  }, [activeDefinition]);

  const actionInputMappingStatusByStepId = useMemo(() => {
    if (!activeDefinition) return new Map<string, ActionInputMappingStatus>();
    return buildActionInputMappingStatusByStepId(activeDefinition.steps as Step[], actionRegistry);
  }, [activeDefinition, actionRegistry]);

  const fieldOptions = useMemo(() => buildFieldOptions(payloadSchema), [payloadSchema]);

  const triggerMappingTargetFields = useMemo(() => {
    if (!payloadSchema) return [] as ActionInputField[];
    return extractActionInputFields(payloadSchema, payloadSchema);
  }, [payloadSchema]);

  const effectivePayloadSchemaRef = useMemo(() => {
    const current = activeDefinition?.payloadSchemaRef ?? '';
    if (payloadSchemaModeDraft === 'pinned') return current;
    return inferredSchemaRef ?? current;
  }, [activeDefinition?.payloadSchemaRef, inferredSchemaRef, payloadSchemaModeDraft]);

  const triggerMappingDataContext = useMemo(() => {
    const globals = {
      env: [] as SchemaField[],
      secrets: [] as SchemaField[],
      meta: [
        { name: 'state', type: 'string', required: false, nullable: true, description: 'Workflow state' },
        { name: 'traceId', type: 'string', required: false, nullable: true, description: 'Trace ID' },
        { name: 'tags', type: 'object', required: false, nullable: true, description: 'Workflow tags' }
      ] as SchemaField[],
      error: [
        { name: 'name', type: 'string', required: false, nullable: true, description: 'Error name' },
        { name: 'message', type: 'string', required: false, nullable: true, description: 'Error message' },
        { name: 'stack', type: 'string', required: false, nullable: true, description: 'Stack trace' },
        { name: 'nodePath', type: 'string', required: false, nullable: true, description: 'Error location' }
      ] as SchemaField[]
    };

    return {
      payload: triggerSourceSchema ? extractSchemaFields(triggerSourceSchema, triggerSourceSchema) : [],
      payloadSchema: triggerSourceSchema ?? undefined,
      steps: [],
      globals
    };
  }, [triggerSourceSchema]);

  const triggerMappingFieldOptions = useMemo(() => {
    const base = buildFieldOptions(triggerSourceSchema);
    return base.map((opt) => {
      if (typeof opt.value === 'string' && opt.value.startsWith('payload')) {
        return { ...opt, value: opt.value.replace(/^payload\b/, 'event.payload') };
      }
      return opt;
    });
  }, [triggerSourceSchema]);

  const triggerMappingExpressionContext = useMemo(() => {
    const sourceSchema = triggerSourceSchema ?? { type: 'object', properties: {} };
    return {
      allowPayloadRoot: false,
      eventSchema: {
        type: 'object',
        properties: {
          payload: sourceSchema
        }
      },
      metaSchema: {
        type: 'object',
        properties: {
          state: { type: 'string', description: 'Workflow state' },
          traceId: { type: 'string', description: 'Trace ID' },
          tags: { type: 'object', description: 'Workflow tags' }
        }
      }
    } as ExpressionContext;
  }, [triggerSourceSchema]);

  const pipeOptions = useMemo(() => {
    if (!activeDefinition) return [] as PipeLocation[];
    const locations: PipeLocation[] = [{ pipePath: 'root', label: 'Root' }];

    const visit = (steps: Step[], prefix: string) => {
      steps.forEach((step, index) => {
        const stepPath = `${prefix}.steps[${index}]`;
        if (step.type === 'control.if') {
          const ifStep = step as IfBlock;
          locations.push({ pipePath: `${stepPath}.then`, label: `${getStepLabel(step, nodeRegistryMap, designerActionCatalog, t)} ${t('designer.blockSection.then', { defaultValue: 'THEN' })}` });
          locations.push({ pipePath: `${stepPath}.else`, label: `${getStepLabel(step, nodeRegistryMap, designerActionCatalog, t)} ${t('designer.blockSection.else', { defaultValue: 'ELSE' })}` });
          visit(ifStep.then, `${stepPath}.then`);
          if (ifStep.else) {
            visit(ifStep.else, `${stepPath}.else`);
          }
        }
        if (step.type === 'control.tryCatch') {
          const tcStep = step as TryCatchBlock;
          locations.push({ pipePath: `${stepPath}.try`, label: `${getStepLabel(step, nodeRegistryMap, designerActionCatalog, t)} ${t('designer.blockSection.try', { defaultValue: 'TRY' })}` });
          locations.push({ pipePath: `${stepPath}.catch`, label: `${getStepLabel(step, nodeRegistryMap, designerActionCatalog, t)} ${t('designer.blockSection.catch', { defaultValue: 'CATCH' })}` });
          visit(tcStep.try, `${stepPath}.try`);
          visit(tcStep.catch, `${stepPath}.catch`);
        }
        if (step.type === 'control.forEach') {
          const feStep = step as ForEachBlock;
          locations.push({ pipePath: `${stepPath}.body`, label: `${getStepLabel(step, nodeRegistryMap, designerActionCatalog, t)} ${t('designer.blockSection.body', { defaultValue: 'BODY' })}` });
          visit(feStep.body, `${stepPath}.body`);
        }
      });
    };

    visit(activeDefinition.steps as Step[], 'root');
    return locations;
  }, [activeDefinition, designerActionCatalog, nodeRegistryMap]);

  const activeWorkflowRecord = useMemo(
    () => definitions.find((definition) => definition.workflow_id === activeWorkflowId) ?? null,
    [definitions, activeWorkflowId]
  );

  const hasUnsavedMetadataChanges = useMemo(() => {
    if (!metadataDraft || !activeWorkflowRecord) return false;

    const savedVisible = activeWorkflowRecord.is_visible ?? true;
    const savedPaused = activeWorkflowRecord.is_paused ?? false;
    const savedConcurrency = activeWorkflowRecord.concurrency_limit != null ? String(activeWorkflowRecord.concurrency_limit) : '';
    const savedAutoPause = activeWorkflowRecord.auto_pause_on_failure ?? false;
    const savedFailureThreshold = activeWorkflowRecord.failure_rate_threshold != null ? String(activeWorkflowRecord.failure_rate_threshold) : '';
    const savedFailureMinRuns = activeWorkflowRecord.failure_rate_min_runs != null ? String(activeWorkflowRecord.failure_rate_min_runs) : '';

    return (
      metadataDraft.isVisible !== savedVisible ||
      metadataDraft.isPaused !== savedPaused ||
      metadataDraft.concurrencyLimit !== savedConcurrency ||
      metadataDraft.autoPauseOnFailure !== savedAutoPause ||
      metadataDraft.failureRateThreshold !== savedFailureThreshold ||
      metadataDraft.failureRateMinRuns !== savedFailureMinRuns
    );
  }, [activeWorkflowRecord, metadataDraft]);

  const hasUnsavedDesignerChanges = useMemo(() => {
    if (!activeDefinition) return false;

    if (activeWorkflowId && activeWorkflowRecord) {
      const savedMode = (activeWorkflowRecord.payload_schema_mode === 'inferred' ? 'inferred' : 'pinned') as 'inferred' | 'pinned';
      const savedPinnedRef = activeWorkflowRecord.pinned_payload_schema_ref ?? activeWorkflowRecord.payload_schema_ref ?? '';
      const savedDraftDefinition = normalizeDesignerDefinition(activeWorkflowRecord.draft_definition);

      return (
        !areStructurallyEqual(activeDefinition, savedDraftDefinition) ||
        payloadSchemaModeDraft !== savedMode ||
        pinnedPayloadSchemaRefDraft !== savedPinnedRef
      );
    }

    const pristineUnsavedDraft: WorkflowDefinition = {
      id: activeDefinition.id,
      version: 1,
      name: 'New Workflow',
      description: '',
      payloadSchemaRef: EMPTY_WORKFLOW_PAYLOAD_SCHEMA_REF,
      steps: []
    };

    return (
      !areStructurallyEqual(activeDefinition, pristineUnsavedDraft) ||
      payloadSchemaModeDraft !== 'pinned' ||
      pinnedPayloadSchemaRefDraft !== EMPTY_WORKFLOW_PAYLOAD_SCHEMA_REF
    );
  }, [
    activeDefinition,
    activeWorkflowId,
    activeWorkflowRecord,
    payloadSchemaModeDraft,
    pinnedPayloadSchemaRefDraft
  ]);

  const closeDiscardChangesDialog = useCallback(() => {
    setShowDiscardChangesDialog(false);
    pendingDiscardActionRef.current = null;
  }, []);

  const requestDiscardChangesConfirmation = useCallback((onConfirmAction: () => void) => {
    if (!hasUnsavedDesignerChanges) {
      onConfirmAction();
      return;
    }
    pendingDiscardActionRef.current = onConfirmAction;
    setShowDiscardChangesDialog(true);
  }, [hasUnsavedDesignerChanges]);

  const handleConfirmDiscardChanges = useCallback(() => {
    const action = pendingDiscardActionRef.current;
    pendingDiscardActionRef.current = null;
    setShowDiscardChangesDialog(false);
    action?.();
  }, []);

  useEffect(() => {
    // For unsaved drafts (no workflowId yet), keep the local mode state.
    if (!activeWorkflowId) return;
    if (!activeWorkflowRecord) return;
    const mode = (activeWorkflowRecord.payload_schema_mode === 'inferred' ? 'inferred' : 'pinned') as 'inferred' | 'pinned';
    setPayloadSchemaModeDraft(mode);
    setPinnedPayloadSchemaRefDraft(activeWorkflowRecord.pinned_payload_schema_ref ?? activeWorkflowRecord.payload_schema_ref ?? '');
    setSchemaInferenceEnabled(mode === 'inferred');
    setContractSettingsExpanded(false);
    setSchemaRefAdvanced(false);
  }, [activeWorkflowId, activeWorkflowRecord?.workflow_id]);

  const draftValidationErrors = useMemo(
    () => (Array.isArray(activeWorkflowRecord?.validation_errors) ? activeWorkflowRecord?.validation_errors : []) as PublishError[],
    [activeWorkflowRecord?.validation_errors]
  );

  const draftValidationWarnings = useMemo(
    () => (Array.isArray(activeWorkflowRecord?.validation_warnings) ? activeWorkflowRecord?.validation_warnings : []) as PublishError[],
    [activeWorkflowRecord?.validation_warnings]
  );

  const triggerSourceSchemaRefForValidation = useMemo(() => {
    const trigger = activeDefinition?.trigger;
    if (trigger?.type !== 'event') return null;
    const override = (trigger as any)?.sourcePayloadSchemaRef;
    if (typeof override === 'string' && override.trim()) return override.trim();
    return inferredSchemaRef;
  }, [activeDefinition?.trigger, inferredSchemaRef]);

  const suppressTriggerMappingValidation = useMemo(() => {
    const trigger = activeDefinition?.trigger;
    if (trigger?.type !== 'event') return true;
    const payloadRef = activeDefinition?.payloadSchemaRef ?? '';
    return !(triggerSourceSchemaRefForValidation && payloadRef && triggerSourceSchemaRefForValidation !== payloadRef);
  }, [activeDefinition?.payloadSchemaRef, activeDefinition?.trigger, triggerSourceSchemaRefForValidation]);

  const currentValidationErrors = (publishErrors.length > 0 ? publishErrors : draftValidationErrors).filter((error) => {
    if (!suppressTriggerMappingValidation) return true;
    return !(typeof error?.stepPath === 'string' && error.stepPath.startsWith('root.trigger.payloadMapping'));
  });
  const currentValidationWarnings = (publishWarnings.length > 0 ? publishWarnings : draftValidationWarnings).filter((warning) => {
    if (!suppressTriggerMappingValidation) return true;
    return !(typeof warning?.stepPath === 'string' && warning.stepPath.startsWith('root.trigger.payloadMapping'));
  });

  const triggerValidationErrors = useMemo(
    () => currentValidationErrors.filter((err) => typeof err?.stepPath === 'string' && err.stepPath.startsWith('root.trigger')),
    [currentValidationErrors]
  );

  const triggerValidationWarnings = useMemo(
    () => currentValidationWarnings.filter((warn) => typeof warn?.stepPath === 'string' && warn.stepPath.startsWith('root.trigger')),
    [currentValidationWarnings]
  );

  const errorsByStepId = useMemo(() => {
    const map = new Map<string, PublishError[]>();
    currentValidationErrors.forEach((error) => {
      const entry = Object.entries(stepPathMap).find(([, path]) => path === error.stepPath);
      const stepId = error.stepId ?? entry?.[0];
      if (stepId) {
        const existing = map.get(stepId) ?? [];
        existing.push(error);
        map.set(stepId, existing);
      }
    });
    return map;
  }, [currentValidationErrors, stepPathMap]);

  const workflowValidationStatus = useMemo(() => {
    if (!activeWorkflowRecord) return 'unknown';
    if (currentValidationErrors.length > 0) return 'error';
    if (currentValidationWarnings.length > 0) return 'warning';
    return 'valid';
  }, [activeWorkflowRecord, currentValidationErrors.length, currentValidationWarnings.length]);

  const workflowValidationBadge = useMemo(() => {
    switch (workflowValidationStatus) {
      case 'error':
        return {
          label: t('designer.validation.badge.invalid', { defaultValue: 'Invalid' }),
          className: 'bg-destructive/15 text-destructive border-destructive/30',
        };
      case 'warning':
        return {
          label: t('designer.validation.badge.warnings', { defaultValue: 'Warnings' }),
          className: 'bg-warning/15 text-warning-foreground border-warning/30',
        };
      case 'valid':
        return {
          label: t('designer.validation.badge.valid', { defaultValue: 'Valid' }),
          className: 'bg-success/15 text-success border-success/30',
        };
      default:
        return {
          label: t('designer.validation.badge.unknown', { defaultValue: 'Unknown' }),
          className: 'bg-muted text-muted-foreground border-border',
        };
    }
  }, [t, workflowValidationStatus]);

  const canAdmin = useMemo(
    () => userPermissions.includes('workflow:admin'),
    [userPermissions]
  );
  const canManage = useMemo(
    () => userPermissions.includes('workflow:manage') || canAdmin,
    [userPermissions, canAdmin]
  );

  useEffect(() => {
    if (mode === 'editor-list') {
      setActiveTab('Workflows');
      return;
    }

    if (mode === 'editor-designer') {
      setActiveTab('Designer');
      return;
    }

    const tab = mapSectionToControlPanelTab(controlPanelSectionFromQuery, canAdmin);
    setActiveTab(tab);
  }, [canAdmin, controlPanelSectionFromQuery, mode]);

  const stopDesignerSidebarResize = useCallback(() => {
    designerSidebarResizeRef.current = null;
    setIsDesignerSidebarResizing(false);
    if (typeof document !== 'undefined') {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  }, []);

  useEffect(() => {
    if (!isDesignerSidebarResizing) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = designerSidebarResizeRef.current;
      if (!resizeState) return;

      setDesignerSidebarWidth(
        getWorkflowDesignerSidebarWidthFromDrag(
          resizeState.startWidth,
          resizeState.startClientX,
          event.clientX
        )
      );
    };

    const handlePointerUp = () => {
      stopDesignerSidebarResize();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [isDesignerSidebarResizing, stopDesignerSidebarResize]);

  useEffect(() => {
    if ((!designerFloatAnchorRect || designerFloatingLayout?.isStacked) && isDesignerSidebarResizing) {
      stopDesignerSidebarResize();
    }
  }, [designerFloatAnchorRect, designerFloatingLayout?.isStacked, isDesignerSidebarResizing, stopDesignerSidebarResize]);

  const handleControlPanelTabChange = useCallback((nextTabId: string) => {
    setActiveTab(nextTabId);

    if (mode !== 'control-panel') return;

    const section = mapControlPanelTabToSection(nextTabId);
    const params = new URLSearchParams(searchParamsString);
    if (section === 'runs') {
      params.delete('section');
    } else {
      params.set('section', section);
    }
    const nextParamsString = params.toString();
    const nextUrl = nextParamsString ? `/msp/workflow-control?${nextParamsString}` : '/msp/workflow-control';
    if (nextParamsString !== searchParamsString) {
      router.replace(nextUrl);
    }
  }, [mode, router, searchParamsString]);

  const triggerRequiresEventCatalog = useMemo(() => {
    return Boolean(activeDefinition?.trigger?.type === 'event' && activeDefinition.trigger.eventName);
  }, [activeDefinition?.trigger]);

  const triggerSchemaPolicy = useMemo(() => {
    const eventName = activeDefinition?.trigger?.type === 'event' ? activeDefinition.trigger.eventName : '';
    if (!eventName) return { ok: true, level: 'none' as const, message: '' };

    // Avoid flashing "missing from catalog" while the catalog is still loading.
    if (eventCatalogStatus === 'idle' || eventCatalogStatus === 'loading') {
      return { ok: true, level: 'none' as const, message: '' };
    }

    if (eventCatalogStatus === 'error') {
      return {
        ok: false,
        level: 'error' as const,
        message: 'Event catalog failed to load. Publishing and running are disabled until it loads.'
      };
    }

    const selected = eventCatalogOptions.find((e) => e.event_type === eventName) ?? null;
    if (!selected) {
      return {
        ok: false,
        level: 'error' as const,
        message: `Trigger event "${eventName}" is not present in the event catalog.`
      };
    }

    if (selected.payload_schema_ref_status !== 'known' || !selected.payload_schema_ref) {
      const sourceLabel = selected.source === 'system' ? 'System event' : 'Tenant event';
      const schemaLabel =
        selected.payload_schema_ref_status === 'missing'
          ? 'is missing a schema ref'
          : 'has an unknown schema ref';

      return {
        ok: false,
        level: 'error' as const,
        message: `${sourceLabel} "${eventName}" ${schemaLabel}. Fix the event catalog entry to include a valid schema before publishing or running.`
      };
    }

    return { ok: true, level: 'none' as const, message: '' };
  }, [activeDefinition?.trigger, eventCatalogOptions, eventCatalogStatus]);

  const payloadSchemaPolicy = useMemo(() => {
    const ref = effectivePayloadSchemaRef ?? '';
    if (!ref) return { ok: true, level: 'none' as const, message: '' };
    if (isTimeTrigger(activeDefinition?.trigger)) {
      if (payloadSchemaModeDraft !== 'pinned' || ref !== WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF) {
        return {
          ok: false,
          level: 'error' as const,
          message: 'Time-triggered workflows use the fixed clock payload contract and cannot infer or override a different schema.'
        };
      }
      return { ok: true, level: 'none' as const, message: '' };
    }
    // Manual workflows in inferred mode require pinning (explicit contract selection).
    if (payloadSchemaModeDraft === 'inferred' && !(activeDefinition?.trigger?.type === 'event')) {
      return {
        ok: false,
        level: 'error' as const,
        message: 'Manual workflows must pin a payload schema before publishing or running.'
      };
    }
    // Don't flash errors while registries are still loading.
    if (registryStatus === 'idle' || registryStatus === 'loading') return { ok: true, level: 'none' as const, message: '' };
    if (registryStatus === 'error') {
      return { ok: false, level: 'error' as const, message: 'Schema registry failed to load. Publishing and running are disabled until it loads.' };
    }
    if (payloadSchemaModeDraft === 'inferred' && activeDefinition?.trigger?.type === 'event' && activeDefinition.trigger.eventName && !inferredSchemaRef) {
      return {
        ok: false,
        level: 'error' as const,
        message: `No schema is available for trigger event "${activeDefinition.trigger.eventName}". Publishing and running are disabled until it is fixed.`
      };
    }
    if (schemaRefs.length > 0 && !schemaRefs.includes(ref)) {
      return { ok: false, level: 'error' as const, message: `Workflow payload schema ref "${ref}" is unknown. Publishing and running are disabled until it is fixed.` };
    }
    return { ok: true, level: 'none' as const, message: '' };
  }, [activeDefinition?.trigger, effectivePayloadSchemaRef, inferredSchemaRef, payloadSchemaModeDraft, registryStatus, schemaRefs]);

  const canPublishPermission = useMemo(
    () => userPermissions.includes('workflow:publish') || canAdmin,
    [userPermissions, canAdmin]
  );
  const canRunPermission = useMemo(
    () => canManage && (!activeWorkflowRecord?.is_system || canAdmin),
    [activeWorkflowRecord?.is_system, canAdmin, canManage]
  );
  const hasPublishedVersion = Boolean(activeWorkflowRecord?.published_version);
  const blockingValidationError = useMemo(
    () => currentValidationErrors[0] ?? null,
    [currentValidationErrors]
  );
  const blockingValidationReason = useMemo(() => {
    if (!blockingValidationError) return '';
    if (blockingValidationError.stepPath.startsWith('root.trigger.payloadMapping') || blockingValidationError.code.startsWith('TRIGGER_MAPPING_')) {
      return blockingValidationError.message || 'Fix workflow mapping errors before publishing or running.';
    }
    return blockingValidationError.message || 'Fix workflow validation errors before publishing or running.';
  }, [blockingValidationError]);
  const hasBlockingDraftErrors = currentValidationErrors.length > 0;
  const canPublishEnabled =
    canPublishPermission &&
    !hasBlockingDraftErrors &&
    triggerSchemaPolicy.ok &&
    payloadSchemaPolicy.ok &&
    (!triggerRequiresEventCatalog || eventCatalogStatus === 'loaded');
  const canRunEnabled =
    canRunPermission &&
    !hasBlockingDraftErrors &&
    (
      hasPublishedVersion ||
      (
        triggerSchemaPolicy.ok &&
        payloadSchemaPolicy.ok &&
        (!triggerRequiresEventCatalog || eventCatalogStatus === 'loaded')
      )
    );

  const publishDisabledReason = useMemo(() => {
    if (!canPublishPermission) return '';
    if (hasBlockingDraftErrors) return blockingValidationReason;
    if (!triggerSchemaPolicy.ok) return triggerSchemaPolicy.message;
    if (!payloadSchemaPolicy.ok) return payloadSchemaPolicy.message;
    if (triggerRequiresEventCatalog && eventCatalogStatus !== 'loaded') return 'Event catalog is still loading. Publishing is disabled until it loads.';
    if (registryStatus !== 'loaded' && schemaRefs.length === 0) return 'Schema registry is still loading. Publishing is disabled until it loads.';
    return '';
  }, [blockingValidationReason, canPublishPermission, eventCatalogStatus, hasBlockingDraftErrors, payloadSchemaPolicy, registryStatus, schemaRefs.length, triggerRequiresEventCatalog, triggerSchemaPolicy]);

  const runDisabledReason = useMemo(() => {
    if (!canRunPermission) return '';
    if (hasBlockingDraftErrors) return blockingValidationReason;
    if (hasPublishedVersion) return '';
    if (!triggerSchemaPolicy.ok) return triggerSchemaPolicy.message;
    if (!payloadSchemaPolicy.ok) return payloadSchemaPolicy.message;
    if (triggerRequiresEventCatalog && eventCatalogStatus !== 'loaded') return 'Event catalog is still loading. Running is disabled until it loads.';
    if (registryStatus !== 'loaded' && schemaRefs.length === 0) return 'Schema registry is still loading. Running is disabled until it loads.';
    return '';
  }, [blockingValidationReason, canRunPermission, eventCatalogStatus, hasBlockingDraftErrors, hasPublishedVersion, payloadSchemaPolicy, registryStatus, schemaRefs.length, triggerRequiresEventCatalog, triggerSchemaPolicy]);
  const canEditMetadata = useMemo(
    () => canManage && (!activeWorkflowRecord?.is_system || canAdmin),
    [canManage, canAdmin, activeWorkflowRecord]
  );

  const currentTriggerSelection = useMemo<TriggerTypeSelection>(() => {
    const actualTriggerType = activeDefinition?.trigger?.type;
    if (actualTriggerType === 'event') {
      return 'event';
    }
    return triggerTypeSelection === 'event' ? 'event' : 'manual';
  }, [activeDefinition?.trigger?.type, triggerTypeSelection]);

  const handleTriggerTypeSelectionChange = useCallback((nextType: TriggerTypeSelection) => {
    setTriggerTypeSelection(nextType);

    if (nextType === 'manual') {
      setSelectedTriggerEventCategory('');
      setPayloadSchemaModeDraft('pinned');
      setSchemaInferenceEnabled(false);
      setPinnedPayloadSchemaRefDraft(EMPTY_WORKFLOW_PAYLOAD_SCHEMA_REF);
      setSchemaRefAdvanced(false);
      setShowUseEventSchemaSuggestion(false);
      setPendingEventSchemaPrompt(null);
      setHasExplicitContractEdits(false);
      setActiveDefinition((current) => (
        current
          ? {
              ...current,
              trigger: undefined,
              payloadSchemaRef: EMPTY_WORKFLOW_PAYLOAD_SCHEMA_REF,
            }
          : current
      ));
      return;
    }

    if (activeDefinition?.trigger?.type !== 'event') {
      setActiveDefinition((current) => (current ? { ...current, trigger: undefined } : current));
    }
  }, [activeDefinition?.trigger?.type]);

	  const loadDefinitions = useCallback(async () => {
	    setIsLoading(true);
	    try {
	      const data = await listWorkflowDefinitionsAction();
	      const nextDefinitions = (data ?? []) as unknown as WorkflowDefinitionRecord[];
	      setDefinitions(nextDefinitions);
	    } catch (error) {
	      toast.error(mapWorkflowServerError(t, error, t('designer.toasts.loadWorkflowsFailed', { defaultValue: 'Failed to load workflows' })));
	    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadRunSummary = useCallback(async () => {
    try {
      const result = await listWorkflowRunsAction({ limit: 200, cursor: 0, sort: 'started_at:desc' });
      const latestByWorkflow = new Map<string, { status: string; started_at: string }>();
      const counts = new Map<string, number>();
      (result?.runs ?? []).forEach((run: any) => {
        const currentCount = counts.get(run.workflow_id) ?? 0;
        counts.set(run.workflow_id, currentCount + 1);
        const existing = latestByWorkflow.get(run.workflow_id);
        if (!existing || new Date(run.started_at).getTime() > new Date(existing.started_at).getTime()) {
          latestByWorkflow.set(run.workflow_id, { status: run.status, started_at: run.started_at });
        }
      });
      setRunCountByWorkflow(counts);
      setRunStatusByWorkflow(new Map(Array.from(latestByWorkflow.entries()).map(([id, entry]) => [id, entry.status])));
    } catch {
      setRunCountByWorkflow(new Map());
      setRunStatusByWorkflow(new Map());
    }
  }, []);

  const loadEventCatalogOptions = useCallback(async () => {
    setEventCatalogStatus('loading');
    try {
      const res = await listEventCatalogOptionsV2Action({ limit: 1000 });
      setEventCatalogOptions((res as any)?.events ?? []);
      setEventCatalogStatus('loaded');
    } catch (err) {
      setEventCatalogOptions([]);
      setEventCatalogStatus('error');
      const msg = err instanceof Error ? err.message : t('designer.toasts.loadEventCatalogFailed', { defaultValue: 'Failed to load event catalog' });
      toast.error(msg);
    }
  }, []);

  const openSchemaModalForRef = useCallback(async (opts: { schemaRef: string; title: string }) => {
    setTriggerSchemaModalTitle(opts.title);
    setTriggerSchemaModalRef(opts.schemaRef);
    setTriggerSchemaModalSchema(null);
    setTriggerSchemaModalStatus('loading');
    setShowTriggerSchemaModal(true);
    try {
      const result = await getWorkflowSchemaAction({ schemaRef: opts.schemaRef });
      const schema = (result?.schema ?? null) as JsonSchema | null;
      setTriggerSchemaModalSchema(schema);
      setTriggerSchemaModalStatus(schema ? 'loaded' : 'error');
    } catch {
      setTriggerSchemaModalSchema(null);
      setTriggerSchemaModalStatus('error');
    }
  }, []);

  const openPublishedContractModal = useCallback(async () => {
    if (!activeWorkflowId) return;
    const publishedVersion = activeWorkflowRecord?.published_version ?? null;
    if (!publishedVersion) return;
    setPublishedContractModalVersion(publishedVersion);
    setPublishedContractModalSchema(null);
    setPublishedContractModalError(null);
    setPublishedContractModalSource(null);
    setPublishedContractModalStatus('loading');
    setShowPublishedContractModal(true);
    try {
      const record = await getWorkflowDefinitionVersionAction({ workflowId: activeWorkflowId, version: publishedVersion });
      let schema = ((record as any)?.payload_schema_json ?? null) as JsonSchema | null;
      let source: 'snapshot' | 'registry' | null = schema ? 'snapshot' : null;

      // Fallback: older published records might not have stored payload_schema_json.
      // In that case, try to resolve the schema from the current registry using the published definition's payloadSchemaRef.
      if (!schema) {
        const payloadSchemaRef =
          typeof (record as any)?.definition_json?.payloadSchemaRef === 'string'
            ? String((record as any).definition_json.payloadSchemaRef).trim()
            : '';
        if (payloadSchemaRef) {
          try {
            const result = await getWorkflowSchemaAction({ schemaRef: payloadSchemaRef });
            schema = ((result as any)?.schema ?? null) as JsonSchema | null;
            if (schema) {
              source = 'registry';
            }
          } catch {
            // ignore: we'll show a helpful error below
          }
        }
      }

      setPublishedContractModalSchema(schema);
      setPublishedContractModalSource(source);
      if (schema) {
        setPublishedContractModalStatus('loaded');
      } else {
        const payloadSchemaRef =
          typeof (record as any)?.definition_json?.payloadSchemaRef === 'string'
            ? String((record as any).definition_json.payloadSchemaRef).trim()
            : '';
        setPublishedContractModalError(
          payloadSchemaRef
            ? `No published schema snapshot is stored for version ${publishedVersion}. (payloadSchemaRef: ${payloadSchemaRef})`
            : `No published schema snapshot is stored for version ${publishedVersion}.`
        );
        setPublishedContractModalStatus('error');
      }
    } catch {
      setPublishedContractModalSchema(null);
      setPublishedContractModalError('Failed to load published schema.');
      setPublishedContractModalStatus('error');
    }
  }, [activeWorkflowId, activeWorkflowRecord?.published_version]);

  const loadRegistries = useCallback(async () => {
    setRegistryStatus('loading');
    try {
      const overrides = getWorkflowPlaywrightOverrides();
      if (overrides?.failRegistries) {
        throw new Error('Failed to load workflow registries');
      }
      if (overrides?.registryNodes || overrides?.registryActions) {
        const overrideActions = applyWorkflowActionPresentationHintsToList(
          (overrides.registryActions ?? []) as ActionRegistryItem[]
        );
        setNodeRegistry((overrides.registryNodes ?? []) as NodeRegistryItem[]);
        setActionRegistry(overrideActions);
        setDesignerActionCatalog(buildWorkflowDesignerActionCatalog(overrideActions));
        try {
          const schemaList = await listWorkflowSchemaRefsAction();
          setSchemaRefs(((schemaList as { refs?: string[] } | null)?.refs ?? []) as string[]);
          try {
            const meta = await listWorkflowSchemasMetaAction();
            const items = (meta as { schemas?: Array<{ ref: string; title: string | null; description: string | null }> } | null)?.schemas ?? [];
            setSchemaMeta(new Map(items.map((s) => [s.ref, { title: s.title, description: s.description }])));
          } catch {
            setSchemaMeta(new Map());
          }
        } catch {
          setSchemaRefs([]);
          setSchemaMeta(new Map());
        }
        setRegistryError(false);
        setRegistryStatus('loaded');
        return;
      }
      const [nodes, actions, catalog] = await Promise.all([
        listWorkflowRegistryNodesAction(),
        listWorkflowRegistryActionsAction(),
        listWorkflowDesignerActionCatalogAction()
      ]);
      const normalizedActions = applyWorkflowActionPresentationHintsToList(
        (actions ?? []) as unknown as ActionRegistryItem[]
      );
      setNodeRegistry((nodes ?? []) as unknown as NodeRegistryItem[]);
      setActionRegistry(normalizedActions);
      setDesignerActionCatalog((catalog ?? []) as WorkflowDesignerCatalogRecord[]);
      try {
        const schemaList = await listWorkflowSchemaRefsAction();
        setSchemaRefs(((schemaList as { refs?: string[] } | null)?.refs ?? []) as string[]);
        try {
          const meta = await listWorkflowSchemasMetaAction();
          const items = (meta as { schemas?: Array<{ ref: string; title: string | null; description: string | null }> } | null)?.schemas ?? [];
          setSchemaMeta(new Map(items.map((s) => [s.ref, { title: s.title, description: s.description }])));
        } catch {
          setSchemaMeta(new Map());
        }
      } catch {
        setSchemaRefs([]);
        setSchemaMeta(new Map());
      }
      setRegistryError(false);
      setRegistryStatus('loaded');
    } catch (error) {
      setNodeRegistry([]);
      setActionRegistry([]);
      setDesignerActionCatalog([]);
      setSchemaRefs([]);
      setSchemaMeta(new Map());
      setRegistryError(true);
      setRegistryStatus('error');
      toast.error(t('designer.toasts.loadRegistriesFailed', { defaultValue: 'Failed to load workflow registries' }));
    }
  }, []);

  const loadPayloadSchema = useCallback(async (schemaRef: string | undefined) => {
    if (!schemaRef) {
      setPayloadSchema(null);
      setPayloadSchemaStatus('idle');
      setPayloadSchemaLoadedRef(null);
      return;
    }
    if (registryStatus !== 'loaded') {
      return;
    }
    if (!schemaRefs.includes(schemaRef)) {
      setPayloadSchema(null);
      setPayloadSchemaStatus('error');
      setPayloadSchemaLoadedRef(schemaRef);
      return;
    }
    if (payloadSchemaStatus === 'loading' && payloadSchemaLoadedRef === schemaRef) return;
    try {
      setPayloadSchemaStatus('loading');
      setPayloadSchemaLoadedRef(schemaRef);
      const result = await getWorkflowSchemaAction({ schemaRef });
      const schema = (result?.schema ?? null) as JsonSchema | null;
      setPayloadSchema(schema);
      setPayloadSchemaStatus(schema ? 'loaded' : 'error');
    } catch (error) {
      console.error('[WorkflowDesigner] Error loading schema:', error);
      setPayloadSchema(null);
      setPayloadSchemaStatus('error');
      setPayloadSchemaLoadedRef(schemaRef);
    }
  }, [payloadSchemaLoadedRef, payloadSchemaStatus, registryStatus, schemaRefs]);

  const ensurePayloadSchemaLoaded = useCallback(async () => {
    const schemaRef = effectivePayloadSchemaRef ?? '';
    if (!schemaRef) return;
    if (registryStatus !== 'loaded') return;
    if (payloadSchemaStatus === 'loading') return;
    if (payloadSchemaLoadedRef === schemaRef && payloadSchemaStatus === 'loaded' && payloadSchema) return;
    await loadPayloadSchema(schemaRef);
  }, [effectivePayloadSchemaRef, loadPayloadSchema, payloadSchema, payloadSchemaLoadedRef, payloadSchemaStatus, registryStatus]);

  const triggerSourceSchemaRef = useMemo(() => {
    const trigger = activeDefinition?.trigger;
    if (trigger?.type !== 'event') return null;
    const override = (trigger as any)?.sourcePayloadSchemaRef;
    if (typeof override === 'string' && override.trim()) return override.trim();
    return inferredSchemaRef;
  }, [activeDefinition?.trigger, inferredSchemaRef]);

  const triggerPayloadMappingInfo = useMemo(() => {
    const trigger = activeDefinition?.trigger;
    if (trigger?.type !== 'event') {
      return { mappingProvided: false, mappingRequired: false, schemaRefsMatch: false };
    }
    const mapping = (trigger as any)?.payloadMapping ?? {};
    const mappingProvided = mapping && typeof mapping === 'object' && Object.keys(mapping).length > 0;
    const payloadRef = activeDefinition?.payloadSchemaRef ?? '';
    const schemaRefsMatch = Boolean(triggerSourceSchemaRef && payloadRef && triggerSourceSchemaRef === payloadRef);
    const mappingRequired = Boolean(triggerSourceSchemaRef && payloadRef && !schemaRefsMatch);
    return { mappingProvided, mappingRequired, schemaRefsMatch };
  }, [activeDefinition?.payloadSchemaRef, activeDefinition?.trigger, triggerSourceSchemaRef]);

  const loadTriggerSourceSchema = useCallback(async (schemaRef: string | undefined) => {
    if (!schemaRef) {
      setTriggerSourceSchema(null);
      setTriggerSourceSchemaStatus('idle');
      setTriggerSourceSchemaLoadedRef(null);
      return;
    }
    if (registryStatus !== 'loaded') {
      return;
    }
    if (!schemaRefs.includes(schemaRef)) {
      setTriggerSourceSchema(null);
      setTriggerSourceSchemaStatus('error');
      setTriggerSourceSchemaLoadedRef(schemaRef);
      return;
    }
    if (triggerSourceSchemaStatus === 'loading' && triggerSourceSchemaLoadedRef === schemaRef) return;
    try {
      setTriggerSourceSchemaStatus('loading');
      setTriggerSourceSchemaLoadedRef(schemaRef);
      const result = await getWorkflowSchemaAction({ schemaRef });
      const schema = (result?.schema ?? null) as JsonSchema | null;
      setTriggerSourceSchema(schema);
      setTriggerSourceSchemaStatus(schema ? 'loaded' : 'error');
    } catch (error) {
      console.error('[WorkflowDesigner] Error loading trigger source schema:', error);
      setTriggerSourceSchema(null);
      setTriggerSourceSchemaStatus('error');
      setTriggerSourceSchemaLoadedRef(schemaRef);
    }
  }, [registryStatus, schemaRefs, triggerSourceSchemaLoadedRef, triggerSourceSchemaStatus]);

  const ensureTriggerSourceSchemaLoaded = useCallback(async () => {
    if (!triggerSourceSchemaRef) return;
    if (registryStatus !== 'loaded') return;
    if (triggerSourceSchemaStatus === 'loading') return;
    if (triggerSourceSchemaLoadedRef === triggerSourceSchemaRef && triggerSourceSchemaStatus === 'loaded' && triggerSourceSchema) return;
    await loadTriggerSourceSchema(triggerSourceSchemaRef);
  }, [loadTriggerSourceSchema, registryStatus, triggerSourceSchema, triggerSourceSchemaLoadedRef, triggerSourceSchemaRef, triggerSourceSchemaStatus]);

  useEffect(() => {
    loadDefinitions();
    loadRegistries();
    loadRunSummary();
    loadEventCatalogOptions();
  }, [loadDefinitions, loadRegistries, loadEventCatalogOptions]);

  useEffect(() => {
    const overrides = getWorkflowPlaywrightOverrides();
    if (overrides?.failPermissions) {
      setUserPermissions([]);
      toast.error(t('designer.toasts.loadPermissionsFailed', { defaultValue: 'Failed to load permissions' }));
      return;
    }
    getCurrentUserPermissions()
      .then((perms) => setUserPermissions(perms ?? []))
      .catch(() => {
        setUserPermissions([]);
        toast.error(t('designer.toasts.loadPermissionsFailed', { defaultValue: 'Failed to load permissions' }));
      });
  }, []);

  useEffect(() => {
    if (!activeWorkflowRecord) {
      setMetadataDraft(null);
      return;
    }
    setMetadataDraft({
      isVisible: activeWorkflowRecord.is_visible ?? true,
      isPaused: activeWorkflowRecord.is_paused ?? false,
      concurrencyLimit: activeWorkflowRecord.concurrency_limit ? String(activeWorkflowRecord.concurrency_limit) : '',
      autoPauseOnFailure: activeWorkflowRecord.auto_pause_on_failure ?? false,
      failureRateThreshold: activeWorkflowRecord.failure_rate_threshold != null ? String(activeWorkflowRecord.failure_rate_threshold) : '',
      failureRateMinRuns: activeWorkflowRecord.failure_rate_min_runs ? String(activeWorkflowRecord.failure_rate_min_runs) : ''
    });
  }, [activeWorkflowRecord]);

  useEffect(() => {
    const schemaRef = effectivePayloadSchemaRef ?? '';
    setPayloadSchema(null);
    setPayloadSchemaLoadedRef(schemaRef || null);
    setPayloadSchemaStatus(schemaRef ? 'idle' : 'idle');
    setShowSchemaModal(false);
    setSchemaPreviewExpanded(false);
  }, [effectivePayloadSchemaRef]);

  useEffect(() => {
    if (!effectivePayloadSchemaRef) return;
    const needsSchema =
      schemaPreviewExpanded ||
      showSchemaModal ||
      selectedStepId != null ||
      selectedPipePath !== 'root' ||
      (() => {
        const trigger = activeDefinition?.trigger;
        if (trigger?.type !== 'event') return false;
        const mapping = (trigger as any).payloadMapping;
        const mappingProvided = mapping && typeof mapping === 'object' && Object.keys(mapping).length > 0;
        const refsMatch = !!triggerSourceSchemaRef && triggerSourceSchemaRef === effectivePayloadSchemaRef;
        return showTriggerMapping || mappingProvided || !refsMatch;
      })();
    if (!needsSchema) return;
    ensurePayloadSchemaLoaded();
  }, [
    effectivePayloadSchemaRef,
    ensurePayloadSchemaLoaded,
    schemaPreviewExpanded,
    selectedPipePath,
    selectedStepId,
    showSchemaModal,
    showTriggerMapping,
    triggerSourceSchemaRef,
    activeDefinition?.trigger
  ]);

  useEffect(() => {
    if (!triggerSourceSchemaRef) return;
    const trigger = activeDefinition?.trigger;
    const mapping = trigger?.type === 'event' ? (trigger as any).payloadMapping : null;
    const mappingProvided = mapping && typeof mapping === 'object' && Object.keys(mapping).length > 0;
    const refsMatch = !!effectivePayloadSchemaRef && triggerSourceSchemaRef === effectivePayloadSchemaRef;
    const needsSchema = showTriggerMapping || mappingProvided || !refsMatch;
    if (!needsSchema) return;
    ensureTriggerSourceSchemaLoaded();
  }, [effectivePayloadSchemaRef, activeDefinition?.trigger, ensureTriggerSourceSchemaLoaded, showTriggerMapping, triggerSourceSchemaRef]);

  useEffect(() => {
    const ref = effectivePayloadSchemaRef ?? '';
    if (!ref) return;
    if (schemaRefs.length === 0) return;
    if (!schemaRefs.includes(ref)) {
      setContractSettingsExpanded(true);
      setSchemaRefAdvanced(true);
      if (lastCapturedUnknownSchemaRef.current !== ref) {
        lastCapturedUnknownSchemaRef.current = ref;
        analytics.capture('workflow.payload_schema_ref.unknown', {
          schemaRef: ref,
          workflowId: activeWorkflowId ?? activeDefinition?.id ?? null
        });
      }
    }
  }, [activeDefinition?.id, effectivePayloadSchemaRef, activeWorkflowId, schemaRefs]);

  useEffect(() => {
    if (!activeDefinition) return;
    const eventName = activeDefinition.trigger?.type === 'event' ? activeDefinition.trigger.eventName : '';
    if (!eventName) {
      setInferredSchemaRef(null);
      lastAppliedInferredRef.current = null;
      setInferredSchemaStatus('idle');
      return;
    }
    const load = async () => {
      try {
        setInferredSchemaStatus('loading');
        const user = await getCurrentUser();
        if (!user?.tenant) {
          setInferredSchemaRef(null);
          setInferredSchemaStatus('error');
          return;
        }
        const entry = await getEventCatalogEntryByEventType(eventName);
        const ref = (entry as any)?.payload_schema_ref;
        const normalizedRef = typeof ref === 'string' ? ref : null;
        setInferredSchemaRef(normalizedRef);
        setInferredSchemaStatus(normalizedRef ? 'loaded' : 'error');
        if (typeof ref !== 'string' || !ref) return;
        if (payloadSchemaModeDraft !== 'inferred') return;
        if (!canManage) return;
        if (lastAppliedInferredRef.current === ref) return;
        const current = activeDefinition.payloadSchemaRef ?? '';
        if (current !== ref) {
          lastAppliedInferredRef.current = ref;
          analytics.capture('workflow.payload_schema_ref.inferred_applied', {
            schemaRef: ref,
            workflowId: activeWorkflowId ?? activeDefinition?.id ?? null,
            eventType: eventName
          });
          handleDefinitionChange({ payloadSchemaRef: ref });
        }
      } catch {
        setInferredSchemaRef(null);
        setInferredSchemaStatus('error');
      }
    };
    load();
  }, [activeDefinition?.id, activeDefinition?.trigger, activeWorkflowId, canManage, payloadSchemaModeDraft]);

  const handleSelectDefinition = (record: WorkflowDefinitionRecord) => {
    const isDifferentWorkflow = activeWorkflowId !== record.workflow_id;
    
    // Clear previous workflow immediately to avoid showing stale data during transition
    if (isDifferentWorkflow) {
      setActiveDefinition(null);
      setActiveWorkflowId(null);
      setSelectedStepId(null);
      setSelectedPipePath('root');
      setPublishErrors([]);
      setPublishWarnings([]);
    }
    
    // Set new workflow - React will batch updates, but clearing first ensures
    // we don't show stale data if there's any delay
    const normalizedDefinition = normalizeDesignerDefinition(record.draft_definition);
    setActiveDefinition(normalizedDefinition);
    setActiveWorkflowId(record.workflow_id);
    setTriggerTypeSelection(normalizedDefinition.trigger?.type === 'event' ? 'event' : 'manual');
    setSelectedTriggerEventCategory('');
    setShowUseEventSchemaSuggestion(false);
    setPendingEventSchemaPrompt(null);
    setHasExplicitContractEdits(false);
    
    // Always reset these when selecting a workflow
    setPublishErrors([]);
    setPublishWarnings([]);
    setSelectedStepId(null);
    setSelectedPipePath('root');
  };

  useEffect(() => {
    if (mode !== 'editor-designer') {
      didApplyWorkflowIdFromRoute.current = null;
      return;
    }

    if (!requestedWorkflowId) {
      didApplyWorkflowIdFromRoute.current = null;
      if (!requestedNewWorkflow && activeWorkflowId) {
        setActiveDefinition(null);
        setActiveWorkflowId(null);
      }
      return;
    }

    if (didApplyWorkflowIdFromRoute.current === requestedWorkflowId) return;

    if (activeWorkflowId !== requestedWorkflowId) {
      setActiveDefinition(null);
      setActiveWorkflowId(null);
      setSelectedStepId(null);
      setSelectedPipePath('root');
    }

    const match = definitions.find((d) => d.workflow_id === requestedWorkflowId);
    if (!match) return;
    didApplyWorkflowIdFromRoute.current = requestedWorkflowId;
    handleSelectDefinition(match);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkflowId, definitions, mode, requestedNewWorkflow, requestedWorkflowId]);

  const handleCreateDefinition = useCallback(() => {
    const draft = createDefaultDefinition();
    setActiveDefinition(draft);
    setActiveWorkflowId(null);
    setPayloadSchemaModeDraft('pinned');
    setTriggerTypeSelection('manual');
    setSelectedTriggerEventCategory('');
    setSchemaInferenceEnabled(false);
    setContractSettingsExpanded(false);
    setSchemaRefAdvanced(false);
    setPinnedPayloadSchemaRefDraft(draft.payloadSchemaRef ?? '');
    setShowUseEventSchemaSuggestion(false);
    setPendingEventSchemaPrompt(null);
    setHasExplicitContractEdits(false);
    setSelectedStepId(null);
    setSelectedPipePath('root');
    setPublishErrors([]);
    setPublishWarnings([]);
  }, []);

  useEffect(() => {
    if (currentTriggerSelection !== 'event') {
      setSelectedTriggerEventCategory('');
      return;
    }

    const selectedEventName = activeDefinition?.trigger?.type === 'event' ? activeDefinition.trigger.eventName : '';
    if (!selectedEventName) {
      return;
    }

    const selectedOption = eventCatalogOptions.find((entry) => entry.event_type === selectedEventName) ?? null;
    setSelectedTriggerEventCategory(
      selectedOption
        ? getWorkflowTriggerEventCategoryKey(selectedOption.category)
        : WORKFLOW_TRIGGER_EVENT_CATEGORY_KEY_UNKNOWN
    );
  }, [activeDefinition?.trigger, currentTriggerSelection, eventCatalogOptions]);

  useEffect(() => {
    if (mode !== 'editor-designer') {
      didApplyNewWorkflowFromRoute.current = false;
      return;
    }
    if (!requestedNewWorkflow) {
      didApplyNewWorkflowFromRoute.current = false;
      return;
    }
    if (didApplyNewWorkflowFromRoute.current) return;
    didApplyNewWorkflowFromRoute.current = true;
    handleCreateDefinition();
  }, [handleCreateDefinition, mode, requestedNewWorkflow]);

  const handleDefinitionChange = useCallback((changes: Partial<WorkflowDefinition>) => {
    setActiveDefinition((current) => (current ? { ...current, ...changes } : current));
  }, []);

  const applyWorkflowInputSchemaRef = useCallback((schemaRef: string) => {
    if (!schemaRef) return;
    setPayloadSchemaModeDraft('pinned');
    setSchemaInferenceEnabled(false);
    setSchemaRefAdvanced(false);
    setPinnedPayloadSchemaRefDraft(schemaRef);
    setShowUseEventSchemaSuggestion(false);
    setPendingEventSchemaPrompt(null);
    handleDefinitionChange({ payloadSchemaRef: schemaRef });
  }, [handleDefinitionChange]);

  const handleUseEventSchemaForWorkflowInput = useCallback(() => {
    if (!activeDefinition || activeDefinition.trigger?.type !== 'event' || !triggerSourceSchemaRef) {
      return;
    }

    try {
      analytics.capture('workflow.trigger_schema.use_event_schema_clicked', {
        workflowId: activeWorkflowId ?? activeDefinition.id ?? null,
        triggerEvent: activeDefinition.trigger.eventName,
        sourceSchemaRef: triggerSourceSchemaRef,
        previousPayloadSchemaRef: activeDefinition.payloadSchemaRef ?? null,
      });
    } catch {}

    setHasExplicitContractEdits(true);
    applyWorkflowInputSchemaRef(triggerSourceSchemaRef);
  }, [activeDefinition, activeWorkflowId, applyWorkflowInputSchemaRef, triggerSourceSchemaRef]);

  const persistMetadataDraft = useCallback(async (
    workflowId: string,
    options?: { force?: boolean; showSuccessToast?: boolean }
  ) => {
    const force = options?.force ?? false;
    const showSuccessToast = options?.showSuccessToast ?? false;
    if (!metadataDraft) return false;
    if (!force && !hasUnsavedMetadataChanges) return false;

    setIsSavingMetadata(true);
    try {
      const overrides = getWorkflowPlaywrightOverrides();
      await delayIfNeeded(overrides?.saveSettingsDelayMs);
      if (overrides?.failSaveSettings) {
        throw new Error('Failed to update workflow settings');
      }
      await updateWorkflowDefinitionMetadataAction({
        workflowId,
        isVisible: metadataDraft.isVisible,
        isPaused: metadataDraft.isPaused,
        concurrencyLimit: metadataDraft.concurrencyLimit ? Number(metadataDraft.concurrencyLimit) : null,
        autoPauseOnFailure: metadataDraft.autoPauseOnFailure,
        failureRateThreshold: metadataDraft.failureRateThreshold ? Number(metadataDraft.failureRateThreshold) : null,
        failureRateMinRuns: metadataDraft.failureRateMinRuns ? Number(metadataDraft.failureRateMinRuns) : null
      });
      if (showSuccessToast) {
        toast.success(t('designer.toasts.settingsUpdated', { defaultValue: 'Workflow settings updated' }));
      }
      return true;
    } finally {
      setIsSavingMetadata(false);
    }
  }, [hasUnsavedMetadataChanges, metadataDraft]);

  const handleSaveDefinition = async () => {
    if (!activeDefinition) return;
    const normalizedDefinition = normalizeDesignerDefinition(activeDefinition);
    setIsSaving(true);
    try {
      const overrides = getWorkflowPlaywrightOverrides();
      await delayIfNeeded(overrides?.saveDraftDelayMs);
      if (overrides?.failSaveDraft) {
        throw new Error(t('designer.toasts.saveFailed', { defaultValue: 'Failed to save workflow' }));
      }
      if (!activeWorkflowId) {
        const data = await createWorkflowDefinitionAction({
          definition: normalizedDefinition,
          payloadSchemaMode: payloadSchemaModeDraft,
          pinnedPayloadSchemaRef: pinnedPayloadSchemaRefDraft ? pinnedPayloadSchemaRefDraft : undefined
        });
        setActiveWorkflowId(data.workflowId);
        setActiveDefinition({ ...normalizedDefinition, id: data.workflowId });

        router.replace(`/msp/workflow-editor/${encodeURIComponent(data.workflowId)}`, { scroll: false });
        toast.success(t('designer.toasts.created', { defaultValue: 'Workflow created' }));
      } else {
        await persistMetadataDraft(activeWorkflowId);
        await updateWorkflowDefinitionDraftAction({
          workflowId: activeWorkflowId,
          definition: normalizedDefinition,
          payloadSchemaMode: payloadSchemaModeDraft,
          pinnedPayloadSchemaRef: pinnedPayloadSchemaRefDraft ? pinnedPayloadSchemaRefDraft : undefined
        });
        toast.success(t('designer.toasts.saved', { defaultValue: 'Workflow saved' }));
      }
      // Refresh list in the background; do not block the UI on it (it can be slow during dev + Playwright).
      void loadDefinitions();
    } catch (error) {
      toast.error(mapWorkflowServerError(t, error, t('designer.toasts.saveFailed', { defaultValue: 'Failed to save workflow' })));
    } finally {
      setIsSaving(false);
    }
  };

  const openRunDialog = () => {
    setShowRunDialog(true);
  };

  const handleSaveMetadata = async () => {
    if (!activeWorkflowId || !metadataDraft) return;
    try {
      await persistMetadataDraft(activeWorkflowId, { force: true, showSuccessToast: true });
      void loadDefinitions();
    } catch (error) {
      toast.error(mapWorkflowServerError(t, error, t('designer.toasts.settingsUpdateFailed', { defaultValue: 'Failed to update workflow settings' })));
    }
  };

  const handlePublish = async () => {
    if (!activeDefinition || !activeWorkflowId) {
      toast.error(t('designer.toasts.saveBeforePublish', { defaultValue: 'Save the workflow before publishing' }));
      return;
    }
    const normalizedDefinition = normalizeDesignerDefinition(activeDefinition);
    setIsPublishing(true);
    try {
      const overrides = getWorkflowPlaywrightOverrides();
      await delayIfNeeded(overrides?.publishDelayMs);
      if (overrides?.failPublish) {
        throw new Error(t('designer.toasts.publishFailed', { defaultValue: 'Failed to publish workflow' }));
      }
      await persistMetadataDraft(activeWorkflowId);
      const data = await publishWorkflowDefinitionAction({
        workflowId: activeWorkflowId,
        version: normalizedDefinition.version,
        definition: normalizedDefinition
      });
      setPublishErrors(Array.isArray((data as any)?.errors) ? ((data as any).errors as PublishError[]) : []);
      setPublishWarnings(Array.isArray((data as any)?.warnings) ? ((data as any).warnings as PublishError[]) : []);
      if (data.ok === false) {
        try {
          const codes = Array.isArray((data as any)?.errors) ? ((data as any).errors as any[]).map((e) => e?.code).filter(Boolean) : [];
          analytics.capture('workflow.publish.blocked', {
            workflowId: activeWorkflowId,
            payloadSchemaMode: payloadSchemaModeDraft,
            effectivePayloadSchemaRef,
            triggerEvent: normalizedDefinition.trigger?.type === 'event' ? normalizedDefinition.trigger.eventName : null,
            errorCodes: codes
          });
        } catch {}
        toast.error(t('designer.toasts.publishValidationErrors', { defaultValue: 'Publish failed - fix validation errors' }));
        return;
      }
      try {
        analytics.capture('workflow.publish.succeeded', {
          workflowId: activeWorkflowId,
          payloadSchemaMode: payloadSchemaModeDraft,
          effectivePayloadSchemaRef,
          triggerEvent: normalizedDefinition.trigger?.type === 'event' ? normalizedDefinition.trigger.eventName : null,
          publishedVersion: (data as any)?.publishedVersion ?? normalizedDefinition.version
        });
      } catch {}
      toast.success(t('designer.toasts.published', { defaultValue: 'Workflow published' }));
      if (typeof (data as any)?.publishedVersion === 'number') {
        const nextDraftVersion = ((data as any).publishedVersion as number) + 1;
        setActiveDefinition((prev) => (prev ? { ...prev, version: nextDraftVersion } : prev));
      }
      void loadDefinitions();
    } catch (error) {
      toast.error(mapWorkflowServerError(t, error, t('designer.toasts.publishFailed', { defaultValue: 'Failed to publish workflow' })));
    } finally {
      setIsPublishing(false);
    }
  };

  // §16.6 - Enhanced handleAddStep to accept initial config (for pre-configured action items)
  // §19.4 - Auto-generate saveAs name for action.call steps
  // IBF - Supports insert-between via pendingInsertPosition
  const handleAddStep = (type: Step['type'], initialConfig?: Record<string, unknown>, initialName?: string) => {
    if (!activeDefinition) return;
    let newStep = createStepFromPalette(type, nodeRegistryMap);
    if (initialName && 'name' in newStep) {
      newStep = { ...(newStep as NodeStep), name: initialName };
    }
    // Apply initial config if provided (e.g., for action items with pre-selected actionId)
    if (initialConfig && 'config' in newStep) {
      const existingConfig = (newStep as NodeStep).config as Record<string, unknown> | undefined;

      // §19.4 - Auto-generate saveAs name when adding action.call with actionId
      let autoSaveAs: string | undefined;
      if (type === 'action.call' && initialConfig.actionId && typeof initialConfig.actionId === 'string') {
        autoSaveAs = generateSaveAsName(initialConfig.actionId);
      }

      newStep = {
        ...newStep,
        config: {
          ...existingConfig,
          ...initialConfig,
          ...(autoSaveAs ? { saveAs: autoSaveAs } : {})
        }
      };
    }

    // Use pending insert position if set, otherwise append to selected pipe
    const pipePath = pendingInsertPosition?.pipePath ?? selectedPipePath;
    const insertIndex = pendingInsertPosition?.index;

    const segments = parsePipePath(pipePath);
    const steps = getStepsAtPath(activeDefinition.steps as Step[], segments);

    // Insert at specific index or append
    let nextSteps: Step[];
    if (insertIndex !== undefined && insertIndex >= 0 && insertIndex <= steps.length) {
      nextSteps = [...steps.slice(0, insertIndex), newStep, ...steps.slice(insertIndex)];
    } else {
      nextSteps = [...steps, newStep];
    }

    const updatedSteps = updateStepsAtPath(activeDefinition.steps as Step[], segments, nextSteps);
    setActiveDefinition({ ...activeDefinition, steps: updatedSteps });
    setSelectedStepId(newStep.id);

    // Clear pending insert position after use
    if (pendingInsertPosition) {
      setPendingInsertPosition(null);
    }
  };

  const handleDeleteStep = (stepId: string) => {
    if (!activeDefinition) return;
    setActiveDefinition({ ...activeDefinition, steps: removeStepById(activeDefinition.steps as Step[], stepId) });
    if (selectedStepId === stepId) {
      setSelectedStepId(null);
    }
  };

  const handleDuplicateStep = (stepId: string) => {
    if (!activeDefinition) return;

    const stepPathMap = buildStepPathMap(activeDefinition.steps as Step[]);
    const stepPath = stepPathMap[stepId];
    if (!stepPath) {
      throw new Error(`Cannot duplicate step ${stepId}: step path was not found`);
    }

    const stepPathMatch = stepPath.match(/^(.*)\.steps\[(\d+)\]$/);
    if (!stepPathMatch) {
      throw new Error(`Cannot duplicate step ${stepId}: step path "${stepPath}" is invalid`);
    }

    const [, pipePath, stepIndexRaw] = stepPathMatch;
    const stepIndex = Number(stepIndexRaw);
    const segments = parsePipePath(pipePath);
    const pipeSteps = getStepsAtPath(activeDefinition.steps as Step[], segments);
    const sourceStep = pipeSteps[stepIndex];

    if (!sourceStep) {
      throw new Error(`Cannot duplicate step ${stepId}: source step was not found in pipe "${pipePath}"`);
    }

    const duplicatedStep = duplicateWorkflowStepWithNewIds(sourceStep);
    const nextSteps = [
      ...pipeSteps.slice(0, stepIndex + 1),
      duplicatedStep,
      ...pipeSteps.slice(stepIndex + 1)
    ];

    setActiveDefinition({
      ...activeDefinition,
      steps: updateStepsAtPath(activeDefinition.steps as Step[], segments, nextSteps)
    });
    setSelectedPipePath(pipePath);
    setSelectedStepId(duplicatedStep.id);
    setPendingInsertPosition(null);
  };

  const handleStepUpdate = (stepId: string, updater: (step: Step) => Step) => {
    if (!activeDefinition) return;
    setActiveDefinition({
      ...activeDefinition,
      steps: updateStepById(activeDefinition.steps as Step[], stepId, updater)
    });
  };

  // IBF - Handle insert-between: set pending position and update selected pipe
  const handleInsertStep = useCallback((pipePath: string, index: number) => {
    setPendingInsertPosition({ pipePath, index });
    setSelectedPipePath(pipePath);
    // Focus the palette to help user understand they should select a step type
    // The palette already shows "Insert into" which now points to the right pipe
  }, []);

  const hoveredPipePathRef = useRef<string | null>(null);
  const isDraggingRef = useRef(false);
  // PPD - Track if dragging from palette and what item type
  const [draggingFromPalette, setDraggingFromPalette] = useState<{
    type: Step['type'];
    actionId?: string;
    actionVersion?: number;
    groupKey?: string;
    groupLabel?: string;
    tileKind?: 'core-object' | 'transform' | 'app' | 'ai';
  } | null>(null);

  const handleDragStart = (start: { draggableId: string; source: { droppableId: string } }) => {
    isDraggingRef.current = true;
    hoveredPipePathRef.current = null;

    // PPD - Detect if dragging from palette
    if (start.source.droppableId === 'palette') {
      // Parse the palette item info from draggableId
      // Format: "palette:type", "palette:action.call:actionId:version", or "palette:group:groupKey:actionId:version"
      const parts = start.draggableId.replace('palette:', '').split(':');
      if (parts[0] === 'group' && parts.length >= 2) {
        const groupKey = parts[1];
        const catalogRecord = designerActionCatalog.find((record) => record.groupKey === groupKey);
        setDraggingFromPalette({
          type: 'action.call',
          groupKey,
          groupLabel: catalogRecord?.label,
          tileKind: catalogRecord?.tileKind,
          actionId: parts[2] || undefined,
          actionVersion: parts[3] ? Number(parts[3]) : undefined
        });
      } else if (parts[0] === 'action.call' && parts.length >= 3) {
        setDraggingFromPalette({
          type: 'action.call',
          actionId: parts[1],
          actionVersion: parts[2] ? Number(parts[2]) : undefined
        });
      } else {
        setDraggingFromPalette({ type: parts[0] as Step['type'] });
      }
    } else {
      setDraggingFromPalette(null);
    }
  };

  const handlePipeHover = useCallback((pipePath: string) => {
    if (!isDraggingRef.current) return;
    hoveredPipePathRef.current = pipePath;
  }, []);

  useEffect(() => {
    const findPipePathFromElement = (element: Element | null): string | null => {
      let current = element as HTMLElement | null;
      while (current) {
        const pipePath = current.getAttribute('data-pipe-path');
        if (pipePath) return pipePath;
        current = current.parentElement;
      }
      return null;
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const element = document.elementFromPoint(event.clientX, event.clientY);
      const pipePath = findPipePathFromElement(element);
      if (pipePath) {
        hoveredPipePathRef.current = pipePath;
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  const handleDragEnd = (result: DropResult) => {
    isDraggingRef.current = false;
    const hoverTarget = hoveredPipePathRef.current;
    hoveredPipePathRef.current = null;

    const parseInsertDroppableId = (droppableId: string): { pipePath: string; index: number } | null => {
      if (!droppableId.startsWith('insert:')) return null;
      // Format: insert:<pipePath>:<index>
      const rest = droppableId.slice('insert:'.length);
      const lastColon = rest.lastIndexOf(':');
      if (lastColon <= 0) return null;
      const pipePath = rest.slice(0, lastColon);
      const indexStr = rest.slice(lastColon + 1);
      const index = Number(indexStr);
      if (!Number.isFinite(index)) return null;
      return { pipePath, index };
    };

    // PPD - Handle palette-to-pipeline drops
    if (draggingFromPalette) {
      setDraggingFromPalette(null);

      if (!activeDefinition) return;

      // Get destination pipe from result or hover target
      const destinationId = result.destination?.droppableId ?? null;
      const insertTarget = destinationId ? parseInsertDroppableId(destinationId) : null;
      const destinationPipe = destinationId?.startsWith('pipe:') ? destinationId.replace('pipe:', '') : null;
      const resolvedDestPipe = insertTarget?.pipePath ?? destinationPipe ?? hoverTarget;

      if (!resolvedDestPipe) return;

      // Create the new step
      let newStep = createStepFromPalette(draggingFromPalette.type, nodeRegistryMap);

      // Apply action config if it's an action.call from palette
      if (draggingFromPalette.type === 'action.call') {
        newStep = applyGroupedActionSelectionToStep(
          newStep as NodeStep,
          draggingFromPalette,
          { generateSaveAsName }
        );
      }

      // Insert at destination
      const destSegments = parsePipePath(resolvedDestPipe);
      const destSteps = [...getStepsAtPath(activeDefinition.steps as Step[], destSegments)];
      const insertIndex = insertTarget?.index ?? result.destination?.index ?? destSteps.length;
      destSteps.splice(insertIndex, 0, newStep);

      const updatedSteps = updateStepsAtPath(activeDefinition.steps as Step[], destSegments, destSteps);
      setActiveDefinition({ ...activeDefinition, steps: updatedSteps });
      setSelectedStepId(newStep.id);
      return;
    }

    // Standard step reordering logic
    if (!activeDefinition) return;

    const sourcePipe = result.source.droppableId.replace('pipe:', '');
    const destinationId = result.destination?.droppableId ?? null;
    const insertTarget = destinationId ? parseInsertDroppableId(destinationId) : null;
    const destinationPipe = destinationId?.startsWith('pipe:') ? destinationId.replace('pipe:', '') : null;

    let resolvedDestPipe = destinationPipe;
    if (!resolvedDestPipe || resolvedDestPipe === sourcePipe) {
      if (hoverTarget && hoverTarget !== sourcePipe) {
        resolvedDestPipe = hoverTarget;
      }
    }

    if (insertTarget) {
      resolvedDestPipe = insertTarget.pipePath;
    }

    if (!resolvedDestPipe) return;

    const sourceSegments = parsePipePath(sourcePipe);
    const destSegments = parsePipePath(resolvedDestPipe);

    if (sourcePipe === resolvedDestPipe) {
      if (!result.destination) return;
      const steps = getStepsAtPath(activeDefinition.steps as Step[], sourceSegments);
      const nextSteps = [...steps];
      const [moved] = nextSteps.splice(result.source.index, 1);
      nextSteps.splice(result.destination.index, 0, moved);
      setActiveDefinition({
        ...activeDefinition,
        steps: updateStepsAtPath(activeDefinition.steps as Step[], sourceSegments, nextSteps)
      });
      return;
    }

    const sourceSteps = [...getStepsAtPath(activeDefinition.steps as Step[], sourceSegments)];
    const [moved] = sourceSteps.splice(result.source.index, 1);
    let updated = updateStepsAtPath(activeDefinition.steps as Step[], sourceSegments, sourceSteps);
    const destSteps = [...getStepsAtPath(updated, destSegments)];
    const insertIndex = insertTarget?.index ?? (
      destinationPipe && destinationPipe === resolvedDestPipe && result.destination
        ? result.destination.index
        : destSteps.length
    );
    destSteps.splice(insertIndex, 0, moved);
    updated = updateStepsAtPath(updated, destSegments, destSteps);
    setActiveDefinition({ ...activeDefinition, steps: updated });
  };

  const paletteItems = useMemo(() => {
    const searchTerm = search.trim().toLowerCase();

    // §16.6 - Enhanced registry items with output schema preview
    const registryItems = nodeRegistry
      .filter((node) => !LEGACY_WORKFLOW_NODE_IDS.has(node.id))
      .map((node) => {
        // For action.call nodes, find the corresponding action in actionRegistry
        const action = node.id === 'action.call'
          ? actionRegistry[0] // Just show a placeholder for action.call
          : actionRegistry.find(a => a.id === node.id);
        const outputFields = action?.outputSchema
          ? extractSchemaFields(action.outputSchema, action.outputSchema).map(f => f.name)
          : [];

        const rawLabel = node.ui?.label || node.id;
        const rawDescription = node.ui?.description || node.id;
        const translatedLabel = t(`designer.palette.nodes.${node.id}.label`, { defaultValue: rawLabel });
        const translatedDescription = t(`designer.palette.nodes.${node.id}.description`, { defaultValue: rawDescription });
        return {
          id: node.id,
          label: translatedLabel,
          description: translatedDescription,
          category: node.ui?.category || 'Nodes',
          type: node.id,
          sortOrder: 0,
          outputSummary: outputFields.length > 0
            ? t('designer.palette.returnsSummary', {
              defaultValue: 'Returns: {{list}}{{suffix}}',
              list: outputFields.slice(0, 3).join(', '),
              suffix: outputFields.length > 3 ? '...' : '',
            })
            : undefined,
          searchIndex: buildPaletteSearchIndex([
            node.id,
            node.ui?.label,
            node.ui?.description,
            rawLabel,
            translatedLabel,
            ...outputFields
          ])
        };
      });

    const groupedActionItems = designerActionCatalog
      .filter((record) => record.actions.length > 0 || record.tileKind === 'transform')
      .map((record, index) => {
        const defaultAction = record.defaultActionId
          ? actionRegistry.find((action) => action.id === record.defaultActionId)
          : undefined;

        const actionLabels = record.actions.map((action) => action.label);
        const actionIds = record.actions.map((action) => action.id);
        const inputFields = record.actions.flatMap((action) => action.inputFieldNames);
        const outputFields = record.actions.flatMap((action) => action.outputFieldNames);

        // Translate known built-in group labels/descriptions. Unknown groups (server-added app tiles)
        // fall back to the server-provided label.
        const translatedGroupLabel = t(`designer.palette.groups.${record.groupKey}.label`, { defaultValue: record.label });
        const rawDescription = record.description || `${record.label} actions`;
        const translatedGroupDescription = t(`designer.palette.groups.${record.groupKey}.description`, { defaultValue: rawDescription });
        return {
          id: record.groupKey,
          label: translatedGroupLabel,
          description: translatedGroupDescription,
          category: record.tileKind === 'core-object'
            ? 'Core'
            : record.tileKind === 'transform'
              ? 'Transform'
              : record.tileKind === 'ai'
                ? 'AI'
              : 'Apps',
          type: 'action.call' as Step['type'],
          groupKey: record.groupKey,
          groupLabel: record.label,
          iconToken: record.iconToken,
          tileKind: record.tileKind,
          actionId: defaultAction?.id,
          actionVersion: defaultAction?.version,
          sortOrder: index,
          outputSummary: actionLabels.length > 0
            ? `${actionLabels.slice(0, 3).join(', ')}${actionLabels.length > 3 ? '...' : ''}`
            : t('designer.palette.chooseAction', { defaultValue: 'Choose an action after adding this step' }),
          searchIndex: buildPaletteSearchIndex([
            record.groupKey,
            record.label,
            record.description,
            translatedGroupLabel,
            translatedGroupDescription,
            ...actionLabels,
            ...actionIds,
            ...inputFields,
            ...outputFields
          ])
        };
      });

    const controlItems = CONTROL_BLOCKS.map((block) => {
      const translatedLabel = t(`designer.palette.controlBlocks.${block.id}.label`, { defaultValue: block.label });
      const translatedDescription = t(`designer.palette.controlBlocks.${block.id}.description`, { defaultValue: block.description });
      return {
        id: block.id,
        label: translatedLabel,
        description: translatedDescription,
        category: block.category,
        type: block.id,
        sortOrder: 0,
        outputSummary: undefined as string | undefined,
        searchIndex: buildPaletteSearchIndex([block.id, block.label, block.description, translatedLabel, translatedDescription])
      };
    });

    // Keep generic nodes alongside grouped business tiles for compatibility while the step model transitions.
    const items = [...controlItems, ...groupedActionItems, ...registryItems];

    if (!searchTerm) return items;
    // §16.6 - Search also matches field names and normalized action/group aliases.
    return items.filter((item) => matchesPaletteSearchQuery(item.searchIndex, searchTerm));
  }, [nodeRegistry, actionRegistry, designerActionCatalog, search]);

  const groupedPaletteItems = useMemo(() => {
    return groupPaletteItemsByCategory(paletteItems);
  }, [paletteItems]);

  const flatPaletteItems = useMemo(() => {
    return Object.values(groupedPaletteItems).flat();
  }, [groupedPaletteItems]);

  const handlePipeSelect = (pipePath: string) => {
    setSelectedPipePath(pipePath);
  };

  const selectedStep = useMemo(() => {
    if (!activeDefinition || !selectedStepId) return null;
    const findStep = (steps: Step[]): Step | null => {
      for (const step of steps) {
        if (step.id === selectedStepId) return step;
        if (step.type === 'control.if') {
          const ifStep = step as IfBlock;
          const found = findStep(ifStep.then) || (ifStep.else ? findStep(ifStep.else) : null);
          if (found) return found;
        }
        if (step.type === 'control.tryCatch') {
          const tcStep = step as TryCatchBlock;
          const found = findStep(tcStep.try) || findStep(tcStep.catch);
          if (found) return found;
        }
        if (step.type === 'control.forEach') {
          const feStep = step as ForEachBlock;
          const found = findStep(feStep.body);
          if (found) return found;
        }
      }
      return null;
    };
    return findStep(activeDefinition.steps as Step[]);
  }, [activeDefinition, selectedStepId]);

  // PPD - Generate draggableId for palette items
  const getPaletteDraggableId = (item: typeof paletteItems[0]) => {
    const itemWithAction = item as typeof item & { actionId?: string; actionVersion?: number };
    const groupedItem = item as typeof item & { groupKey?: string };
    if (groupedItem.groupKey) {
      return `palette:group:${groupedItem.groupKey}:${itemWithAction.actionId ?? ''}:${itemWithAction.actionVersion ?? ''}`;
    }
    if (itemWithAction.actionId) {
      return `palette:action.call:${itemWithAction.actionId}:${itemWithAction.actionVersion ?? 1}`;
    }
    return `palette:${item.type}`;
  };

  // Dense palette icon mapping
  const getPaletteIcon = (item: typeof paletteItems[0]): React.ReactNode => {
    const iconClass = "h-5 w-5";
    const itemWithAction = item as typeof item & { actionId?: string; iconToken?: string; groupKey?: string };

    if (itemWithAction.groupKey || itemWithAction.iconToken) {
      switch (itemWithAction.iconToken ?? itemWithAction.groupKey) {
        case 'ticket': return <Ticket className={iconClass} />;
        case 'contact': return <Contact className={iconClass} />;
        case 'client': return <Building className={iconClass} />;
        case 'communication': return <Mail className={iconClass} />;
        case 'scheduling': return <Calendar className={iconClass} />;
        case 'project': return <FolderKanban className={iconClass} />;
        case 'time': return <Clock className={iconClass} />;
        case 'crm': return <Handshake className={iconClass} />;
        case 'transform': return <Wand2 className={iconClass} />;
        case 'ai': return <Bot className={iconClass} />;
        case 'app': return <AppWindow className={iconClass} />;
        default: return <Box className={iconClass} />;
      }
    }

    // If it's an action with a specific actionId, try to match by actionId
    if (itemWithAction.actionId) {
      const actionId = itemWithAction.actionId.toLowerCase();
      
      // Business Operations - Tickets
      if (actionId === 'tickets.create') return <Ticket className={iconClass} />;
      if (actionId === 'tickets.add_comment') return <MessageSquare className={iconClass} />;
      if (actionId === 'tickets.update_fields') return <Edit className={iconClass} />;
      if (actionId === 'tickets.assign') return <UserPlus className={iconClass} />;
      if (actionId === 'tickets.close') return <CheckCircle className={iconClass} />;
      if (actionId === 'tickets.link_entities') return <Link className={iconClass} />;
      if (actionId === 'tickets.add_attachment') return <Paperclip className={iconClass} />;
      if (actionId === 'tickets.find') return <Search className={iconClass} />;
      
      // Business Operations - Clients
      if (actionId === 'clients.find') return <Building className={iconClass} />;
      if (actionId === 'clients.search') return <Search className={iconClass} />;
      
      // Business Operations - Contacts
      if (actionId === 'contacts.find') return <User className={iconClass} />;
      if (actionId === 'contacts.search') return <Users className={iconClass} />;
      
      // Business Operations - Email
      if (actionId === 'email.send') return <Send className={iconClass} />;
      
      // Business Operations - Notifications
      if (actionId === 'notifications.send_in_app') return <Bell className={iconClass} />;
      
      // Business Operations - Scheduling
      if (actionId === 'scheduling.assign_user') return <CalendarPlus className={iconClass} />;
      
      // Business Operations - Projects
      if (actionId === 'projects.create_task') return <SquareCheck className={iconClass} />;
      
      // Business Operations - Time
      if (actionId === 'time.create_entry') return <Timer className={iconClass} />;
      
      // Business Operations - CRM
      if (actionId === 'crm.create_activity_note') return <StickyNote className={iconClass} />;
      
      // Fallback patterns for other actions
      if (actionId.includes('email') || actionId.includes('mail')) return <Mail className={iconClass} />;
      if (actionId.includes('send')) return <Send className={iconClass} />;
      if (actionId.includes('http') || actionId.includes('api') || actionId.includes('fetch')) return <Globe className={iconClass} />;
      if (actionId.includes('db') || actionId.includes('query') || actionId.includes('sql')) return <Database className={iconClass} />;
      if (actionId.includes('file') || actionId.includes('read') || actionId.includes('write')) return <FileText className={iconClass} />;
      if (actionId.includes('log') || actionId.includes('print')) return <Terminal className={iconClass} />;
      return <Zap className={iconClass} />;
    }

    // Match by step type
    switch (item.type) {
      case 'control.if': return <GitBranch className={iconClass} />;
      case 'control.forEach': return <Repeat className={iconClass} />;
      case 'control.tryCatch': return <ShieldAlert className={iconClass} />;
      case 'control.return': return <CornerDownRight className={iconClass} />;
      case 'control.callWorkflow': return <Workflow className={iconClass} />;
      case 'state.set': return <Database className={iconClass} />;
      case 'transform.assign': return <Settings className={iconClass} />;
      case 'event.wait': return <Clock className={iconClass} />;
      case 'time.wait': return <Hourglass className={iconClass} />;
      case 'human.task': return <User className={iconClass} />;
      case 'action.call': return <Zap className={iconClass} />;
      default: return <Box className={iconClass} />;
    }
  };

  const renderPaletteItem = (
    item: typeof paletteItems[0],
    dragProvided: DraggableProvided,
    isDragging: boolean
  ) => {
    const itemWithAction = item as typeof item & {
      actionId?: string;
      actionVersion?: number;
      groupKey?: string;
      groupLabel?: string;
      tileKind?: 'core-object' | 'transform' | 'app' | 'ai';
    };

    return (
      <PaletteItemWithTooltip
        item={itemWithAction}
        icon={getPaletteIcon(item)}
        isDragging={isDragging}
        provided={dragProvided}
        disabled={!canManage || registryError}
        onClick={() => {
          if (itemWithAction.groupKey) {
            handleAddStep(
              'action.call',
              buildGroupedActionStepConfig(itemWithAction, { generateSaveAsName }),
              itemWithAction.label
            );
          } else if (itemWithAction.actionId) {
            handleAddStep('action.call', {
              actionId: itemWithAction.actionId,
              version: itemWithAction.actionVersion
            });
          } else {
            handleAddStep(item.type as Step['type']);
          }
        }}
      />
    );
  };

  const showInitialDesignerSkeleton = isLoading && !activeDefinition;
  const isDesignerStacked = designerFloatingLayout?.isStacked ?? false;
  const canResizeDesignerSidebar = canManage && !isDesignerStacked;

  const designerContent = (
    <DragDropContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
    <div className="flex flex-col h-full min-h-0">
	      <div
          ref={designerFloatAnchorRef}
          className={`relative flex flex-col flex-1 min-h-0 bg-gray-50 dark:bg-[rgb(var(--color-background))] ${isDesignerStacked ? 'overflow-y-auto' : 'overflow-hidden'}`}
        >
        <div className={isDesignerStacked ? 'contents' : 'sticky top-4 z-20 h-0 pointer-events-none'}>
          {/* Floating Icon-Grid Palette (left) */}
          <Droppable
            droppableId="palette"
            isDropDisabled={true}
            renderClone={(dragProvided, snapshot, rubric) => {
              const item = flatPaletteItems[rubric.source.index];
              if (!item) return <div ref={dragProvided.innerRef} {...dragProvided.draggableProps} />;
              return renderPaletteItem(item, dragProvided, snapshot.isDragging);
            }}
          >
            {(provided) => (
              <WorkflowDesignerPalette
                visible={Boolean(designerFloatAnchorRect)}
                style={designerFloatingLayout?.paletteStyle}
                layout={isDesignerStacked ? 'stacked' : 'floating'}
                className={isDesignerStacked ? 'order-1 mx-auto mt-4 w-[calc(100%-2rem)] max-w-4xl flex-none' : undefined}
                search={search}
                onSearchChange={setSearch}
                registryError={registryError}
                draggingFromPalette={Boolean(draggingFromPalette)}
                groupedPaletteItems={groupedPaletteItems}
                scrollContainerRef={provided.innerRef}
                scrollContainerProps={provided.droppableProps}
                scrollContainerFooter={provided.placeholder}
                isCollapsed={isPaletteCollapsed}
                onToggleCollapse={() => setIsPaletteCollapsed((prev) => !prev)}
                expandedWidth={DESIGNER_PALETTE_WIDTH}
                collapsedWidth={DESIGNER_PALETTE_COLLAPSED_WIDTH}
                renderItem={(item, _category, paletteIndex) => (
                  <Draggable
                    key={item.id}
                    draggableId={getPaletteDraggableId(item)}
                    index={paletteIndex}
                    isDragDisabled={!canManage || registryError}
                  >
                    {(dragProvided, snapshot) => renderPaletteItem(item, dragProvided, snapshot.isDragging)}
                  </Draggable>
                )}
              />
            )}
          </Droppable>

          {/* Floating Properties (right) */}
          <aside
            id="workflow-designer-sidebar-scroll"
            className={`pointer-events-auto relative max-h-[calc(100vh-220px)] bg-white/95 dark:bg-[rgb(var(--color-card))]/95 backdrop-blur border border-gray-200 dark:border-[rgb(var(--color-border-200))] rounded-lg shadow-lg overflow-y-auto p-4 space-y-4 z-40 ${isDesignerStacked ? 'order-3 mx-4 mb-4 flex-none' : ''} ${designerFloatAnchorRect ? '' : 'hidden'}`}
            style={designerFloatingLayout?.sidebarStyle}
          >
            <div
              id="workflow-designer-sidebar-resize-handle"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize properties panel"
              className={`absolute inset-y-0 left-0 z-10 w-3 select-none ${canResizeDesignerSidebar ? 'cursor-col-resize' : 'pointer-events-none opacity-0'}`}
              onPointerDown={(event) => {
                if (!canResizeDesignerSidebar) return;
                event.preventDefault();
                event.stopPropagation();
                designerSidebarResizeRef.current = {
                  startClientX: event.clientX,
                  startWidth: designerSidebarWidth,
                };
                setIsDesignerSidebarResizing(true);
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
              }}
            >
              <div className="absolute inset-y-4 left-1.5 w-px bg-gray-200 dark:bg-[rgb(var(--color-border-200))]" />
            </div>
            {activeWorkflowRecord && metadataDraft && canEditMetadata && (
              <Card className="p-3 space-y-3">
                <div>
                  <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">Workflow Settings</div>
                  <div className="text-xs text-gray-500">Visibility, pausing, and safety controls.</div>
                </div>
                <Switch
                  id="workflow-settings-visible"
                  checked={metadataDraft.isVisible}
                  onCheckedChange={(value) =>
                    setMetadataDraft((prev) => (prev ? { ...prev, isVisible: Boolean(value) } : prev))
                  }
                  label="Visible to users"
                />
                <Switch
                  id="workflow-settings-paused"
                  checked={metadataDraft.isPaused}
                  onCheckedChange={(value) =>
                    setMetadataDraft((prev) => (prev ? { ...prev, isPaused: Boolean(value) } : prev))
                  }
                  label="Paused (stop new runs)"
                />
                <Input
                  id="workflow-settings-concurrency"
                  label="Concurrency limit"
                  type="number"
                  value={metadataDraft.concurrencyLimit}
                  onChange={(event) =>
                    setMetadataDraft((prev) => (prev ? { ...prev, concurrencyLimit: event.target.value } : prev))
                  }
                  placeholder="Unlimited"
                />
                <Switch
                  id="workflow-settings-auto-pause"
                  checked={metadataDraft.autoPauseOnFailure}
                  onCheckedChange={(value) =>
                    setMetadataDraft((prev) => (prev ? { ...prev, autoPauseOnFailure: Boolean(value) } : prev))
                  }
                  label="Auto-pause on failure rate"
                />
                <Input
                  id="workflow-settings-failure-threshold"
                  label="Failure rate threshold"
                  type="number"
                  value={metadataDraft.failureRateThreshold}
                  disabled={!metadataDraft.autoPauseOnFailure}
                  onChange={(event) =>
                    setMetadataDraft((prev) => (prev ? { ...prev, failureRateThreshold: event.target.value } : prev))
                  }
                  placeholder="0.5"
                />
                <Input
                  id="workflow-settings-failure-min"
                  label="Min runs before auto-pause"
                  type="number"
                  value={metadataDraft.failureRateMinRuns}
                  disabled={!metadataDraft.autoPauseOnFailure}
                  onChange={(event) =>
                    setMetadataDraft((prev) => (prev ? { ...prev, failureRateMinRuns: event.target.value } : prev))
                  }
                  placeholder="10"
                />
                <Button
                  id="workflow-settings-save"
                  onClick={handleSaveMetadata}
                  disabled={isSavingMetadata || !activeWorkflowId}
                >
                  {isSavingMetadata ? 'Saving...' : 'Save Settings'}
                </Button>
              </Card>
            )}
            {selectedStep && activeDefinition ? (
              canManage || selectedStep.type === 'action.call' ? (
                <div className="space-y-3">
                  {!canManage && (
                    <div className="text-sm text-gray-500">Read-only access: step editing is disabled.</div>
                  )}
                  <StepConfigPanel
                    step={selectedStep}
                    stepPath={stepPathMap[selectedStep.id]}
                    errors={errorsByStepId.get(selectedStep.id) ?? []}
                    nodeRegistry={nodeRegistryMap}
                    actionRegistry={actionRegistry}
                    designerActionCatalog={designerActionCatalog}
                    eventCatalogOptions={eventCatalogOptions}
                    fieldOptions={fieldOptions}
                    payloadSchema={payloadSchema}
                    definition={activeDefinition}
                    editable={canManage}
                    onChange={(updatedStep) => handleStepUpdate(selectedStep.id, () => updatedStep)}
                  />
                </div>
              ) : (
                <div className="text-sm text-gray-500">
                  {t('designer.stepPanel.readOnly', { defaultValue: 'Read-only access: step editing is disabled.' })}
                </div>
              )
            ) : (
              <div className="text-sm text-gray-500">
                {t('designer.stepPanel.selectPrompt', { defaultValue: 'Select a step to edit its configuration.' })}
              </div>
            )}

            {currentValidationErrors.length > 0 && activeDefinition && (
              <div className="mt-6">
                <h3 className="text-sm font-semibold text-destructive flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-4 w-4" /> Validation Errors
                </h3>
                <div className="mb-3 rounded border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <span className="font-semibold">Contract mode:</span>{' '}
                      {payloadSchemaModeDraft === 'pinned' ? 'Pinned' : 'Inferred'}
                    </div>
                    {effectivePayloadSchemaRef && (
                      <div className="font-mono break-all">{effectivePayloadSchemaRef}</div>
                    )}
                  </div>
                </div>
                <div className="space-y-3">
                  {currentValidationErrors.map((error, index) => (
                    <Card key={`${error.stepPath}-${index}`} className="p-3 border border-destructive/30">
                      <div className="text-xs font-semibold text-destructive">{error.code}</div>
                      <div className="text-sm text-gray-800">{error.message}</div>
                      <div className="text-xs text-gray-500 mt-1">
                        {buildPathBreadcrumbs(activeDefinition.steps as Step[], error.stepPath).join(' > ') || error.stepPath}
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}
            {currentValidationWarnings.length > 0 && activeDefinition && (
              <div className="mt-6">
                <h3 className="text-sm font-semibold text-yellow-700 flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-4 w-4" /> Validation Warnings
                </h3>
                <div className="mb-3 rounded border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <span className="font-semibold">Contract mode:</span>{' '}
                      {payloadSchemaModeDraft === 'pinned' ? 'Pinned' : 'Inferred'}
                    </div>
                    {effectivePayloadSchemaRef && (
                      <div className="font-mono break-all">{effectivePayloadSchemaRef}</div>
                    )}
                  </div>
                </div>
                <div className="space-y-3">
                  {currentValidationWarnings.map((warning, index) => (
                    <Card key={`${warning.stepPath}-${index}`} className="p-3 border border-warning/30">
                      <div className="text-xs font-semibold text-warning">{warning.code}</div>
                      <div className="text-sm text-gray-800">{warning.message}</div>
                      <div className="text-xs text-gray-500 mt-1">
                        {buildPathBreadcrumbs(activeDefinition.steps as Step[], warning.stepPath).join(' > ') || warning.stepPath}
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </div>

	        <div
            id="workflow-designer-center-scroll"
            className={isDesignerStacked ? 'order-2 flex-none min-h-0 overflow-visible p-4' : 'flex-1 min-h-0 overflow-y-auto p-6 pl-72 pr-[460px]'}
            style={designerFloatingLayout?.centerScrollStyle}
          >
          <div className="max-w-4xl mx-auto space-y-6" style={designerFloatingLayout?.centerPaneStyle}>
                {showInitialDesignerSkeleton ? (
                  <>
                    <Card className="p-4 space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Skeleton className="h-3 w-24" />
                          <Skeleton className="h-9 w-full" />
                        </div>
                        <div className="space-y-2">
                          <Skeleton className="h-3 w-16" />
                          <Skeleton className="h-9 w-full" />
                        </div>
                        <div className="col-span-2">
                          <Skeleton className="h-3 w-48" />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Skeleton className="h-3 w-20" />
                        <Skeleton className="h-20 w-full" />
                      </div>
                      <div className="space-y-2">
                        <Skeleton className="h-3 w-28" />
                        <Skeleton className="h-10 w-full" />
                      </div>
                      <div className="space-y-2">
                        <Skeleton className="h-3 w-32" />
                        <Skeleton className="h-10 w-full" />
                      </div>
                    </Card>

                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <div className="space-y-2">
                          <Skeleton className="h-5 w-40" />
                          <Skeleton className="h-4 w-80" />
                        </div>
                        <div className="flex items-center gap-2">
                          <Skeleton className="h-8 w-16 rounded-md" />
                          <Skeleton className="h-8 w-16 rounded-md" />
                        </div>
                      </div>
                      <Skeleton className="h-[650px] w-full rounded border border-gray-200 dark:border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))]" />
                    </div>
                  </>
                ) : (
                  <>
                    <Card className="p-4 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Input
                      id="workflow-designer-name"
                      label={t('designer.form.nameLabel', { defaultValue: 'Workflow name' })}
                      value={activeDefinition?.name ?? ''}
                      onChange={(event) => handleDefinitionChange({ name: event.target.value })}
                    />
                    <Input
                      id="workflow-designer-version"
                      label={t('designer.form.versionLabel', { defaultValue: 'Version' })}
                      type="number"
                      value={activeDefinition?.version ?? 1}
                      onChange={(event) => handleDefinitionChange({ version: Number(event.target.value) })}
                    />
                    <div
                      id="workflow-designer-published-version"
                      className="col-span-2 text-xs text-gray-500"
                    >
                      {t('designer.form.latestPublishedVersion', {
                        defaultValue: 'Latest published version: {{version}}',
                        version: activeWorkflowRecord?.published_version ?? '—',
                      })}
                    </div>
                  </div>
                  <TextArea
                    id="workflow-designer-description"
                    label={t('designer.form.descriptionLabel', { defaultValue: 'Description' })}
                    value={activeDefinition?.description ?? ''}
                    onChange={(event) => handleDefinitionChange({ description: event.target.value })}
                    rows={2}
                  />
                  {(() => {
                    const trigger = activeDefinition?.trigger;
                    const selectedEventName = trigger?.type === 'event' ? trigger.eventName : '';
                    const selectedOption = selectedEventName
                      ? eventCatalogOptions.find((e) => e.event_type === selectedEventName) ?? null
                      : null;
                    const showTriggerSchemaDetails = contractSettingsExpanded;
                    const showEventConfiguration = currentTriggerSelection === 'event';
                    const eventCategoryOptions = buildWorkflowTriggerEventCategoryOptions(eventCatalogOptions, selectedEventName);
                    const eventOptions = buildWorkflowTriggerEventOptions(
                      eventCatalogOptions,
                      selectedTriggerEventCategory,
                      selectedEventName
                    );
                    const eventPickerDisabled =
                      !canManage ||
                      eventCatalogStatus === 'loading' ||
                      (!selectedTriggerEventCategory && !(selectedEventName && !selectedOption));

                    return (
                      <div className="space-y-3">
                        <div className="space-y-4">
                          <div>
                            <label htmlFor="workflow-designer-trigger-type" className="block text-sm font-medium text-gray-700 mb-1">
                              {t('designer.form.triggerTypeLabel', { defaultValue: 'Trigger type' })}
                            </label>
                            <SearchableSelect
                              id="workflow-designer-trigger-type"
                              value={currentTriggerSelection}
                              onChange={(value) => handleTriggerTypeSelectionChange((value || 'manual') as TriggerTypeSelection)}
                              placeholder={t('designer.form.triggerTypePlaceholder', { defaultValue: 'Select trigger type' })}
                              dropdownMode="overlay"
                              options={workflowTriggerModeOptions}
                              disabled={!canManage}
                            />
                            <div className="mt-1 text-xs text-gray-500">
                              {t('designer.form.triggerTypeHelp', {
                                defaultValue: 'Choose whether this workflow starts manually or from an event. Reusable schedules are managed in the Workflow Control Panel.',
                              })}
                            </div>
                          </div>

                          <div className="space-y-3">
                            {currentTriggerSelection === 'manual' && (
                              <div className="rounded border border-dashed border-gray-300 bg-gray-50 px-3 py-3 text-xs text-gray-600">
                                {t('designer.form.manualTriggerNote', {
                                  defaultValue: 'This workflow has no trigger. It can still be run manually and scheduled from the Workflow Control Panel once it has a pinned payload schema and a published version.',
                                })}
                              </div>
                            )}

                            {showEventConfiguration && (
                              <div className="space-y-2">
                                <div>
                                  <label htmlFor="workflow-designer-trigger-event-category" className="block text-sm font-medium text-gray-700 mb-1">
                                    {t('designer.form.eventCategoryLabel', { defaultValue: 'Event category' })}
                                  </label>
                                  {eventCatalogStatus === 'loading' ? (
                                    <Skeleton className="h-10 w-full" />
                                  ) : (
                                    <CustomSelect
                                      id="workflow-designer-trigger-event-category"
                                      value={selectedTriggerEventCategory}
                                      onValueChange={(value) => {
                                        const nextCategory = value.trim();
                                        setSelectedTriggerEventCategory(nextCategory);

                                        if (!selectedEventName) {
                                          return;
                                        }

                                        const currentCategory = selectedOption
                                          ? getWorkflowTriggerEventCategoryKey(selectedOption.category)
                                          : WORKFLOW_TRIGGER_EVENT_CATEGORY_KEY_UNKNOWN;

                                        if (nextCategory && currentCategory === nextCategory) {
                                          return;
                                        }

                                        setShowUseEventSchemaSuggestion(false);
                                        setPendingEventSchemaPrompt(null);
                                        handleDefinitionChange({ trigger: undefined });
                                      }}
                                      options={eventCategoryOptions}
                                      placeholder={t('designer.form.selectEventCategory', { defaultValue: 'Select event category' })}
                                      disabled={!canManage}
                                    />
                                  )}
                                </div>

                                <div>
                                  <label htmlFor="workflow-designer-trigger-event" className="block text-sm font-medium text-gray-700 mb-1">
                                    {t('designer.form.eventLabel', { defaultValue: 'Event' })}
                                  </label>
                                  {eventCatalogStatus === 'loading' ? (
                                    <Skeleton className="h-10 w-full" />
                                  ) : (
                                    <SearchableSelect
                                      id="workflow-designer-trigger-event"
                                      value={selectedEventName}
                                      onChange={(value) => {
                                        const next = value.trim();
                                        if (!next) {
                                          setShowUseEventSchemaSuggestion(false);
                                          setPendingEventSchemaPrompt(null);
                                          handleDefinitionChange({ trigger: undefined });
                                          return;
                                        }
                                        const chosen = eventCatalogOptions.find((e) => e.event_type === next) ?? null;
                                        if (chosen?.source === 'system' && (chosen.payload_schema_ref_status !== 'known' || !chosen.payload_schema_ref)) {
                                          toast.error(t('designer.toasts.systemEventMissingSchema', {
                                            defaultValue: 'This system event is missing a valid schema and cannot be selected until fixed.',
                                          }));
                                          return;
                                        }

                                        const chosenSchemaRef = typeof chosen?.payload_schema_ref === 'string' ? chosen.payload_schema_ref : '';
                                        const currentPayloadSchemaRef = activeDefinition?.payloadSchemaRef ?? '';
                                        const existing = activeDefinition?.trigger?.type === 'event' ? activeDefinition.trigger : undefined;
                                        const mapping = (existing as any)?.payloadMapping ?? {};
                                        const mappingProvided = mapping && typeof mapping === 'object' && Object.keys(mapping).length > 0;
                                        const hasIntentionalContractChoice =
                                          hasExplicitContractEdits ||
                                          mappingProvided ||
                                          (Boolean(currentPayloadSchemaRef) && currentPayloadSchemaRef !== EMPTY_WORKFLOW_PAYLOAD_SCHEMA_REF);
                                        const shouldAutoAdoptEventSchema =
                                          Boolean(chosenSchemaRef) &&
                                          !hasIntentionalContractChoice &&
                                          !mappingProvided &&
                                          currentPayloadSchemaRef === EMPTY_WORKFLOW_PAYLOAD_SCHEMA_REF;
                                        const shouldPromptForEventSchema =
                                          Boolean(chosenSchemaRef) &&
                                          hasIntentionalContractChoice &&
                                          chosenSchemaRef !== currentPayloadSchemaRef;

                                        setTriggerTypeSelection('event');
                                        if (chosen) {
                                          setSelectedTriggerEventCategory(getWorkflowTriggerEventCategoryKey(chosen.category));
                                        }
                                        handleDefinitionChange({ trigger: { ...(existing as any), type: 'event', eventName: next } });

                                        if (shouldAutoAdoptEventSchema && chosenSchemaRef) {
                                          applyWorkflowInputSchemaRef(chosenSchemaRef);
                                          return;
                                        }

                                        setShowUseEventSchemaSuggestion(true);
                                        setPendingEventSchemaPrompt(
                                          shouldPromptForEventSchema && chosenSchemaRef
                                            ? { eventName: next, schemaRef: chosenSchemaRef }
                                            : null
                                        );
                                      }}
                                      placeholder={selectedTriggerEventCategory
                                        ? t('designer.form.selectEvent', { defaultValue: 'Select event' })
                                        : t('designer.form.selectCategoryFirst', { defaultValue: 'Select category first' })}
                                      dropdownMode="overlay"
                                      options={eventOptions}
                                      disabled={eventPickerDisabled}
                                    />
                                  )}
                                </div>

                                {!selectedEventName && eventCatalogStatus !== 'loading' && (
                                  <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                                    {selectedTriggerEventCategory
                                      ? 'Select an event to finish configuring this trigger.'
                                      : 'Select a category, then choose an event to finish configuring this trigger.'}
                                  </div>
                                )}

                                {eventCatalogStatus === 'loading' && (
                                  <div className="rounded border border-gray-200 dark:border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))] px-3 py-2 space-y-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <Skeleton className="h-5 w-16 rounded-full" />
                                      <Skeleton className="h-5 w-16 rounded-full" />
                                      <Skeleton className="h-5 w-20 rounded-full" />
                                    </div>
                                    <Skeleton className="h-3 w-2/3" />
                                  </div>
                                )}

                                {selectedOption && (
                                  <div className="rounded border border-gray-200 dark:border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))] px-3 py-2 space-y-1">
                                    {selectedOption.description && (
                                      <div className="text-xs text-gray-600">{selectedOption.description}</div>
                                    )}
                                    {showTriggerSchemaDetails && (
                                      <div className="flex flex-wrap items-center justify-between gap-3">
                                        <div className="text-[11px] text-gray-600">
                                          <span className="text-gray-500">Catalog schema:</span>{' '}
                                          <span className="font-mono break-all">{selectedOption.payload_schema_ref ?? '—'}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <Button
                                            id="workflow-designer-trigger-event-view-catalog-schema"
                                            variant="ghost"
                                            size="sm"
                                            type="button"
                                            className="h-auto px-2 py-1 text-xs text-gray-600 hover:text-gray-800"
                                            onClick={() => {
                                              if (!selectedOption.payload_schema_ref) return;
                                              openSchemaModalForRef({ schemaRef: selectedOption.payload_schema_ref, title: 'Trigger event schema' });
                                            }}
                                            disabled={!selectedOption.payload_schema_ref}
                                          >
                                            View schema
                                          </Button>
                                          {triggerSourceSchemaRef && selectedOption.payload_schema_ref && triggerSourceSchemaRef !== selectedOption.payload_schema_ref && (
                                            <Button
                                              id="workflow-designer-trigger-event-view-effective-schema"
                                              variant="ghost"
                                              size="sm"
                                              type="button"
                                              className="h-auto px-2 py-1 text-xs text-gray-500 hover:text-gray-700"
                                              onClick={() => {
                                                openSchemaModalForRef({ schemaRef: triggerSourceSchemaRef, title: 'Effective trigger source schema' });
                                              }}
                                            >
                                              View effective
                                            </Button>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                    {eventCatalogStatus === 'loaded' && selectedOption.payload_schema_ref_status !== 'known' && (
                                      <div className="mt-2 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                                        This event is missing a valid schema reference. Publishing and running are disabled until it is fixed.
                                      </div>
                                    )}
                                  </div>
                                )}

                                {eventCatalogStatus === 'loaded' && !selectedOption && selectedEventName && (
                                  <div className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                                    Trigger event <span className="font-mono">{selectedEventName}</span> is not present in the event catalog. Publishing and running are disabled until it is fixed.
                                  </div>
                                )}

                                {eventCatalogStatus === 'error' && (
                                  <div className="text-xs text-destructive">
                                    Failed to load the event catalog. Publishing and running are disabled for event-triggered workflows until this loads.
                                  </div>
                                )}
                              </div>
                            )}

                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {contractSettingsExpanded && activeDefinition?.trigger?.type === 'event' && activeDefinition.trigger.eventName && (() => {
                    const mapping = (activeDefinition.trigger as any).payloadMapping ?? {};
                    const mappingProvided = mapping && typeof mapping === 'object' && Object.keys(mapping).length > 0;
                    const payloadRef = activeDefinition.payloadSchemaRef ?? '';
                    const refsMatch = !!triggerSourceSchemaRef && !!payloadRef && triggerSourceSchemaRef === payloadRef;
                    const mappingRequired = !!triggerSourceSchemaRef && !!payloadRef && !refsMatch;
                    const showEditor = mappingRequired || showTriggerMapping || mappingProvided;
                    const mappingErrors = triggerValidationErrors.filter((err) => err.stepPath.startsWith('root.trigger.payloadMapping'));
                    const mappingWarnings = triggerValidationWarnings.filter((warn) => warn.stepPath.startsWith('root.trigger.payloadMapping'));
                    const summaryMessage = mappingRequired
                      ? (mappingProvided
                        ? 'Custom trigger mapping is active.'
                        : 'Trigger mapping is required to run this workflow.')
                      : (mappingProvided
                        ? 'Optional trigger mapping is active.'
                        : 'Using trigger payload as workflow input.');

                    return (
                      <div className="mt-3 rounded border border-gray-200 dark:border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))] px-3 py-2">
                        <div className="text-xs font-semibold text-gray-800 dark:text-gray-200">Trigger summary</div>

                        <div className="mt-2 space-y-1 text-[11px] text-gray-600">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-gray-500">Trigger:</span>
                            <span className="font-mono break-all">{activeDefinition.trigger.eventName}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span>{summaryMessage}</span>
                            {mappingRequired ? (
                              <Badge variant="warning">Action needed</Badge>
                            ) : (
                              <Badge variant="success">No mapping needed</Badge>
                            )}
                          </div>
                        </div>

                        {!triggerSourceSchemaRef && (
                          <div className="mt-2 text-xs text-destructive">
                            No source schema available for this event yet. Add <code className="bg-destructive/10 px-1 rounded">payload_schema_ref</code> in the event catalog or set an override.
                          </div>
                        )}

                        {mappingRequired && !mappingProvided && (
                          <div className="mt-2 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                Mapping is required because trigger schema and workflow input schema do not match.
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                {showUseEventSchemaSuggestion && triggerSourceSchemaRef && (
                                  <Button
                                    id="workflow-designer-trigger-use-event-schema"
                                    variant="outline"
                                    size="sm"
                                    type="button"
                                    className="h-auto px-2 py-1 text-xs"
                                    onClick={handleUseEventSchemaForWorkflowInput}
                                  >
                                    Use event schema
                                  </Button>
                                )}
                                <Button
                                  id="workflow-designer-trigger-mapping-jump-to-contract"
                                  variant="ghost"
                                  size="sm"
                                  type="button"
                                  className="h-auto px-2 py-1 text-xs text-destructive hover:opacity-80"
                                  onClick={() => {
                                    setShowTriggerMapping(true);
                                  }}
                                >
                                  Configure mapping
                                </Button>
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="mt-3 space-y-3 border-t border-gray-200 pt-3">
                            <div>
                              <div className="text-xs font-semibold text-gray-800 dark:text-gray-200">Trigger source schema override</div>
                              <div className="mt-2">
                                <SearchableSelect
                                  id="workflow-designer-trigger-source-schema"
                                  options={(() => {
                                    const current = String((activeDefinition.trigger as any).sourcePayloadSchemaRef ?? '');
                                    const base = schemaRefs.map((ref) => {
                                      const meta = schemaMeta.get(ref);
                                      const title = meta?.title ? ` — ${meta.title}` : '';
                                      return { value: ref, label: `${ref}${title}` };
                                    });
                                    if (current && !schemaRefs.includes(current)) {
                                      return [{ value: current, label: `${current} (unknown)` }, ...base];
                                    }
                                    return [{ value: '', label: 'Use catalog schema (default)' }, ...base];
                                  })()}
                                  value={String((activeDefinition.trigger as any).sourcePayloadSchemaRef ?? '')}
                                  onChange={(value) => {
                                    const nextTrigger: any = { ...activeDefinition.trigger };
                                    if (!value) {
                                      delete nextTrigger.sourcePayloadSchemaRef;
                                    } else {
                                      nextTrigger.sourcePayloadSchemaRef = value;
                                    }
                                    setHasExplicitContractEdits(true);
                                    setShowUseEventSchemaSuggestion(true);
                                    handleDefinitionChange({ trigger: nextTrigger });
                                  }}
                                  placeholder="Use catalog schema…"
                                  emptyMessage="No schemas found"
                                  disabled={registryError || !canManage}
                                  dropdownMode="overlay"
                                />
                              </div>
                            </div>

                            <div>
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-xs font-semibold text-gray-800 dark:text-gray-200">Trigger mapping</div>
                                {!mappingRequired && (
                                  <Button
                                    id="workflow-designer-trigger-mapping-toggle"
                                    variant="ghost"
                                    size="sm"
                                    type="button"
                                    className="h-auto px-2 py-1 text-xs text-gray-500 hover:text-gray-700"
                                    onClick={() => setShowTriggerMapping((prev) => !prev)}
                                    disabled={!canManage}
                                  >
                                    {showEditor ? 'Hide mapping' : 'Show mapping'}
                                  </Button>
                                )}
                              </div>

                              {!showEditor && !mappingRequired && !mappingProvided && (
                                <div className="mt-2 text-xs text-gray-600">Mapping: Not required.</div>
                              )}

                              {(mappingErrors.length > 0 || mappingWarnings.length > 0) && (
                                <div className="mt-3 space-y-2">
                                  {mappingErrors.length > 0 && (
                                    <div className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                                      <div className="font-semibold mb-1">Mapping errors</div>
                                      <ul className="list-disc pl-4 space-y-1">
                                        {mappingErrors.slice(0, 5).map((err, idx) => (
                                          <li key={`${err.code}-${idx}`}>{err.message}</li>
                                        ))}
                                      </ul>
                                      {mappingErrors.length > 5 && (
                                        <div className="mt-1 text-[11px] opacity-80">+{mappingErrors.length - 5} more</div>
                                      )}
                                    </div>
                                  )}
                                  {mappingWarnings.length > 0 && (
                                    <div className="rounded border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
                                      <div className="font-semibold mb-1">Mapping warnings</div>
                                      <ul className="list-disc pl-4 space-y-1">
                                        {mappingWarnings.slice(0, 5).map((warn, idx) => (
                                          <li key={`${warn.code}-${idx}`}>{warn.message}</li>
                                        ))}
                                      </ul>
                                      {mappingWarnings.length > 5 && (
                                        <div className="mt-1 text-[11px] opacity-80">+{mappingWarnings.length - 5} more</div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}

                              {showEditor && (
                                <div className="mt-3">
                                  <p className="text-xs text-gray-500 mb-3">
                                    Map data from <code className="bg-gray-100 px-1 rounded">event.payload</code> to workflow input.
                                  </p>
                                  <MappingPanel
                                    value={mapping}
                                    onChange={(next) => {
                                      const nextTrigger: any = { ...activeDefinition.trigger };
                                      nextTrigger.payloadMapping = Object.keys(next).length > 0 ? next : undefined;
                                      setHasExplicitContractEdits(true);
                                      setShowUseEventSchemaSuggestion(false);
                                      handleDefinitionChange({ trigger: nextTrigger });
                                    }}
                                    targetFields={triggerMappingTargetFields}
                                    dataContext={triggerMappingDataContext as any}
                                    fieldOptions={triggerMappingFieldOptions}
                                    stepId={`trigger-${activeDefinition.id}`}
                                    disabled={!canManage}
                                    payloadRootPath="event.payload"
                                    expressionContextOverride={triggerMappingExpressionContext}
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                      </div>
                    );
                  })()}

                  <div id="workflow-designer-contract-section" className="mt-4">
                    <div>
                      <Label>{t('designer.form.inputDataLabel', { defaultValue: 'Workflow input data' })}</Label>
                      <div className="text-xs text-gray-500">
                        {activeDefinition?.trigger?.type === 'event' ? (
                          t('designer.form.inputDataEvent', { defaultValue: 'Your steps read data from the selected trigger.' })
                        ) : isTimeTrigger(activeDefinition?.trigger) ? (
                          <>
                            {t('designer.form.inputDataTimePrefix', {
                              defaultValue: 'This workflow receives a fixed synthetic clock payload. The contract is pinned to',
                            })}{' '}
                            <span className="font-mono">{WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF}</span>.
                          </>
                        ) : (
                          <>
                            {t('designer.form.inputDataManualPrefix', { defaultValue: 'No trigger uses' })}{' '}
                            <span className="font-mono">{EMPTY_WORKFLOW_PAYLOAD_SCHEMA_REF}</span>{' '}
                            {t('designer.form.inputDataManualSuffix', {
                              defaultValue: 'by default. Change it in Advanced schema settings if this workflow needs a different manual contract.',
                            })}
                          </>
                        )}
                      </div>
                      {activeDefinition?.trigger?.type === 'event' && triggerPayloadMappingInfo.mappingRequired && !contractSettingsExpanded && (
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-warning-foreground">
                          <span>
                            {t('designer.form.triggerMappingRequired', {
                              defaultValue: 'Trigger mapping is required. Open Advanced schema settings to configure it.',
                            })}
                          </span>
                          {showUseEventSchemaSuggestion && triggerSourceSchemaRef && !triggerPayloadMappingInfo.mappingProvided && (
                            <Button
                              id="workflow-designer-contract-use-event-schema"
                              variant="ghost"
                              size="sm"
                              type="button"
                              className="h-auto px-2 py-1 text-xs text-warning-foreground hover:opacity-80"
                              onClick={handleUseEventSchemaForWorkflowInput}
                            >
                              {t('designer.eventSchemaDialog.confirm', { defaultValue: 'Use event schema' })}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="mt-2 text-xs text-gray-700">
                      <span className="font-semibold text-gray-800">
                        {payloadSchemaModeDraft === 'pinned'
                          ? t('designer.form.schemaLocked', { defaultValue: 'Schema version locked' })
                          : t('designer.form.schemaAutoSelected', { defaultValue: 'Auto-selected from trigger' })}
                      </span>
                      <span className="text-gray-600">
                        {isTimeTrigger(activeDefinition?.trigger)
                          ? t('designer.form.schemaSuffixClock', { defaultValue: ' to the fixed clock payload contract.' })
                          : payloadSchemaModeDraft === 'pinned'
                          ? t('designer.form.schemaSuffixPinned', { defaultValue: ' to keep this workflow stable if trigger schemas change.' })
                          : '.'}
                      </span>

                      {payloadSchemaModeDraft === 'inferred' && inferredSchemaStatus === 'loading' && (
                        <div className="mt-2">
                          <Skeleton className="h-4 w-56" />
                        </div>
                      )}

                      {payloadSchemaModeDraft === 'inferred' && !effectivePayloadSchemaRef && inferredSchemaStatus !== 'loading' && (
                        <div className="mt-2 text-xs text-gray-500">
                          {t('designer.form.chooseTriggerHint', { defaultValue: 'Choose a trigger to define available fields.' })}
                        </div>
                      )}

                      {inferredSchemaStatus === 'error' && activeDefinition?.trigger?.type === 'event' && (
                        <div className="mt-2 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                          {t('designer.form.schemaLoadErrorPrefix', { defaultValue: 'We could not load schema information for' })}{' '}
                          <span className="font-mono">{activeDefinition.trigger.eventName}</span>.{' '}
                          {t('designer.form.schemaLoadErrorSuffix', { defaultValue: 'Check the event catalog entry.' })}
                        </div>
                      )}

                      {activeWorkflowRecord?.published_version != null &&
                        activeWorkflowRecord?.payload_schema_ref &&
                        effectivePayloadSchemaRef &&
                        activeWorkflowRecord.payload_schema_ref !== effectivePayloadSchemaRef && (
                        <div className="mt-2 rounded border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
                          <div className="font-semibold">
                            {t('designer.form.draftDifferent', { defaultValue: 'Draft contract differs from published' })}
                          </div>
                          <div className="mt-1 opacity-90">
                            {t('designer.form.publishedUsesPrefix', { defaultValue: 'The published version uses' })}{' '}
                            <span className="font-mono">{activeWorkflowRecord.payload_schema_ref}</span>.{' '}
                            {t('designer.form.draftResolvesTo', { defaultValue: 'This draft currently resolves to' })}{' '}
                            <span className="font-mono">{effectivePayloadSchemaRef}</span>.
                          </div>
                          {canManage && (
                            <div className="mt-2">
                              <Button
                                id="workflow-designer-pin-to-published-contract"
                                variant="outline"
                                size="sm"
                                type="button"
                                onClick={() => {
                                  setPayloadSchemaModeDraft('pinned');
                                  setSchemaInferenceEnabled(false);
                                  setSchemaRefAdvanced(false);
                                  setContractSettingsExpanded(true);
                                  setPinnedPayloadSchemaRefDraft(activeWorkflowRecord.payload_schema_ref ?? '');
                                  if (activeDefinition?.payloadSchemaRef !== activeWorkflowRecord.payload_schema_ref) {
                                    handleDefinitionChange({ payloadSchemaRef: activeWorkflowRecord.payload_schema_ref });
                                  }
                                }}
                              >
                                {t('designer.form.lockToPublished', { defaultValue: 'Lock to published contract' })}
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {!contractSettingsExpanded && (
                      <div className="mt-2 flex justify-end">
                        <Button
                          id="workflow-designer-contract-advanced-toggle"
                          variant="ghost"
                          size="sm"
                          type="button"
                          className="h-auto px-2 py-1 text-xs text-gray-500 hover:text-gray-700"
                          onClick={() => setContractSettingsExpanded(true)}
                        >
                          {t('designer.form.advancedSchemaSettings', { defaultValue: 'Advanced schema settings' })}
                        </Button>
                      </div>
                    )}

                    {contractSettingsExpanded && (
                      <div id="workflow-designer-contract-advanced-panel" className="mt-2 rounded border border-gray-200 bg-gray-50 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-xs font-semibold text-gray-800 dark:text-gray-200">Lock schema version</div>
                            <div className="text-xs text-gray-500">
                              {isTimeTrigger(activeDefinition?.trigger)
                                ? 'Clock triggers always stay pinned to the fixed workflow clock contract.'
                                : 'Lock schema version to prevent future trigger changes from affecting this workflow.'}
                            </div>
                          </div>
                          <Switch
                            id="workflow-designer-contract-mode"
                            checked={payloadSchemaModeDraft === 'pinned'}
                            onCheckedChange={(checked) => {
                              if (!activeDefinition) return;
                              if (checked) {
                                try {
                                  analytics.capture('workflow.payload_contract_mode.changed', {
                                    workflowId: activeWorkflowId ?? activeDefinition?.id ?? null,
                                    from: 'inferred',
                                    to: 'pinned'
                                  });
                                } catch {}
                                setPayloadSchemaModeDraft('pinned');
                                setSchemaInferenceEnabled(false);
                                setHasExplicitContractEdits(true);
                                setShowUseEventSchemaSuggestion(false);
                                const pinned = pinnedPayloadSchemaRefDraft || activeDefinition.payloadSchemaRef || '';
                                if (pinned) {
                                  setPinnedPayloadSchemaRefDraft(pinned);
                                  if (activeDefinition.payloadSchemaRef !== pinned) {
                                    handleDefinitionChange({ payloadSchemaRef: pinned });
                                  }
                                }
                                return;
                              }
                              // inferred
                              try {
                                analytics.capture('workflow.payload_contract_mode.changed', {
                                  workflowId: activeWorkflowId ?? activeDefinition?.id ?? null,
                                  from: 'pinned',
                                  to: 'inferred'
                                });
                              } catch {}
                              setPayloadSchemaModeDraft('inferred');
                              setSchemaInferenceEnabled(true);
                              setSchemaRefAdvanced(false);
                              setHasExplicitContractEdits(true);
                              setShowUseEventSchemaSuggestion(false);
                              setPinnedPayloadSchemaRefDraft(activeDefinition.payloadSchemaRef ?? pinnedPayloadSchemaRefDraft ?? '');
                              lastAppliedInferredRef.current = null;
                              if (inferredSchemaRef && activeDefinition.payloadSchemaRef !== inferredSchemaRef) {
                                handleDefinitionChange({ payloadSchemaRef: inferredSchemaRef });
                              }
                            }}
                            disabled={!canManage || isTimeTrigger(activeDefinition?.trigger)}
                          />
                        </div>

                        {payloadSchemaModeDraft === 'pinned' ? (
                          <>
                            <div className="mt-3 text-xs text-gray-600">Locked schema version</div>
                            <div className="mt-2">
                              {registryStatus === 'loading' ? (
                                <Skeleton className="h-10 w-full" />
                              ) : (
                                <SearchableSelect
                                  id="workflow-designer-schema-ref-select"
                                  options={(() => {
                                    const current = activeDefinition?.payloadSchemaRef ?? '';
                                    const base = schemaRefs.map((ref) => {
                                      const meta = schemaMeta.get(ref);
                                      const title = meta?.title ? ` — ${meta.title}` : '';
                                      return { value: ref, label: `${ref}${title}` };
                                    });
                                    if (current && !schemaRefs.includes(current)) {
                                      return [{ value: current, label: `${current} (unknown)` }, ...base];
                                    }
                                    return base;
                                  })()}
                                  value={activeDefinition?.payloadSchemaRef ?? ''}
                                  onChange={(value) => {
                                    if (isTimeTrigger(activeDefinition?.trigger)) return;
                                    setPinnedPayloadSchemaRefDraft(value);
                                    setHasExplicitContractEdits(true);
                                    setShowUseEventSchemaSuggestion(false);
                                    analytics.capture('workflow.payload_schema_ref.selected', {
                                      schemaRef: value || null,
                                      workflowId: activeWorkflowId ?? activeDefinition?.id ?? null,
                                      inferenceEnabled: false,
                                      triggerEvent: activeDefinition?.trigger?.type === 'event' ? activeDefinition.trigger.eventName : null
                                    });
                                    handleDefinitionChange({ payloadSchemaRef: value });
                                  }}
                                  placeholder="Select schema version…"
                                  emptyMessage="No schemas found"
                                  disabled={registryError || !canManage || isTimeTrigger(activeDefinition?.trigger)}
                                  required
                                  dropdownMode="overlay"
                                />
                              )}
                            </div>

                            <div className="mt-2 flex items-center justify-between">
                              <div className="text-xs text-gray-600">Manual schema ref</div>
                              {isTimeTrigger(activeDefinition?.trigger) ? (
                                <span className="text-[11px] text-gray-500">Fixed for time triggers</span>
                              ) : (
                                <Button
                                  id="workflow-designer-schema-advanced"
                                  variant="ghost"
                                  size="sm"
                                  type="button"
                                  className="h-auto px-2 py-1 text-xs text-gray-500 hover:text-gray-700"
                                  onClick={() => setSchemaRefAdvanced((prev) => !prev)}
                                >
                                  {schemaRefAdvanced ? 'Hide' : 'Edit'}
                                </Button>
                              )}
                            </div>
                            {schemaRefAdvanced && !isTimeTrigger(activeDefinition?.trigger) && (
                              <div className="mt-2">
                                <Input
                                  id="workflow-designer-schema"
                                  label="Payload schema ref (advanced)"
                                  value={activeDefinition?.payloadSchemaRef ?? ''}
                                  onChange={(event) => {
                                    setPinnedPayloadSchemaRefDraft(event.target.value);
                                    setHasExplicitContractEdits(true);
                                    setShowUseEventSchemaSuggestion(false);
                                    handleDefinitionChange({ payloadSchemaRef: event.target.value });
                                  }}
                                  disabled={!canManage}
                                />
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="mt-3 text-xs text-gray-600">
                            {effectivePayloadSchemaRef ? (
                              <>
                                {t('designer.form.inferredSchemaPrefix', { defaultValue: 'Current inferred schema:' })}
                                <span className="ml-1 font-mono break-all">{effectivePayloadSchemaRef}</span>
                              </>
                            ) : (
                              t('designer.form.noSchemaInferred', { defaultValue: 'No schema inferred yet.' })
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {effectivePayloadSchemaRef &&
                      schemaRefs.length > 0 &&
                      !schemaRefs.includes(effectivePayloadSchemaRef) && (
                      <div className="mt-2 flex items-center justify-between gap-3 text-xs text-destructive">
                        <div>
                          {t('designer.form.unknownSchemaRef', {
                            defaultValue: 'Unknown schema ref. Open Advanced schema settings and choose a valid schema version.',
                          })}
                        </div>
                        {canManage && (
                          <Button
                            id="workflow-designer-schema-clear"
                            variant="ghost"
                            size="sm"
                            type="button"
                            className="h-auto px-2 py-1 text-xs text-destructive hover:text-destructive"
                            onClick={() => {
                              if (isTimeTrigger(activeDefinition?.trigger)) return;
                              if (payloadSchemaModeDraft === 'pinned') {
                                setPinnedPayloadSchemaRefDraft('');
                                handleDefinitionChange({ payloadSchemaRef: '' });
                              }
                            }}
                          >
                            Clear
                          </Button>
                        )}
                      </div>
                    )}

                    {contractSettingsExpanded && effectivePayloadSchemaRef && (
                      <div className="mt-3 rounded border border-gray-200 bg-gray-50 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-xs font-semibold text-gray-700">Available fields preview</div>
                          <div className="flex items-center gap-2">
                            <Button
                              id="workflow-designer-schema-preview-toggle"
                              variant="ghost"
                              size="sm"
                              type="button"
                              className="h-auto px-2 py-1 text-xs text-gray-600 hover:text-gray-800"
                              onClick={() => setSchemaPreviewExpanded((prev) => !prev)}
                            >
                              {schemaPreviewExpanded ? 'Hide fields' : 'Preview fields'}
                            </Button>
                            <Button
                              id="workflow-designer-schema-view"
                              variant="ghost"
                              size="sm"
                              type="button"
                              className="h-auto px-2 py-1 text-xs text-gray-600 hover:text-gray-800"
                              onClick={() => {
                                setShowSchemaModal(true);
                              }}
                              disabled={
                                schemaRefs.length > 0 &&
                                effectivePayloadSchemaRef
                                  ? !schemaRefs.includes(effectivePayloadSchemaRef)
                                  : false
                              }
                            >
                              View JSON schema
                            </Button>
                            {activeWorkflowRecord?.published_version != null && (
                              <Button
                                id="workflow-designer-schema-view-published"
                                variant="ghost"
                                size="sm"
                                type="button"
                                className="h-auto px-2 py-1 text-xs text-gray-500 hover:text-gray-700"
                                onClick={() => void openPublishedContractModal()}
                              >
                                View published
                              </Button>
                            )}
                          </div>
                        </div>
                        {schemaPreviewExpanded && (
                          <div id="workflow-designer-schema-preview-content" className="mt-2 text-xs text-gray-600">
                            {payloadSchemaStatus === 'loading' && 'Loading schema…'}
                            {payloadSchemaStatus === 'error' && 'Failed to load schema preview.'}
                            {payloadSchemaStatus === 'idle' && 'Schema preview is available once loaded.'}
                            {payloadSchemaStatus === 'loaded' && payloadSchema && (() => {
                              const props = (payloadSchema as any)?.properties ?? null;
                              if (!props || typeof props !== 'object') return 'No top-level properties.';
                              const keys = Object.keys(props);
                              if (keys.length === 0) return 'No top-level properties.';
                              const shown = keys.slice(0, 8);
                              return (
                                <div className="flex flex-wrap gap-1">
                                  {shown.map((k) => (
                                    <span key={k} className="rounded bg-white dark:bg-gray-800 px-2 py-0.5 border border-gray-200 dark:border-[rgb(var(--color-border-200))]">
                                      {k}
                                    </span>
                                  ))}
                                  {keys.length > shown.length && (
                                    <span className="text-gray-500">+{keys.length - shown.length} more</span>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    )}

                    {contractSettingsExpanded && (
                      <div className="mt-2 flex justify-end">
                        <Button
                          id="workflow-designer-contract-advanced-toggle"
                          variant="ghost"
                          size="sm"
                          type="button"
                          className="h-auto px-2 py-1 text-xs text-gray-500 hover:text-gray-700"
                          onClick={() => setContractSettingsExpanded(false)}
                        >
                          Hide advanced schema settings
                        </Button>
                      </div>
                    )}
                  </div>
                </Card>

                {showSchemaModal && effectivePayloadSchemaRef && createPortal(
                  <div
                    className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-6"
                    role="dialog"
                    aria-modal="true"
                    onMouseDown={(e) => {
                      if (e.target === e.currentTarget) setShowSchemaModal(false);
                    }}
                  >
                    <div className="w-full max-w-3xl rounded-lg bg-white dark:bg-[rgb(var(--color-card))] shadow-xl border border-gray-200 dark:border-[rgb(var(--color-border-200))] overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Workflow payload contract schema</div>
                        <Button
                          id="workflow-designer-schema-modal-close"
                          variant="ghost"
                          size="sm"
                          type="button"
                          onClick={() => setShowSchemaModal(false)}
                        >
                          Close
                        </Button>
                      </div>
                      <div className="px-4 py-2 border-b border-gray-200 dark:border-[rgb(var(--color-border-200))] bg-gray-50 dark:bg-[rgb(var(--color-background))]">
                        <div className="text-[11px] text-gray-600">
                          <span className="text-gray-500">Schema ref:</span>{' '}
                          <span className="font-mono break-all">{effectivePayloadSchemaRef}</span>
                          <span className="text-gray-400"> · </span>
                          <span className="text-gray-500">Mode:</span>{' '}
                          <span className="font-semibold">{payloadSchemaModeDraft === 'pinned' ? 'Pinned' : 'Inferred'}</span>
                        </div>
                      </div>
                      <div className="max-h-[70vh] overflow-auto p-4">
                        {payloadSchemaStatus === 'loading' && (
                          <div className="text-xs text-gray-500">Loading schema…</div>
                        )}
                        {payloadSchemaStatus === 'error' && (
                          <div className="text-xs text-destructive">Failed to load schema.</div>
                        )}
                        {payloadSchemaStatus === 'loaded' && payloadSchema && (
                          <pre
                            className="text-[11px] leading-relaxed font-mono whitespace-pre break-words rounded border border-gray-200 bg-gray-50 p-3"
                            dangerouslySetInnerHTML={{
                              __html: syntaxHighlightJson(JSON.stringify(payloadSchema, null, 2))
                            }}
                          />
                        )}
                        {payloadSchemaStatus === 'idle' && (
                          <div className="text-xs text-gray-500">Schema not loaded yet.</div>
                        )}
                      </div>
                    </div>
                  </div>,
                  document.body
                )}

                {showTriggerSchemaModal && triggerSchemaModalRef && createPortal(
                  <div
                    className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-6"
                    role="dialog"
                    aria-modal="true"
                    onMouseDown={(e) => {
                      if (e.target === e.currentTarget) setShowTriggerSchemaModal(false);
                    }}
                  >
                    <div className="w-full max-w-3xl rounded-lg bg-white dark:bg-[rgb(var(--color-card))] shadow-xl border border-gray-200 dark:border-[rgb(var(--color-border-200))] overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{triggerSchemaModalTitle}</div>
                        <Button
                          id="workflow-designer-trigger-schema-modal-close"
                          variant="ghost"
                          size="sm"
                          type="button"
                          onClick={() => setShowTriggerSchemaModal(false)}
                        >
                          Close
                        </Button>
                      </div>
                      <div className="px-4 py-2 border-b border-gray-200 dark:border-[rgb(var(--color-border-200))] bg-gray-50 dark:bg-[rgb(var(--color-background))]">
                        <div className="text-[11px] text-gray-600">
                          <span className="text-gray-500">Schema ref:</span>{' '}
                          <span className="font-mono break-all">{triggerSchemaModalRef}</span>
                        </div>
                      </div>
                      <div className="max-h-[70vh] overflow-auto p-4">
                        {triggerSchemaModalStatus === 'loading' && (
                          <div className="text-xs text-gray-500">Loading schema…</div>
                        )}
                        {triggerSchemaModalStatus === 'error' && (
                          <div className="text-xs text-destructive">Failed to load schema.</div>
                        )}
                        {triggerSchemaModalStatus === 'loaded' && triggerSchemaModalSchema && (
                          <pre
                            className="text-[11px] leading-relaxed font-mono whitespace-pre break-words rounded border border-gray-200 bg-gray-50 p-3"
                            dangerouslySetInnerHTML={{
                              __html: syntaxHighlightJson(JSON.stringify(triggerSchemaModalSchema, null, 2))
                            }}
                          />
                        )}
                        {triggerSchemaModalStatus === 'idle' && (
                          <div className="text-xs text-gray-500">Schema not loaded yet.</div>
                        )}
                      </div>
                    </div>
                  </div>,
                  document.body
                )}

                {showPublishedContractModal && createPortal(
                  <div
                    className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-6"
                    role="dialog"
                    aria-modal="true"
                    onMouseDown={(e) => {
                      if (e.target === e.currentTarget) setShowPublishedContractModal(false);
                    }}
                  >
                    <div className="w-full max-w-3xl rounded-lg bg-white dark:bg-[rgb(var(--color-card))] shadow-xl border border-gray-200 dark:border-[rgb(var(--color-border-200))] overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                          Published contract schema{publishedContractModalVersion ? ` (v${publishedContractModalVersion})` : ''}
                        </div>
                        <Button
                          id="workflow-designer-published-contract-modal-close"
                          variant="ghost"
                          size="sm"
                          type="button"
                          onClick={() => setShowPublishedContractModal(false)}
                        >
                          Close
                        </Button>
                      </div>
                      <div className="max-h-[70vh] overflow-auto p-4">
                        {publishedContractModalStatus === 'loading' && (
                          <div className="text-xs text-gray-500">Loading schema…</div>
                        )}
                        {publishedContractModalStatus === 'error' && (
                          <div className="text-xs text-destructive">
                            {publishedContractModalError ?? 'Failed to load published schema.'}
                          </div>
                        )}
                        {publishedContractModalStatus === 'loaded' && publishedContractModalSchema && (
                          <>
                            <div className="mb-3 text-[11px] text-gray-500">
                              {publishedContractModalSource === 'registry'
                                ? 'Published schema snapshot missing; showing current schema registry output.'
                                : 'Published schema snapshot.'}
                            </div>
                            <pre
                              className="text-[11px] leading-relaxed font-mono whitespace-pre break-words rounded border border-gray-200 bg-gray-50 p-3"
                              dangerouslySetInnerHTML={{
                                __html: syntaxHighlightJson(JSON.stringify(publishedContractModalSchema, null, 2))
                              }}
                            />
                          </>
                        )}
                        {publishedContractModalStatus === 'idle' && (
                          <div className="text-xs text-gray-500">Schema not loaded yet.</div>
                        )}
                      </div>
                    </div>
                  </div>,
                  document.body
                )}

                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                        {t('designer.form.workflowStepsHeading', { defaultValue: 'Workflow Steps' })}
                      </h2>
                      <p className="text-sm text-gray-500">
                        {stepsViewMode === 'list'
                          ? t('designer.form.workflowStepsListHint', { defaultValue: 'Drag steps to reorder or move between pipes.' })
                          : t('designer.form.workflowStepsGraphHint', { defaultValue: 'Pan/zoom the graph. Branches render as separate lanes.' })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <ViewSwitcher
                        aria-label={t('designer.form.workflowStepsViewAria', { defaultValue: 'Workflow steps view' })}
                        currentView={stepsViewMode}
                        onChange={(v) => setStepsViewMode(v as 'list' | 'graph')}
                        options={workflowCanvasViewOptions}
                      />
                      {publishWarnings.length > 0 && (
                        <Badge variant="warning">
                          {t('designer.form.warningsCount', {
                            defaultValue: '{{count}} warnings',
                            count: publishWarnings.length,
                          })}
                        </Badge>
                      )}
                    </div>
                  </div>
                  {stepsViewMode === 'graph' ? (
                    <div className="h-[650px] rounded border border-gray-200 dark:border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))] overflow-hidden">
                      <WorkflowGraph
                        steps={(activeDefinition?.steps ?? []) as Step[]}
                        getLabel={(step) => getStepLabel(step as Step, nodeRegistryMap, designerActionCatalog, t)}
                        getSubtitle={(step) => getGraphSubtitle(step as Step) ?? (step as Step).type}
                        inputMappingStatusByStepId={actionInputMappingStatusByStepId}
                        selectedStepId={selectedStepId}
                        onSelectStepId={setSelectedStepId}
                        editable={canManage}
                        rootPipePath="root"
                        onRequestInsertAt={canManage ? handleInsertStep : undefined}
                        onDeleteStepId={canManage ? handleDeleteStep : undefined}
                        className="h-full"
                      />
                    </div>
                  ) : (
                    <Pipe
                      steps={activeDefinition?.steps ?? []}
                      pipePath="root"
                      stepPathPrefix="root"
                      actionInputMappingStatusByStepId={actionInputMappingStatusByStepId}
                      selectedStepId={selectedStepId}
                      onSelectStep={setSelectedStepId}
                      onDeleteStep={handleDeleteStep}
                      onDuplicateStep={handleDuplicateStep}
                      onSelectPipe={handlePipeSelect}
                      onPipeHover={handlePipeHover}
                      onInsertStep={(index) => handleInsertStep('root', index)}
                      onInsertAtPath={handleInsertStep}
                      nodeRegistry={nodeRegistryMap}
                      designerActionCatalog={designerActionCatalog}
                      errorMap={errorsByStepId}
                      isRoot={true}
                      disabled={!canManage}
                    />
                  )}
                </div>
                  </>
                )}
              </div>
            </div>
      </div>

    </div>
    </DragDropContext>
  );

  const runListContent = (
    <WorkflowRunList
      definitions={definitions.map((definition) => ({
        workflow_id: definition.workflow_id,
        name: definition.name,
        trigger: definition.trigger ?? null,
        schedule_state: definition.schedule_state ?? null,
        payload_schema_ref: definition.payload_schema_ref,
        published_version: definition.published_version ?? null,
        validation_status: definition.validation_status ?? null,
        is_paused: definition.is_paused ?? false,
        concurrency_limit: definition.concurrency_limit ?? null,
        is_system: definition.is_system ?? false
      }))}
      workflowStatusById={runStatusByWorkflow}
      workflowRunCountById={runCountByWorkflow}
      isActive={activeTab === 'runs'}
      canAdmin={canAdmin}
      canManage={canManage}
    />
  );

  const eventListContent = (
    <WorkflowEventList
      isActive={activeTab === 'events'}
      canAdmin={canAdmin}
    />
  );

  const deadLetterContent = (
    <WorkflowDeadLetterQueue
      isActive={activeTab === 'dead-letter'}
      canAdmin={canAdmin}
    />
  );

  const workflowListContent = (
    <WorkflowListV2
      onSelectWorkflow={(workflowId) => {
        router.push(`/msp/workflow-editor/${encodeURIComponent(workflowId)}`);
      }}
      onOpenEventCatalog={() => {
        router.push('/msp/workflow-control?section=event-catalog');
      }}
      onCreateNew={() => {
        requestDiscardChangesConfirmation(() => {
          router.push('/msp/workflow-editor/new');
        });
      }}
    />
  );

  const eventCatalogContent = (
    <div className="h-full min-h-0 overflow-y-auto px-6 py-4">
      <EventsCatalogV2 pickerActions={workflowPickerActions} />
    </div>
  );
  const schedulesContent = (
    <div className="h-full min-h-0 overflow-y-auto px-6 py-4">
      <WorkflowSchedules />
    </div>
  );
  const isControlPanelMode = mode === 'control-panel';
  const isEditorDesignerMode = mode === 'editor-designer';

  const controlPanelTabs = [
    { id: 'schedules', label: t('designer.controlPanel.tabs.schedules', { defaultValue: 'Schedules' }), content: schedulesContent },
    { id: 'runs', label: t('designer.controlPanel.tabs.runs', { defaultValue: 'Runs' }), content: runListContent },
    { id: 'events', label: t('designer.controlPanel.tabs.events', { defaultValue: 'Events' }), content: eventListContent },
    { id: 'event-catalog', label: t('designer.controlPanel.tabs.eventCatalog', { defaultValue: 'Event Catalog' }), content: eventCatalogContent },
    ...(canAdmin ? [{ id: 'dead-letter', label: t('designer.controlPanel.tabs.deadLetter', { defaultValue: 'Dead Letter' }), content: deadLetterContent }] : [])
  ];

  const pageTitle =
    isControlPanelMode
      ? t('designer.page.controlPanelTitle', { defaultValue: 'Workflow Control Panel' })
      : isEditorDesignerMode
        ? t('designer.page.designerTitle', { defaultValue: 'Workflow Designer' })
        : t('designer.page.editorTitle', { defaultValue: 'Workflow Editor' });

  const pageDescription =
    isControlPanelMode
      ? t('designer.page.controlPanelDescription', { defaultValue: 'Manage schedules, runs, events, and the event catalog.' })
      : isEditorDesignerMode
        ? t('designer.page.designerDescription', { defaultValue: 'Build and maintain workflow automations.' })
        : t('designer.page.editorDescription', { defaultValue: 'Choose a workflow to edit or create a new workflow.' });

  const handleBackToWorkflowList = useCallback(() => {
    requestDiscardChangesConfirmation(() => {
      router.push('/msp/workflow-editor');
    });
  }, [requestDiscardChangesConfirmation, router]);

  const designerContentKey = useMemo(() => {
    if (activeWorkflowId) {
      return `workflow-${activeWorkflowId}`;
    }
    if (requestedNewWorkflow) {
      return `new-${activeDefinition?.id ?? 'empty'}`;
    }
    return `draft-${activeDefinition?.id ?? 'empty'}`;
  }, [activeDefinition?.id, activeWorkflowId, requestedNewWorkflow]);

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="border-b bg-white dark:bg-[rgb(var(--color-card))] px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            {isEditorDesignerMode && (
              <Button
                id="workflow-designer-back-to-list"
                variant="ghost"
                size="sm"
                className="mb-2 px-0"
                onClick={handleBackToWorkflowList}
              >
                <ChevronRight className="mr-1 h-4 w-4 rotate-180" />
                {t('designer.toolbar.backToList', { defaultValue: 'Back to workflows' })}
              </Button>
            )}
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{pageTitle}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">{pageDescription}</p>
          </div>
          {isEditorDesignerMode && (
            <div className="flex items-center gap-2">
              {activeWorkflowRecord && (
                <span
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border text-xs font-medium ${workflowValidationBadge.className}`}
                  title={activeWorkflowRecord.validated_at
                    ? t('designer.toolbar.validation.lastValidated', {
                      defaultValue: 'Last validated: {{timestamp}}',
                      timestamp: activeWorkflowRecord.validated_at,
                    })
                    : t('designer.toolbar.validation.unknown', { defaultValue: 'Validation status unknown' })}
                >
                  {workflowValidationBadge.label}
                  {currentValidationErrors.length > 0 && <span>({currentValidationErrors.length})</span>}
                </span>
              )}
              {canManage && (
                <Button
                  id="workflow-designer-create"
                  variant="secondary"
                  onClick={() => requestDiscardChangesConfirmation(() => router.push('/msp/workflow-editor/new'))}
                >
                  {t('designer.toolbar.newWorkflow', { defaultValue: 'New Workflow' })}
                </Button>
              )}
              {canManage && (
                <Button
                  id="workflow-designer-save"
                  onClick={handleSaveDefinition}
                  disabled={isSaving || !activeDefinition}
                >
                  {isSaving
                    ? t('designer.toolbar.saving', { defaultValue: 'Saving...' })
                    : t('designer.toolbar.saveDraft', { defaultValue: 'Save Draft' })}
                </Button>
              )}
              {(canPublishPermission) && (
                <Button
                  id="workflow-designer-publish"
                  onClick={handlePublish}
                  disabled={isPublishing || !activeDefinition || !canPublishEnabled}
                  title={!canPublishEnabled ? publishDisabledReason || undefined : undefined}
                >
                  {isPublishing
                    ? t('designer.toolbar.publishing', { defaultValue: 'Publishing...' })
                    : t('designer.toolbar.publish', { defaultValue: 'Publish' })}
                </Button>
              )}
              {(canRunPermission) && (
                <Button
                  id="workflow-designer-run"
                  onClick={openRunDialog}
                  disabled={
                    !activeDefinition
                    || !activeWorkflowId
                    || activeWorkflowRecord?.is_paused
                    || !canRunEnabled
                  }
                  title={
                    !canRunEnabled ? runDisabledReason || undefined
                      : !activeWorkflowRecord?.published_version
                        ? t('designer.toolbar.previewOnly', { defaultValue: 'Preview only until a version is published.' })
                        : undefined
                  }
                >
                  {t('designer.toolbar.run', { defaultValue: 'Run' })}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <WorkflowRunDialog
        isOpen={showRunDialog}
        onClose={() => setShowRunDialog(false)}
        workflowId={activeWorkflowId}
        workflowName={activeWorkflowRecord?.name ?? activeDefinition?.name ?? ''}
        triggerLabel={activeDefinition?.trigger?.type === 'event' && activeDefinition.trigger.eventName
          ? t('trigger.eventWithType', { defaultValue: 'Event: {{eventType}}', eventType: activeDefinition.trigger.eventName })
          : activeDefinition?.trigger?.type === 'schedule'
            ? t('trigger.oneTimeSchedule', { defaultValue: 'One-time schedule' })
            : activeDefinition?.trigger?.type === 'recurring'
              ? t('trigger.recurringSchedule', { defaultValue: 'Recurring schedule' })
              : t('trigger.manual', { defaultValue: 'Manual' })}
        triggerEventName={activeDefinition?.trigger?.type === 'event' ? activeDefinition.trigger.eventName : null}
        triggerSourcePayloadSchemaRef={triggerSourceSchemaRef}
        triggerPayloadMappingProvided={triggerPayloadMappingInfo.mappingProvided}
        triggerPayloadMappingRequired={triggerPayloadMappingInfo.mappingRequired}
        payloadSchemaRef={activeDefinition?.payloadSchemaRef ?? activeWorkflowRecord?.payload_schema_ref ?? null}
        publishedVersion={activeWorkflowRecord?.published_version ?? null}
        draftVersion={activeDefinition?.version ?? null}
        isSystem={activeWorkflowRecord?.is_system ?? false}
        isPaused={activeWorkflowRecord?.is_paused ?? false}
        concurrencyLimit={activeWorkflowRecord?.concurrency_limit ?? null}
        canPublish={canPublishPermission}
        onPublishDraft={handlePublish}
      />

      <ConfirmationDialog
        id="workflow-designer-discard-changes-dialog"
        isOpen={showDiscardChangesDialog}
        onClose={closeDiscardChangesDialog}
        onConfirm={handleConfirmDiscardChanges}
        title={t('designer.discardDialog.title', { defaultValue: 'Discard unsaved changes?' })}
        message={t('designer.discardDialog.message', {
          defaultValue: 'You have unsaved changes in this workflow. Discard them and continue?',
        })}
        confirmLabel={t('designer.discardDialog.confirm', { defaultValue: 'Discard changes' })}
        cancelLabel={t('designer.discardDialog.cancel', { defaultValue: 'Keep editing' })}
      />

      <ConfirmationDialog
        id="workflow-designer-event-schema-adoption-dialog"
        isOpen={pendingEventSchemaPrompt !== null}
        onClose={() => setPendingEventSchemaPrompt(null)}
        onConfirm={() => {
          if (!pendingEventSchemaPrompt) return;
          setHasExplicitContractEdits(true);
          applyWorkflowInputSchemaRef(pendingEventSchemaPrompt.schemaRef);
        }}
        title={t('designer.eventSchemaDialog.title', { defaultValue: 'Switch workflow input schema?' })}
        message={pendingEventSchemaPrompt
          ? t('designer.eventSchemaDialog.messageWithEvent', {
            defaultValue: 'The selected event {{eventName}} uses {{schemaRef}}. Do you want to switch this workflow to that event schema?',
            eventName: pendingEventSchemaPrompt.eventName,
            schemaRef: pendingEventSchemaPrompt.schemaRef,
          })
          : t('designer.eventSchemaDialog.messageFallback', {
            defaultValue: 'Do you want to switch this workflow to the selected event schema?',
          })}
        confirmLabel={t('designer.eventSchemaDialog.confirm', { defaultValue: 'Use event schema' })}
        cancelLabel={t('designer.eventSchemaDialog.cancel', { defaultValue: 'Keep current schema' })}
      />

      <div className="flex-1 min-h-0 overflow-hidden">
        {isControlPanelMode ? (
          <CustomTabs
            idPrefix="workflow-control-tabs"
            value={activeTab}
            onTabChange={handleControlPanelTabChange}
            tabs={controlPanelTabs}
            tabStyles={{
              root: 'h-full min-h-0 flex flex-col',
              content: 'flex-1 min-h-0 overflow-hidden',
              list: 'px-6 bg-white dark:bg-[rgb(var(--color-card))] border-b border-gray-200 dark:border-[rgb(var(--color-border-200))] mb-0'
            }}
          />
        ) : isEditorDesignerMode ? (
          <React.Fragment key={designerContentKey}>{designerContent}</React.Fragment>
        ) : (
          workflowListContent
        )}
      </div>
    </div>
  );
};

const Pipe: React.FC<{
  steps: Step[];
  pipePath: string;
  stepPathPrefix: string;
  actionInputMappingStatusByStepId: Map<string, ActionInputMappingStatus>;
  selectedStepId: string | null;
  onSelectStep: (id: string) => void;
  onDeleteStep: (id: string) => void;
  onDuplicateStep: (id: string) => void;
  onSelectPipe: (pipePath: string) => void;
  onPipeHover: (pipePath: string) => void;
  onInsertStep?: (index: number) => void;
  onInsertAtPath?: (pipePath: string, index: number) => void;
  nodeRegistry: Record<string, NodeRegistryItem>;
  designerActionCatalog?: WorkflowDesignerCatalogRecord[];
  errorMap: Map<string, PublishError[]>;
  isRoot?: boolean;
  disabled?: boolean;
}> = ({
  steps,
  pipePath,
  stepPathPrefix,
  actionInputMappingStatusByStepId,
  selectedStepId,
  onSelectStep,
  onDeleteStep,
  onDuplicateStep,
  onSelectPipe,
  onPipeHover,
  onInsertStep,
  onInsertAtPath,
  nodeRegistry,
  designerActionCatalog,
  errorMap,
  isRoot = false,
  disabled = false
}) => {
  const { t } = useTranslation('msp/workflows');
  const pipeId = `workflow-designer-pipe-${pipePath.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

  return (
    <Droppable droppableId={`pipe:${pipePath}`}>
      {(provided) => (
        <div
          id={pipeId}
          data-pipe-path={pipePath}
          data-testid={isRoot ? 'pipeline-container' : `pipeline-branch-${pipePath}`}
          ref={provided.innerRef}
          {...provided.droppableProps}
          onClick={(event) => {
            event.stopPropagation();
            onSelectPipe(pipePath);
          }}
          onMouseEnter={() => onPipeHover(pipePath)}
          onMouseMove={() => onPipeHover(pipePath)}
          className="flex flex-col items-stretch"
        >
          {/* Pipeline Start (only for root) */}
          {isRoot && steps.length > 0 && (
            <div className="flex flex-col items-center mb-2">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-success/15 border-2 border-success" data-testid="pipeline-start">
                <Play className="h-4 w-4 text-green-600 ml-0.5" />
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {t('pipeline.start', { defaultValue: 'Start' })}
              </div>
              {onInsertStep && !disabled && (
                <PipelineConnector onInsert={() => onInsertStep(0)} position="start" disabled={disabled} />
              )}
            </div>
          )}

          {/* Empty Pipeline State */}
          {steps.length === 0 && (
            <EmptyPipeline
              onAddStep={onInsertStep ? () => onInsertStep(0) : undefined}
              disabled={disabled}
            />
          )}

          {/* Steps with Connectors */}
          {steps.map((step, index) => (
            <React.Fragment key={step.id}>
              <Draggable draggableId={step.id} index={index} isDragDisabled={disabled}>
                {(dragProvided) => (
                  <div
                    ref={dragProvided.innerRef}
                    {...dragProvided.draggableProps}
                    data-step-id={step.id}
                    data-testid={`pipeline-step-${step.id}`}
                  >
                    <StepCard
                      step={step}
                      stepPath={`${stepPathPrefix}.steps[${index}]`}
                      actionInputMappingStatus={actionInputMappingStatusByStepId.get(step.id)}
                      selected={selectedStepId === step.id}
                      selectedStepId={selectedStepId}
                      onSelectStep={onSelectStep}
                      onDeleteStep={onDeleteStep}
                      onDuplicateStep={onDuplicateStep}
                      onSelectPipe={onSelectPipe}
                      onPipeHover={onPipeHover}
                      onInsertStep={onInsertStep}
                      onInsertAtPath={onInsertAtPath}
                      dragHandleProps={dragProvided.dragHandleProps ?? undefined}
                      nodeRegistry={nodeRegistry}
                      designerActionCatalog={designerActionCatalog}
                      errorCount={errorMap.get(step.id)?.length ?? 0}
                      errorMap={errorMap}
                      disabled={disabled}
                      actionInputMappingStatusByStepId={actionInputMappingStatusByStepId}
                    />
                  </div>
                )}
              </Draggable>

              {/* Connector after each step (except last) */}
              {index < steps.length - 1 && (
                <div className="flex justify-center">
                  <PipelineConnector
                    onInsert={onInsertStep ? () => onInsertStep(index + 1) : undefined}
                    position="middle"
                    disabled={disabled}
                  />
                </div>
              )}
            </React.Fragment>
          ))}

          {/* Add step at end connector */}
          {steps.length > 0 && onInsertStep && !disabled && (
            <div className="flex justify-center">
              <PipelineConnector
                onInsert={() => onInsertStep(steps.length)}
                position="end"
                disabled={disabled}
              />
            </div>
          )}

          {provided.placeholder}
        </div>
      )}
    </Droppable>
  );
};

const StepCard: React.FC<{
  step: Step;
  stepPath: string;
  actionInputMappingStatus?: ActionInputMappingStatus;
  selected: boolean;
  selectedStepId: string | null;
  onSelectStep: (id: string) => void;
  onDeleteStep: (id: string) => void;
  onDuplicateStep: (id: string) => void;
  onSelectPipe: (pipePath: string) => void;
  onPipeHover: (pipePath: string) => void;
  onInsertStep?: (index: number) => void;
  onInsertAtPath?: (pipePath: string, index: number) => void;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  nodeRegistry: Record<string, NodeRegistryItem>;
  designerActionCatalog?: WorkflowDesignerCatalogRecord[];
  errorCount: number;
  errorMap: Map<string, PublishError[]>;
  actionInputMappingStatusByStepId: Map<string, ActionInputMappingStatus>;
  disabled?: boolean;
}> = ({
  step,
  stepPath,
  actionInputMappingStatus,
  selected,
  selectedStepId,
  onSelectStep,
  onDeleteStep,
  onDuplicateStep,
  onSelectPipe,
  onPipeHover,
  onInsertStep,
  onInsertAtPath,
  dragHandleProps,
  nodeRegistry,
  designerActionCatalog,
  errorCount,
  errorMap,
  actionInputMappingStatusByStepId,
  disabled = false
}) => {
  const { t } = useTranslation('msp/workflows');
  const label = getStepLabel(step, nodeRegistry, designerActionCatalog, t);
  const isBlock = step.type.startsWith('control.');
  const colors = getStepTypeColor(step.type);
  const icon = getStepTypeIcon(step.type);

  return (
    <Card
      className={`p-3 border-l-4 ${colors.border} ${
        selected ? 'ring-2 ring-primary-300 border-r border-t border-b border-primary-200' : 'border-r border-t border-b border-gray-200'
      } ${errorCount > 0 ? 'ring-2 ring-red-200' : ''} ${
        !selected ? 'hover:bg-gray-50' : ''
      } transition-all`}
      data-testid={`step-card-${step.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          id={`workflow-step-select-${step.id}`}
          className="text-left flex-1 min-w-0"
          type="button"
          onClick={() => onSelectStep(step.id)}
          aria-label={t('designer.stepCard.selectAriaLabel', { defaultValue: 'Select {{label}} step', label })}
        >
          <div className="flex items-center gap-2 flex-wrap">
            {/* Step type icon */}
            <div className={`flex-shrink-0 ${colors.icon}`}>
              {icon}
            </div>
            {/* Step label */}
            <span className="text-sm font-medium text-gray-900 truncate">{label}</span>
            {/* Block badge */}
            {isBlock && (
              <Badge className={`text-xs ${colors.badge}`}>
                {step.type === 'control.if'
                  ? t('designer.stepCard.badges.if', { defaultValue: 'If' })
                  : step.type === 'control.forEach'
                    ? t('designer.stepCard.badges.loop', { defaultValue: 'Loop' })
                    : step.type === 'control.tryCatch'
                      ? t('designer.stepCard.badges.try', { defaultValue: 'Try' })
                      : t('designer.stepCard.badges.block', { defaultValue: 'Block' })}
              </Badge>
            )}
            {actionInputMappingStatus && actionInputMappingStatus.requiredCount > 0 && (
              actionInputMappingStatus.unmappedRequiredCount > 0 ? (
                <Badge
                  id={`workflow-step-mapping-status-${step.id}`}
                  variant="error"
                  className="text-xs"
                  title={t('designer.stepCard.mapping.unmappedTitle', {
                    defaultValue: '{{count}} required fields are unmapped',
                    count: actionInputMappingStatus.unmappedRequiredCount,
                  })}
                >
                  {t('designer.stepCard.mapping.unmappedBadge', {
                    defaultValue: '{{count}} required unmapped',
                    count: actionInputMappingStatus.unmappedRequiredCount,
                  })}
                </Badge>
              ) : (
                <span
                  id={`workflow-step-mapping-status-${step.id}`}
                  className="inline-flex items-center text-emerald-700/80"
                  title={t('designer.stepCard.mapping.allMappedTitle', {
                    defaultValue: 'All {{count}} required fields are mapped',
                    count: actionInputMappingStatus.requiredCount,
                  })}
                  aria-label={t('designer.stepCard.mapping.allMappedAria', { defaultValue: 'All required fields mapped' })}
                >
                  <Link className="h-3.5 w-3.5" />
                </span>
              )
            )}
            {/* Error badge */}
            {errorCount > 0 && (
              <Badge variant="error" className="text-xs">
                {t('designer.stepCard.errorCount', {
                  defaultValue: '{{count}} {{noun}}',
                  count: errorCount,
                  noun: errorCount === 1
                    ? t('designer.stepCard.errorSingular', { defaultValue: 'error' })
                    : t('designer.stepCard.errorPlural', { defaultValue: 'errors' }),
                })}
              </Badge>
            )}
          </div>
          {/* Step summary content */}
          <div className="mt-1">
            <StepCardSummary step={step} />
          </div>
        </button>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {!disabled && (
            <>
              <div
                id={`workflow-step-drag-${step.id}`}
                {...dragHandleProps}
                className="cursor-grab text-gray-400 hover:text-gray-600 p-1"
                data-testid={`step-drag-handle-${step.id}`}
              >
                <GripVertical className="h-4 w-4" />
              </div>
              <Button
                id={`workflow-step-duplicate-${step.id}`}
                variant="ghost"
                size="sm"
                onClick={() => onDuplicateStep(step.id)}
                className="text-gray-400 hover:text-primary-600 p-1 h-auto"
                data-testid={`step-duplicate-${step.id}`}
                title={t('designer.stepCard.actions.duplicate', { defaultValue: 'Duplicate step' })}
                aria-label={t('designer.stepCard.actions.duplicateAriaLabel', {
                  defaultValue: 'Duplicate {{label}} step',
                  label,
                })}
              >
                <Copy className="h-4 w-4" />
              </Button>
              <Button
                id={`workflow-step-delete-${step.id}`}
                variant="ghost"
                size="sm"
                onClick={() => onDeleteStep(step.id)}
                className="text-gray-400 hover:text-destructive p-1 h-auto"
                data-testid={`step-delete-${step.id}`}
                title={t('designer.stepCard.actions.delete', { defaultValue: 'Delete step' })}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      {step.type === 'control.if' && (() => {
        const ifStep = step as IfBlock;
        const thenPath = `${stepPath}.then`;
        const elsePath = `${stepPath}.else`;
        return (
          <div className="mt-3 space-y-2">
            <BlockSection title={t('designer.blockSection.then', { defaultValue: 'THEN' })} idPrefix={`${step.id}-then`}>
              <Pipe
                steps={ifStep.then}
                pipePath={thenPath}
                stepPathPrefix={thenPath}
                selectedStepId={selectedStepId}
                onSelectStep={onSelectStep}
                onDeleteStep={onDeleteStep}
                onDuplicateStep={onDuplicateStep}
                onSelectPipe={onSelectPipe}
                onPipeHover={onPipeHover}
                onInsertStep={onInsertAtPath ? (index) => onInsertAtPath(thenPath, index) : undefined}
                onInsertAtPath={onInsertAtPath}
                nodeRegistry={nodeRegistry}
                designerActionCatalog={designerActionCatalog}
                errorMap={errorMap}
                actionInputMappingStatusByStepId={actionInputMappingStatusByStepId}
                disabled={disabled}
              />
            </BlockSection>
            <BlockSection title={t('designer.blockSection.else', { defaultValue: 'ELSE' })} idPrefix={`${step.id}-else`}>
              <Pipe
                steps={ifStep.else ?? []}
                pipePath={elsePath}
                stepPathPrefix={elsePath}
                selectedStepId={selectedStepId}
                onSelectStep={onSelectStep}
                onDeleteStep={onDeleteStep}
                onDuplicateStep={onDuplicateStep}
                onSelectPipe={onSelectPipe}
                onPipeHover={onPipeHover}
                onInsertStep={onInsertAtPath ? (index) => onInsertAtPath(elsePath, index) : undefined}
                onInsertAtPath={onInsertAtPath}
                nodeRegistry={nodeRegistry}
                designerActionCatalog={designerActionCatalog}
                errorMap={errorMap}
                actionInputMappingStatusByStepId={actionInputMappingStatusByStepId}
                disabled={disabled}
              />
            </BlockSection>
          </div>
        );
      })()}

      {step.type === 'control.tryCatch' && (() => {
        const tcStep = step as TryCatchBlock;
        const tryPath = `${stepPath}.try`;
        const catchPath = `${stepPath}.catch`;
        return (
          <div className="mt-3 space-y-2">
            <BlockSection title={t('designer.blockSection.try', { defaultValue: 'TRY' })} idPrefix={`${step.id}-try`}>
              <Pipe
                steps={tcStep.try}
                pipePath={tryPath}
                stepPathPrefix={tryPath}
                selectedStepId={selectedStepId}
                onSelectStep={onSelectStep}
                onDeleteStep={onDeleteStep}
                onDuplicateStep={onDuplicateStep}
                onSelectPipe={onSelectPipe}
                onPipeHover={onPipeHover}
                onInsertStep={onInsertAtPath ? (index) => onInsertAtPath(tryPath, index) : undefined}
                onInsertAtPath={onInsertAtPath}
                nodeRegistry={nodeRegistry}
                designerActionCatalog={designerActionCatalog}
                errorMap={errorMap}
                actionInputMappingStatusByStepId={actionInputMappingStatusByStepId}
                disabled={disabled}
              />
            </BlockSection>
            <BlockSection title={t('designer.blockSection.catch', { defaultValue: 'CATCH' })} idPrefix={`${step.id}-catch`}>
              <Pipe
                steps={tcStep.catch}
                pipePath={catchPath}
                stepPathPrefix={catchPath}
                selectedStepId={selectedStepId}
                onSelectStep={onSelectStep}
                onDeleteStep={onDeleteStep}
                onDuplicateStep={onDuplicateStep}
                onSelectPipe={onSelectPipe}
                onPipeHover={onPipeHover}
                onInsertStep={onInsertAtPath ? (index) => onInsertAtPath(catchPath, index) : undefined}
                onInsertAtPath={onInsertAtPath}
                nodeRegistry={nodeRegistry}
                designerActionCatalog={designerActionCatalog}
                errorMap={errorMap}
                actionInputMappingStatusByStepId={actionInputMappingStatusByStepId}
                disabled={disabled}
              />
            </BlockSection>
          </div>
        );
      })()}

      {step.type === 'control.forEach' && (() => {
        const feStep = step as ForEachBlock;
        const bodyPath = `${stepPath}.body`;
        return (
          <div className="mt-3">
            <div className="text-xs text-gray-500 mb-2">
              {t('designer.stepCard.forEachSummary', {
                defaultValue: 'Item: {{itemVar}} | Concurrency: {{concurrency}}',
                itemVar: feStep.itemVar,
                concurrency: feStep.concurrency ?? 1,
              })}
            </div>
            <BlockSection title={t('designer.blockSection.body', { defaultValue: 'BODY' })} idPrefix={`${step.id}-body`}>
              <Pipe
                steps={feStep.body}
                pipePath={bodyPath}
                stepPathPrefix={bodyPath}
                selectedStepId={selectedStepId}
                onSelectStep={onSelectStep}
                onDeleteStep={onDeleteStep}
                onDuplicateStep={onDuplicateStep}
                onSelectPipe={onSelectPipe}
                onPipeHover={onPipeHover}
                onInsertStep={onInsertAtPath ? (index) => onInsertAtPath(bodyPath, index) : undefined}
                onInsertAtPath={onInsertAtPath}
                nodeRegistry={nodeRegistry}
                designerActionCatalog={designerActionCatalog}
                errorMap={errorMap}
                actionInputMappingStatusByStepId={actionInputMappingStatusByStepId}
                disabled={disabled}
              />
            </BlockSection>
          </div>
        );
      })()}
    </Card>
  );
};

const BlockSection: React.FC<{ title: string; idPrefix: string; children: React.ReactNode }> = ({ title, idPrefix, children }) => {
  const [isOpen, setIsOpen] = useState(true);
  return (
    <div className="border border-gray-200 rounded-md">
      <button
        id={`workflow-designer-block-${idPrefix}`}
        className="flex items-center gap-2 px-3 py-2 text-xs font-semibold uppercase text-gray-600 w-full"
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
      >
        {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {title}
      </button>
      {isOpen && <div className="p-3 bg-gray-50">{children}</div>}
    </div>
  );
};

type WaitFilterOperator =
  | '='
  | '!='
  | 'in'
  | 'not_in'
  | 'exists'
  | 'not_exists'
  | '>'
  | '>='
  | '<'
  | '<='
  | 'contains'
  | 'starts_with'
  | 'ends_with';

type EventWaitFilterClause = {
  path: string;
  op: WaitFilterOperator;
  value?: unknown;
};

type EventSchemaScalarField = {
  path: string;
  type: 'string' | 'number' | 'boolean' | 'unknown';
  enumValues?: Array<string | number | boolean>;
  pickerKind?: string;
  pickerDependencies?: string[];
  pickerFixedValueHint?: string;
};

const WAIT_FILTER_OPERATOR_OPTIONS: Array<{ value: WaitFilterOperator; label: string }> = [
  { value: '=', label: 'equals' },
  { value: '!=', label: 'not equals' },
  { value: 'in', label: 'in' },
  { value: 'not_in', label: 'not in' },
  { value: 'exists', label: 'exists' },
  { value: 'not_exists', label: 'not exists' },
  { value: '>', label: 'greater than' },
  { value: '>=', label: 'greater than or equal' },
  { value: '<', label: 'less than' },
  { value: '<=', label: 'less than or equal' },
  { value: 'contains', label: 'contains' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'ends_with', label: 'ends with' }
];

const SUPPORTED_WAIT_FILTER_PICKER_RESOURCES = new Set([
  'board',
  'client',
  'client-location',
  'contact',
  'ticket-category',
  'ticket-priority',
  'ticket-status',
  'ticket-subcategory',
  'user',
  'user-or-team'
]);

const supportsWaitFilterPickerResource = (pickerKind: string | undefined): boolean =>
  Boolean(pickerKind && SUPPORTED_WAIT_FILTER_PICKER_RESOURCES.has(pickerKind));

const getDefaultWaitFilterScalarValue = (
  fieldMeta: EventSchemaScalarField | undefined,
  options?: { preferString?: boolean }
): string | number | boolean => {
  if (fieldMeta?.enumValues?.length) {
    const [firstValue] = fieldMeta.enumValues;
    if (typeof firstValue === 'string' || typeof firstValue === 'number' || typeof firstValue === 'boolean') {
      return firstValue;
    }
  }

  if (options?.preferString) {
    return '';
  }

  if (fieldMeta?.type === 'boolean') {
    return false;
  }

  if (fieldMeta?.type === 'number') {
    return 0;
  }

  return '';
};

const normalizeWaitFilterValueForOperator = (
  op: WaitFilterOperator,
  currentValue: unknown,
  fieldMeta: EventSchemaScalarField | undefined
): string | number | boolean | Array<string | number | boolean> | undefined => {
  if (op === 'exists' || op === 'not_exists') {
    return undefined;
  }

  if (op === 'in' || op === 'not_in') {
    if (Array.isArray(currentValue)) {
      return currentValue.filter((item): item is string | number | boolean =>
        typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
      );
    }
    if (typeof currentValue === 'string' || typeof currentValue === 'number' || typeof currentValue === 'boolean') {
      return [currentValue];
    }
    return [getDefaultWaitFilterScalarValue(fieldMeta)];
  }

  if (Array.isArray(currentValue)) {
    const [firstValue] = currentValue;
    if (typeof firstValue === 'string' || typeof firstValue === 'number' || typeof firstValue === 'boolean') {
      if ((op === 'contains' || op === 'starts_with' || op === 'ends_with') && typeof firstValue !== 'string') {
        return getDefaultWaitFilterScalarValue(fieldMeta, { preferString: true });
      }
      return firstValue;
    }
    return getDefaultWaitFilterScalarValue(fieldMeta, {
      preferString: op === 'contains' || op === 'starts_with' || op === 'ends_with'
    });
  }

  if (typeof currentValue === 'string' || typeof currentValue === 'number' || typeof currentValue === 'boolean') {
    if ((op === 'contains' || op === 'starts_with' || op === 'ends_with') && typeof currentValue !== 'string') {
      return getDefaultWaitFilterScalarValue(fieldMeta, { preferString: true });
    }
    return currentValue;
  }

  return getDefaultWaitFilterScalarValue(fieldMeta, {
    preferString: op === 'contains' || op === 'starts_with' || op === 'ends_with'
  });
};

const coerceWaitFilterValue = (
  raw: string,
  fieldMeta: EventSchemaScalarField | undefined
): string | number | boolean => {
  if (fieldMeta?.enumValues?.length) {
    const matching = fieldMeta.enumValues.find((item) => String(item) === raw);
    if (matching !== undefined) {
      return matching;
    }
  }

  if (fieldMeta?.type === 'boolean') {
    return raw === 'true';
  }

  if (fieldMeta?.type === 'number') {
    return Number(raw);
  }

  return raw;
};

const buildEventFilterDependencyMapping = (
  filters: EventWaitFilterClause[],
  activeIndex: number
): InputMapping => {
  const mapping: InputMapping = {};
  for (const [index, filter] of filters.entries()) {
    if (index === activeIndex) continue;
    if (!filter.path.trim()) continue;
    if (filter.op !== '=' && filter.op !== 'in' && filter.op !== 'not_in') continue;

    const value = filter.value;
    if (Array.isArray(value)) {
      if (value.length === 1) {
        mapping[filter.path] = value[0] as any;
      }
      continue;
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      mapping[filter.path] = value as any;
    }
  }
  return mapping;
};

const isEventScalarSchema = (schema: JsonSchema): boolean => {
  const type = normalizeSchemaType(schema);
  return type === 'string' || type === 'number' || type === 'integer' || type === 'boolean' || Boolean(schema.enum?.length);
};

const collectEventSchemaScalarFields = (
  schema: JsonSchema | null,
  rootSchema: JsonSchema | null,
  pathPrefix = ''
): EventSchemaScalarField[] => {
  if (!schema || !rootSchema) return [];
  const resolved = resolveSchema(schema, rootSchema);
  const properties = resolved.properties ?? {};
  const fields: EventSchemaScalarField[] = [];

  for (const [key, value] of Object.entries(properties)) {
    const prop = resolveSchema(value as JsonSchema, rootSchema);
    const nextPath = pathPrefix ? `${pathPrefix}.${key}` : key;
    if (isEventScalarSchema(prop)) {
      const type = normalizeSchemaType(prop);
      const workflowEditor = (prop as any)['x-workflow-editor'] as
        | { picker?: { resource?: string }; dependencies?: string[]; fixedValueHint?: string }
        | undefined;
      const legacyPickerKind = typeof (prop as any)['x-workflow-picker-kind'] === 'string'
        ? String((prop as any)['x-workflow-picker-kind'])
        : undefined;
      const pickerKind = workflowEditor?.picker?.resource ?? legacyPickerKind;
      const pickerDependenciesRaw = workflowEditor?.dependencies ?? (prop as any)['x-workflow-picker-dependencies'];
      const pickerDependencies = Array.isArray(pickerDependenciesRaw)
        ? pickerDependenciesRaw.filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
        : undefined;
      const pickerFixedValueHint = workflowEditor?.fixedValueHint
        ?? (typeof (prop as any)['x-workflow-picker-fixed-value-hint'] === 'string'
          ? String((prop as any)['x-workflow-picker-fixed-value-hint'])
          : undefined);
      fields.push({
        path: nextPath,
        type: type === 'number' || type === 'integer'
          ? 'number'
          : type === 'boolean'
            ? 'boolean'
            : type === 'string'
              ? 'string'
              : 'unknown',
        enumValues: Array.isArray(prop.enum)
          ? prop.enum.filter((item): item is string | number | boolean =>
            typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
          )
          : undefined,
        pickerKind,
        pickerDependencies,
        pickerFixedValueHint
      });
      continue;
    }

    if (normalizeSchemaType(prop) === 'object') {
      fields.push(...collectEventSchemaScalarFields(prop, rootSchema, nextPath));
    }
  }

  return fields;
};

export const StepConfigPanel: React.FC<{
  step: Step;
  stepPath?: string;
  errors: PublishError[];
  nodeRegistry: Record<string, NodeRegistryItem>;
  actionRegistry: ActionRegistryItem[];
  designerActionCatalog: WorkflowDesignerCatalogRecord[];
  eventCatalogOptions: WorkflowEventCatalogOptionV2[];
  fieldOptions: SelectOption[];
  payloadSchema: JsonSchema | null;
  definition: WorkflowDefinition;
  editable?: boolean;
  onChange: (step: Step) => void;
}> = ({
  step,
  stepPath,
  errors,
  nodeRegistry,
  actionRegistry,
  designerActionCatalog,
  eventCatalogOptions,
  fieldOptions,
  payloadSchema,
  definition,
  editable = true,
  onChange
}) => {
  const { t } = useTranslation('msp/workflows');
  const workflowOnErrorOptions = useWorkflowOnErrorOptions();
  const workflowWaitModeOptions = useWorkflowWaitModeOptions();
  const workflowWaitTimingOptions = useWorkflowWaitTimingOptions();
  const nodeSchema = step.type.startsWith('control.') ? null : nodeRegistry[step.type]?.configSchema;
  const [showDataContext, setShowDataContext] = useState(false);

  // Build data context for this step position
  const dataContext = useMemo(() =>
    buildDataContext(definition, step.id, actionRegistry, payloadSchema),
    [definition, step.id, actionRegistry, payloadSchema]
  );

  // For action.call steps, get the selected action
  const actionInputEditorState = useMemo(
    () => buildActionInputEditorState(step, actionRegistry),
    [step, actionRegistry]
  );
  const selectedAction = actionInputEditorState.selectedAction;
  const actionCallConfig = step.type === 'action.call'
    ? ((step as NodeStep).config as Record<string, unknown> | undefined)
    : undefined;
  const groupedActionRecord = useMemo(
    () => getGroupedActionCatalogRecordForStep(step, designerActionCatalog),
    [step, designerActionCatalog]
  );
  const isAiInferStep = shouldRenderWorkflowAiSchemaSection(step.type, selectedAction?.id);
  const isComposeTextStep = step.type === 'action.call' && isWorkflowComposeTextAction(selectedAction?.id);
  const resolvedActionOutputSchema = useMemo(() => {
    if (!actionCallConfig) {
      return null;
    }

    if (isAiInferStep) {
      return resolveWorkflowAiSchemaFromConfig(actionCallConfig).schema as JsonSchema | null;
    }

    if (isComposeTextStep) {
      return resolveComposeTextOutputSchemaFromConfig(actionCallConfig) as JsonSchema | null;
    }

    return null;
  }, [actionCallConfig, isAiInferStep, isComposeTextStep]);

  const saveAs = step.type === 'action.call'
    ? ((step as NodeStep).config as { saveAs?: string } | undefined)?.saveAs
    : undefined;

  // §17 - Extract action input fields for InputMappingEditor
  const actionInputFields = actionInputEditorState.actionInputFields;
  const inputMapping = actionInputEditorState.inputMapping;
  const requiredActionInputFields = actionInputEditorState.requiredActionInputFields;
  const mappedInputFieldCount = actionInputEditorState.mappedInputFieldCount;
  const unmappedRequiredInputFieldCount = actionInputEditorState.unmappedRequiredInputFieldCount;

  // §17 - Handle input mapping changes
  const handleInputMappingChange = useCallback((mapping: InputMapping) => {
    const nodeStep = step as NodeStep;
    const existingConfig = nodeStep.config as Record<string, unknown> | undefined;
    onChange({
      ...nodeStep,
      config: {
        ...existingConfig,
        inputMapping: Object.keys(mapping).length > 0 ? mapping : undefined
      }
    });
  }, [step, onChange]);
  const handleAiSchemaChange = useCallback((patch: {
    aiOutputSchemaMode: 'simple' | 'advanced';
    aiOutputSchema?: Record<string, unknown>;
    aiOutputSchemaText?: string;
  }) => {
    const nodeStep = step as NodeStep;
    const existingConfig = nodeStep.config as Record<string, unknown> | undefined;
    onChange({
      ...nodeStep,
      config: {
        ...existingConfig,
        ...patch,
      }
    });
  }, [step, onChange]);
  const handleComposeTextChange = useCallback((patch: {
    version: number;
    outputs: unknown[];
  }) => {
    const nodeStep = step as NodeStep;
    const existingConfig = nodeStep.config as Record<string, unknown> | undefined;
    onChange({
      ...nodeStep,
      config: {
        ...existingConfig,
        ...patch,
      }
    });
  }, [step, onChange]);
  const handleGroupedActionChange = useCallback((actionId?: string) => {
    if (step.type !== 'action.call' || !groupedActionRecord) return;
    const nextAction = actionId
      ? groupedActionRecord.actions.find((action) => action.id === actionId) ?? null
      : null;
    onChange(applyCatalogActionChoiceToStep(step as NodeStep, nextAction, {
      generateSaveAsName,
      currentGroupLabel: groupedActionRecord.label,
      currentActionLabel: selectedAction?.ui?.label ?? selectedAction?.id,
      nextGroupLabel: groupedActionRecord.label,
    }));
  }, [groupedActionRecord, onChange, selectedAction, step]);

  // §16.2 - Enhanced field options with step outputs
  const enhancedFieldOptions = useMemo(() =>
    buildWorkflowReferenceFieldOptions(payloadSchema, dataContext),
    [payloadSchema, dataContext]
  );

  // §20 - Expression context for Monaco editor autocomplete
  const expressionContext = useMemo(() =>
    buildExpressionContext(payloadSchema, dataContext),
    [payloadSchema, dataContext]
  );

  // §16.5 - Expression validation for this step
  const expressionValidations = useMemo(() => {
    if (!step.type.startsWith('control.') && 'config' in step) {
      const config = (step as NodeStep).config as Record<string, unknown> | undefined;
      if (config) {
        return validateStepExpressions(config, dataContext);
      }
    }
    return [];
  }, [step, dataContext]);
  const expressionGroups = useMemo(
    () => partitionStepExpressionValidations(expressionValidations),
    [expressionValidations]
  );
  const expressionErrors = expressionGroups.errors;
  const expressionWarnings = expressionGroups.warnings;
  const expressionInfo = expressionGroups.info;

  const handleCopyPath = useCallback((path: string) => {
    navigator.clipboard.writeText(path);
    toast.success(`Copied: ${path}`, { duration: 1500 });
  }, []);

  // §16.1 - Validate saveAs doesn't conflict with existing variable names
  const saveAsValidation = useMemo(() => {
    if (!saveAs) return null;

    // Check for conflicts with previous steps' saveAs names
    const existingSaveAsNames = dataContext.steps.map(s => s.saveAs);
    if (existingSaveAsNames.includes(saveAs)) {
      return {
        type: 'error' as const,
        message: `"${saveAs}" conflicts with an existing step output variable`
      };
    }

    // Check for reserved names
    const reservedNames = ['payload', 'vars', 'meta', 'error', 'env', 'secrets', 'item', '$index'];
    if (reservedNames.includes(saveAs)) {
      return {
        type: 'error' as const,
        message: `"${saveAs}" is a reserved variable name`
      };
    }

    // Check for invalid characters (should be valid JS identifier)
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(saveAs)) {
      return {
        type: 'warning' as const,
        message: 'Variable name should start with a letter and contain only letters, numbers, and underscores'
      };
    }

    return null;
  }, [saveAs, dataContext.steps]);

  const removeInvalidWaitConfigFields = useCallback((config: Record<string, unknown>): Record<string, unknown> => {
    const nextConfig = { ...config };
    delete nextConfig.saveAs;
    return nextConfig;
  }, []);

  const eventWaitConfig = step.type === 'event.wait'
    ? removeInvalidWaitConfigFields((((step as NodeStep).config as Record<string, unknown> | undefined) ?? {}))
    : null;
  const timeWaitConfig = step.type === 'time.wait'
    ? removeInvalidWaitConfigFields((((step as NodeStep).config as Record<string, unknown> | undefined) ?? {}))
    : null;
  const timeWaitDurationParts = useMemo(
    () => decomposeTimeWaitDurationMs(typeof timeWaitConfig?.durationMs === 'number' ? timeWaitConfig.durationMs : undefined),
    [timeWaitConfig?.durationMs]
  );
  const [timeWaitUntilAuthoringMode, setTimeWaitUntilAuthoringMode] = useState<'fixed' | 'expression'>(() => inferTimeWaitUntilAuthoringMode(timeWaitConfig));
  const previousTimeWaitStepIdRef = useRef<string | null>(null);
  const selectedWaitEventName = typeof eventWaitConfig?.eventName === 'string' ? eventWaitConfig.eventName : '';
  const selectedWaitEventOption = useMemo(
    () => eventCatalogOptions.find((option) => option.event_type === selectedWaitEventName) ?? null,
    [eventCatalogOptions, selectedWaitEventName]
  );
  const [eventWaitPayloadSchema, setEventWaitPayloadSchema] = useState<JsonSchema | null>(null);
  const [eventWaitPayloadSchemaStatus, setEventWaitPayloadSchemaStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');

  useEffect(() => {
    if (step.type !== 'time.wait') {
      previousTimeWaitStepIdRef.current = null;
      return;
    }

    if (previousTimeWaitStepIdRef.current === step.id) {
      return;
    }

    previousTimeWaitStepIdRef.current = step.id;
    const nextTimeWaitConfig = removeInvalidWaitConfigFields((((step as NodeStep).config as Record<string, unknown> | undefined) ?? {}));
    setTimeWaitUntilAuthoringMode(inferTimeWaitUntilAuthoringMode(nextTimeWaitConfig));
  }, [removeInvalidWaitConfigFields, step]);

  useEffect(() => {
    if (step.type !== 'event.wait') return;
    if (!selectedWaitEventName) {
      setEventWaitPayloadSchema(null);
      setEventWaitPayloadSchemaStatus('idle');
      return;
    }
    let cancelled = false;
    setEventWaitPayloadSchemaStatus('loading');
    (async () => {
      try {
        if (selectedWaitEventOption?.payload_schema_ref_status === 'known' && selectedWaitEventOption.payload_schema_ref) {
          const result = await getWorkflowSchemaAction({ schemaRef: selectedWaitEventOption.payload_schema_ref });
          if (!cancelled) {
            setEventWaitPayloadSchema(((result as any)?.schema ?? null) as JsonSchema | null);
            setEventWaitPayloadSchemaStatus('loaded');
          }
          return;
        }
        const entry = await getEventCatalogEntryByEventType(selectedWaitEventName);
        if (!cancelled) {
          setEventWaitPayloadSchema((((entry as any)?.payload_schema ?? null) as JsonSchema | null));
          setEventWaitPayloadSchemaStatus(((entry as any)?.payload_schema ? 'loaded' : 'error'));
        }
      } catch {
        if (!cancelled) {
          setEventWaitPayloadSchema(null);
          setEventWaitPayloadSchemaStatus('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedWaitEventName, selectedWaitEventOption?.payload_schema_ref, selectedWaitEventOption?.payload_schema_ref_status, step.type]);

  const eventFilterFields = useMemo(
    () => collectEventSchemaScalarFields(eventWaitPayloadSchema, eventWaitPayloadSchema),
    [eventWaitPayloadSchema]
  );
  const eventFilterFieldOptions = useMemo(
    () => eventFilterFields.map((field) => ({ value: field.path, label: field.path })),
    [eventFilterFields]
  );

  const updateWaitNodeConfig = useCallback((nextConfig: Record<string, unknown>) => {
    const nodeStep = step as NodeStep;
    onChange({
      ...nodeStep,
      config: removeInvalidWaitConfigFields(nextConfig)
    });
  }, [onChange, removeInvalidWaitConfigFields, step]);

  const updateTimeWaitDurationPart = useCallback((unit: 'days' | 'hours' | 'minutes' | 'seconds', raw: string) => {
    if (!timeWaitConfig) {
      return;
    }

    const nextDurationMs = composeTimeWaitDurationMs({
      ...timeWaitDurationParts,
      [unit]: parseTimeWaitDurationPart(raw)
    });

    updateWaitNodeConfig({
      ...timeWaitConfig,
      durationMs: nextDurationMs
    });
  }, [timeWaitConfig, timeWaitDurationParts, updateWaitNodeConfig]);

  const eventFilters = useMemo(() => {
    if (!eventWaitConfig) return [] as EventWaitFilterClause[];
    const raw = Array.isArray(eventWaitConfig.filters) ? eventWaitConfig.filters : [];
    return raw
      .filter((item): item is EventWaitFilterClause =>
        !!item
        && typeof item === 'object'
        && typeof (item as any).path === 'string'
        && typeof (item as any).op === 'string'
      );
  }, [eventWaitConfig]);

  const updateEventFilterClause = useCallback((index: number, patch: Partial<EventWaitFilterClause>) => {
    if (!eventWaitConfig) return;
    const next = eventFilters.map((filter, currentIndex) => (
      currentIndex === index
        ? { ...filter, ...patch }
        : filter
    ));
    updateWaitNodeConfig({ ...eventWaitConfig, filters: next });
  }, [eventFilters, eventWaitConfig, updateWaitNodeConfig]);

  const removeEventFilterClause = useCallback((index: number) => {
    if (!eventWaitConfig) return;
    const next = eventFilters.filter((_, currentIndex) => currentIndex !== index);
    updateWaitNodeConfig({ ...eventWaitConfig, filters: next });
  }, [eventFilters, eventWaitConfig, updateWaitNodeConfig]);

  const addEventFilterClause = useCallback(() => {
    if (!eventWaitConfig) return;
    const defaultPath = eventFilterFields[0]?.path ?? '';
    const defaultFieldMeta = eventFilterFields.find((field) => field.path === defaultPath);
    const next = [
      ...eventFilters,
      {
        path: defaultPath,
        op: '=',
        value: normalizeWaitFilterValueForOperator('=', undefined, defaultFieldMeta)
      } as EventWaitFilterClause
    ];
    updateWaitNodeConfig({ ...eventWaitConfig, filters: next });
  }, [eventFilterFields, eventFilters, eventWaitConfig, updateWaitNodeConfig]);

  useEffect(() => {
    if (step.type !== 'event.wait' && step.type !== 'time.wait') {
      return;
    }

    const currentConfig = ((step as NodeStep).config as Record<string, unknown> | undefined) ?? {};
    if (!Object.prototype.hasOwnProperty.call(currentConfig, 'saveAs')) {
      return;
    }

    updateWaitNodeConfig(currentConfig);
  }, [step, updateWaitNodeConfig]);

  const handleNodeConfigChange = (config: Record<string, unknown>) => {
    onChange({ ...step, config });
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">{getStepLabel(step, nodeRegistry, designerActionCatalog, t)}</div>
        <div className="text-xs text-gray-500">{stepPath ?? step.id}</div>
      </div>

      {errors.length > 0 && (
        <Card className="border border-destructive/30 bg-destructive/10 p-3">
          <div className="text-xs font-semibold text-destructive mb-1">Validation errors</div>
          <ul className="text-xs text-destructive space-y-1">
            {errors.map((error, index) => (
              <li key={`${error.code}-${index}`}>{error.message}</li>
            ))}
          </ul>
        </Card>
      )}

      {/* §16.5 - Expression validation errors/warnings */}
      {expressionValidations.length > 0 && (
        <div className="space-y-2">
          {expressionErrors.length > 0 && (
            <Card className="border border-destructive/30 bg-destructive/10 p-3">
              <div className="text-xs font-semibold text-destructive mb-1 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                Expression errors
              </div>
              <ul className="text-xs text-destructive space-y-1">
                {expressionErrors.map((validation, i) => (
                  <li key={`${validation.diagnostic.code ?? 'error'}-${validation.field}-${i}`}>
                    <code className="bg-destructive/15 px-1 rounded">{validation.field}</code>: {validation.diagnostic.message}
                  </li>
                  ))}
              </ul>
            </Card>
          )}
          {expressionWarnings.length > 0 && (
            <Card className="border border-warning/30 bg-warning/10 p-3">
              <div className="text-xs font-semibold text-warning-foreground mb-1 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                Warnings
              </div>
              <ul className="text-xs text-warning-foreground space-y-1">
                {expressionWarnings.map((validation, i) => (
                  <li key={`${validation.diagnostic.code ?? 'warning'}-${validation.field}-${i}`}>
                    <code className="bg-warning/15 px-1 rounded">{validation.field}</code>: {validation.diagnostic.message}
                  </li>
                  ))}
              </ul>
            </Card>
          )}
          {expressionInfo.length > 0 && (
            <Card className="border border-muted/50 bg-muted/20 p-3">
              <div className="text-xs font-semibold text-muted-foreground mb-1 flex items-center gap-1">
                <Info className="w-3.5 h-3.5" />
                Expression info
              </div>
              <ul className="text-xs text-muted-foreground space-y-1">
                {expressionInfo.map((validation, i) => (
                  <li key={`${validation.diagnostic.code ?? 'info'}-${validation.field}-${i}`}>
                    <code className="bg-muted/40 px-1 rounded">{validation.field}</code>: {validation.diagnostic.message}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      {!step.type.startsWith('control.') && (
        <WorkflowStepNameField
          stepId={step.id}
          value={(step as NodeStep).name ?? ''}
          disabled={!editable}
          onChange={(value) => onChange({ ...(step as NodeStep), name: value })}
        />
      )}

      {step.type === 'action.call' && groupedActionRecord && (
        <GroupedActionConfigSection
          stepId={step.id}
          record={groupedActionRecord}
          selectedActionId={selectedAction?.id}
          selectedActionDescription={selectedAction
            ? t(`designer.actions.${selectedAction.id}.description`, {
              defaultValue: selectedAction.ui?.description,
            })
            : undefined}
          disabled={!editable}
          onActionChange={handleGroupedActionChange}
        />
      )}

      {/* §19.4 - Enhanced Save Output section with toggle, preview, and copy */}
      {!step.type.startsWith('control.') && step.type !== 'event.wait' && step.type !== 'time.wait' && (() => {
        const nodeStep = step as NodeStep;
        const existingConfig = nodeStep.config as Record<string, unknown> | undefined;
        const actionId = (existingConfig?.actionId as string) ?? '';

        return (
          <WorkflowStepSaveOutputSection
            stepId={step.id}
            actionId={actionId}
            saveAs={(existingConfig?.saveAs as string) ?? undefined}
            saveAsValidation={saveAsValidation}
            disabled={!editable}
            onSaveAsChange={(value) => {
              onChange({
                ...nodeStep,
                config: { ...existingConfig, saveAs: value }
              });
            }}
            onCopyPath={handleCopyPath}
            generateSaveAsName={generateSaveAsName}
          />
        );
      })()}

      {step.type === 'control.if' && (() => {
        const ifStep = step as IfBlock;
        return (
          <ExpressionField
            idPrefix={`if-condition-${step.id}`}
            label="Condition"
            value={ensureExpr(ifStep.condition)}
            onChange={(expr) => onChange({ ...ifStep, condition: expr })}
            fieldOptions={enhancedFieldOptions}
            context={expressionContext}
          />
        );
      })()}

      {step.type === 'control.forEach' && (() => {
        const feStep = step as ForEachBlock;
        return (
          <div className="space-y-3">
            <ExpressionField
              idPrefix={`foreach-items-${step.id}`}
              label="Items expression"
              value={ensureExpr(feStep.items)}
              onChange={(expr) => onChange({ ...feStep, items: expr })}
              fieldOptions={enhancedFieldOptions}
              context={expressionContext}
            />
            <Input
              id={`foreach-itemvar-${step.id}`}
              label="Item variable"
              value={feStep.itemVar}
              onChange={(event) => onChange({ ...feStep, itemVar: event.target.value })}
            />
            <Input
              id={`foreach-concurrency-${step.id}`}
              label="Concurrency"
              type="number"
              value={feStep.concurrency ?? 1}
              onChange={(event) => onChange({ ...feStep, concurrency: Number(event.target.value) })}
            />
            <CustomSelect
              id={`foreach-onitemerror-${step.id}`}
              options={workflowOnErrorOptions}
              value={feStep.onItemError ?? 'continue'}
              onValueChange={(value) => onChange({ ...feStep, onItemError: value as 'continue' | 'fail' })}
              label="On item error"
            />
          </div>
        );
      })()}

      {step.type === 'control.tryCatch' && (() => {
        const tcStep = step as TryCatchBlock;
        return (
          <Input
            id={`trycatch-capture-${step.id}`}
            label="Capture error as"
            value={tcStep.captureErrorAs ?? ''}
            onChange={(event) => {
              const value = event.target.value.trim();
              onChange({ ...tcStep, captureErrorAs: value ? value : undefined });
            }}
          />
        );
      })()}

      {step.type === 'control.callWorkflow' && (() => {
        const cwStep = step as CallWorkflowBlock;
        return (
          <div className="space-y-3">
            <Input
              id={`call-workflow-id-${step.id}`}
              label="Workflow ID"
              value={cwStep.workflowId}
              onChange={(event) => onChange({ ...cwStep, workflowId: event.target.value })}
            />
            <Input
              id={`call-workflow-version-${step.id}`}
              label="Workflow version"
              type="number"
              value={cwStep.workflowVersion}
              onChange={(event) => onChange({ ...cwStep, workflowVersion: Number(event.target.value) })}
            />
            <MappingExprEditor
              idPrefix={`call-workflow-input-${step.id}`}
              label="Input mapping"
              value={cwStep.inputMapping ?? {}}
              onChange={(mapping) => onChange({ ...cwStep, inputMapping: mapping })}
              fieldOptions={enhancedFieldOptions}
              context={expressionContext}
            />
            <MappingExprEditor
              idPrefix={`call-workflow-output-${step.id}`}
              label="Output mapping"
              value={cwStep.outputMapping ?? {}}
              onChange={(mapping) => onChange({ ...cwStep, outputMapping: mapping })}
              fieldOptions={enhancedFieldOptions}
              context={expressionContext}
            />
          </div>
        );
      })()}

      {step.type === 'control.return' && (
        <div className="text-sm text-gray-500">Return stops workflow execution.</div>
      )}

      {step.type === 'event.wait' && eventWaitConfig && (
        <div className="space-y-3">
          <SearchableSelect
            id={`event-wait-event-${step.id}`}
            label={t('designer.stepConfig.eventLabel', { defaultValue: 'Event' })}
            value={selectedWaitEventName}
            onChange={(value) => {
              const eventName = value.trim();
              updateWaitNodeConfig({
                ...eventWaitConfig,
                eventName,
                filters: []
              });
            }}
            placeholder={t('designer.stepConfig.selectEvent', { defaultValue: 'Select event' })}
            dropdownMode="overlay"
            options={eventCatalogOptions.map((option) => ({
              value: option.event_type,
              label: option.name || option.event_type
            }))}
            disabled={!editable}
          />

          <ExpressionField
            idPrefix={`event-wait-correlation-${step.id}`}
            label={t('designer.stepConfig.correlationKey', { defaultValue: 'Correlation Key Expression' })}
            value={ensureExpr((eventWaitConfig.correlationKey as Expr | undefined) ?? { $expr: '' })}
            onChange={(expr) => updateWaitNodeConfig({ ...eventWaitConfig, correlationKey: expr })}
            fieldOptions={enhancedFieldOptions}
            context={expressionContext}
            disabled={!editable}
          />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t('designer.stepConfig.payloadFilters', { defaultValue: 'Payload Filters' })}</Label>
              <Button
                id={`event-wait-filter-add-${step.id}`}
                variant="outline"
                size="sm"
                onClick={addEventFilterClause}
                disabled={!editable}
              >
                {t('designer.stepConfig.addFilter', { defaultValue: 'Add filter' })}
              </Button>
            </div>
            {eventWaitPayloadSchemaStatus === 'loading' && (
              <div className="text-xs text-gray-500">
                {t('designer.stepConfig.loadingEventSchema', { defaultValue: 'Loading event schema fields...' })}
              </div>
            )}
            {eventFilters.length === 0 && (
              <div className="text-xs text-gray-400">
                {t('designer.stepConfig.noFiltersConfigured', { defaultValue: 'No filters configured.' })}
              </div>
            )}
            {eventFilters.map((filter, index) => {
              const fieldMeta = eventFilterFields.find((field) => field.path === filter.path);
              const showValue = filter.op !== 'exists' && filter.op !== 'not_exists';
              const expectsArray = filter.op === 'in' || filter.op === 'not_in';
              const dependencyInputMapping = buildEventFilterDependencyMapping(eventFilters, index);
              const enumOptions = (fieldMeta?.enumValues ?? []).map((item) => ({ value: String(item), label: String(item) }));
              const valueAsString = Array.isArray(filter.value)
                ? filter.value.map((item) => String(item)).join(', ')
                : filter.value === undefined || filter.value === null
                  ? ''
                  : String(filter.value);

              return (
                <Card key={`event-filter-${index}`} className="p-3 space-y-2">
                  <div className="grid grid-cols-12 gap-2">
                    <div className="col-span-5">
                      {eventFilterFieldOptions.length > 0 ? (
                        <CustomSelect
                          id={`event-wait-filter-path-${step.id}-${index}`}
                          label={index === 0 ? t('designer.stepConfig.fieldLabel', { defaultValue: 'Field' }) : undefined}
                          options={eventFilterFieldOptions}
                          value={filter.path}
                          onValueChange={(nextPath) => updateEventFilterClause(index, { path: nextPath })}
                          disabled={!editable}
                        />
                      ) : (
                        <Input
                          id={`event-wait-filter-path-${step.id}-${index}`}
                          label={index === 0 ? t('designer.stepConfig.fieldPathLabel', { defaultValue: 'Field path' }) : undefined}
                          value={filter.path}
                          disabled={!editable}
                          onChange={(event) => updateEventFilterClause(index, { path: event.target.value })}
                        />
                      )}
                    </div>
                    <div className="col-span-4">
                      <CustomSelect
                        id={`event-wait-filter-op-${step.id}-${index}`}
                        label={index === 0 ? 'Operator' : undefined}
                        options={WAIT_FILTER_OPERATOR_OPTIONS}
                        value={filter.op}
                        onValueChange={(value) => {
                          const nextOp = value as WaitFilterOperator;
                          updateEventFilterClause(index, {
                            op: nextOp,
                            value: normalizeWaitFilterValueForOperator(nextOp, filter.value, fieldMeta)
                          });
                        }}
                        disabled={!editable}
                      />
                    </div>
                    <div className="col-span-3 flex items-end justify-end">
                      <Button
                        id={`event-wait-filter-remove-${step.id}-${index}`}
                        variant="ghost"
                        size="sm"
                        onClick={() => removeEventFilterClause(index)}
                        disabled={!editable}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>

                  {showValue && (
                    <div>
                      {fieldMeta?.pickerKind && supportsWaitFilterPickerResource(fieldMeta.pickerKind) && !expectsArray ? (
                        <WorkflowActionInputFixedPicker
                          idPrefix={`event-wait-filter-value-${step.id}-${index}`}
                          field={{
                            name: filter.path || 'value',
                            editor: {
                              kind: 'picker',
                              picker: { resource: fieldMeta.pickerKind },
                              dependencies: fieldMeta.pickerDependencies,
                              fixedValueHint: fieldMeta.pickerFixedValueHint,
                              allowsDynamicReference: false
                            }
                          }}
                          value={valueAsString || null}
                          onChange={(nextValue) => updateEventFilterClause(index, { value: nextValue ?? '' })}
                          rootInputMapping={dependencyInputMapping}
                          disabled={!editable}
                        />
                      ) : enumOptions.length > 0 && !expectsArray ? (
                        <CustomSelect
                          id={`event-wait-filter-value-${step.id}-${index}`}
                          label="Value"
                          options={enumOptions}
                          value={valueAsString}
                          onValueChange={(value) => {
                            const matching = fieldMeta?.enumValues?.find((item) => String(item) === value);
                            updateEventFilterClause(index, { value: matching ?? value });
                          }}
                          disabled={!editable}
                        />
                      ) : fieldMeta?.type === 'boolean' && !expectsArray ? (
                        <CustomSelect
                          id={`event-wait-filter-value-${step.id}-${index}`}
                          label="Value"
                          options={[
                            { value: 'true', label: 'true' },
                            { value: 'false', label: 'false' }
                          ]}
                          value={valueAsString}
                          onValueChange={(value) => updateEventFilterClause(index, { value: value === 'true' })}
                          disabled={!editable}
                        />
                      ) : fieldMeta?.type === 'number' && !expectsArray ? (
                        <Input
                          id={`event-wait-filter-value-${step.id}-${index}`}
                          label="Value"
                          type="number"
                          value={valueAsString}
                          disabled={!editable}
                          onChange={(event) => updateEventFilterClause(index, { value: Number(event.target.value) })}
                        />
                      ) : (
                        <Input
                          id={`event-wait-filter-value-${step.id}-${index}`}
                          label={expectsArray ? 'Values (comma separated)' : 'Value'}
                          value={valueAsString}
                          disabled={!editable}
                          onChange={(event) => {
                            const raw = event.target.value;
                            if (expectsArray) {
                              const values = raw
                                .split(',')
                                .map((item) => item.trim())
                                .filter((item) => item.length > 0);
                              updateEventFilterClause(index, {
                                value: values.map((item) => coerceWaitFilterValue(item, fieldMeta))
                              });
                            } else {
                              updateEventFilterClause(index, { value: coerceWaitFilterValue(raw, fieldMeta) });
                            }
                          }}
                        />
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>

          <Input
            id={`event-wait-timeout-${step.id}`}
            label={t('designer.stepConfig.timeoutMs', { defaultValue: 'Timeout (ms)' })}
            type="number"
            value={typeof eventWaitConfig.timeoutMs === 'number' ? eventWaitConfig.timeoutMs : ''}
            disabled={!editable}
            onChange={(event) => {
              const raw = event.target.value.trim();
              updateWaitNodeConfig({
                ...eventWaitConfig,
                timeoutMs: raw ? Number(raw) : undefined
              });
            }}
          />

          <MappingExprEditor
            idPrefix={`event-wait-assign-${step.id}`}
            label={t('designer.stepConfig.assignOnResume', { defaultValue: 'Assign on resume' })}
            value={(eventWaitConfig.assign as Record<string, Expr>) ?? {}}
            onChange={(assign) => updateWaitNodeConfig({ ...eventWaitConfig, assign })}
            fieldOptions={enhancedFieldOptions}
            context={expressionContext}
            disabled={!editable}
          />
        </div>
      )}

      {step.type === 'time.wait' && timeWaitConfig && (() => {
        const fixedUntilValue = parseFixedTimeWaitUntilExpr(timeWaitConfig.until as Expr | undefined) ?? undefined;

        return (
          <div className="space-y-3">
            <CustomSelect
              id={`time-wait-mode-${step.id}`}
              label="Mode"
              options={workflowWaitModeOptions}
              value={typeof timeWaitConfig.mode === 'string' ? timeWaitConfig.mode : 'duration'}
              onValueChange={(mode) => {
                if (mode === 'until') {
                  setTimeWaitUntilAuthoringMode('fixed');
                }
                updateWaitNodeConfig({
                  ...timeWaitConfig,
                  mode,
                  durationMs: mode === 'duration' ? (timeWaitConfig.durationMs ?? 1000) : undefined,
                  until: mode === 'until' ? (timeWaitConfig.until ?? { $expr: '' }) : undefined
                });
              }}
              disabled={!editable}
            />
            {(timeWaitConfig.mode ?? 'duration') === 'duration' ? (
              <div className="space-y-2">
                <Label>Duration</Label>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Input
                    id={`time-wait-duration-days-${step.id}`}
                    label="Days"
                    type="number"
                    value={formatTimeWaitDurationPart(timeWaitDurationParts.days)}
                    disabled={!editable}
                    onChange={(event) => updateTimeWaitDurationPart('days', event.target.value)}
                  />
                  <Input
                    id={`time-wait-duration-hours-${step.id}`}
                    label="Hours"
                    type="number"
                    value={formatTimeWaitDurationPart(timeWaitDurationParts.hours)}
                    disabled={!editable}
                    onChange={(event) => updateTimeWaitDurationPart('hours', event.target.value)}
                  />
                  <Input
                    id={`time-wait-duration-minutes-${step.id}`}
                    label="Minutes"
                    type="number"
                    value={formatTimeWaitDurationPart(timeWaitDurationParts.minutes)}
                    disabled={!editable}
                    onChange={(event) => updateTimeWaitDurationPart('minutes', event.target.value)}
                  />
                  <Input
                    id={`time-wait-duration-seconds-${step.id}`}
                    label="Seconds"
                    type="number"
                    value={formatTimeWaitDurationPart(timeWaitDurationParts.seconds)}
                    disabled={!editable}
                    onChange={(event) => updateTimeWaitDurationPart('seconds', event.target.value)}
                  />
                </div>
                <p className="text-xs text-[rgb(var(--color-text-500))]">
                  Stored as milliseconds in the workflow definition. Use fixed units only.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <CustomSelect
                  id={`time-wait-until-authoring-mode-${step.id}`}
                  label="Until input"
                  options={workflowWaitTimingOptions}
                  value={timeWaitUntilAuthoringMode}
                  onValueChange={(value) => setTimeWaitUntilAuthoringMode(value === 'expression' ? 'expression' : 'fixed')}
                  disabled={!editable}
                />

                {timeWaitUntilAuthoringMode === 'fixed' ? (
                  <div className="space-y-2">
                    <Label htmlFor={`time-wait-until-picker-${step.id}`}>Specific date & time</Label>
                    <DateTimePicker
                      id={`time-wait-until-picker-${step.id}`}
                      label="Specific date & time"
                      value={fixedUntilValue}
                      onChange={(value) => updateWaitNodeConfig({
                        ...timeWaitConfig,
                        until: value ? buildFixedTimeWaitUntilExpr(value) : { $expr: '' }
                      })}
                      disabled={!editable}
                      clearable
                    />
                    <div className="text-xs text-[rgb(var(--color-text-500))]">
                      Stored as an absolute timestamp using your current browser timezone.
                    </div>
                  </div>
                ) : (
                  <ExpressionField
                    idPrefix={`time-wait-until-${step.id}`}
                    label="Until expression"
                    value={ensureExpr((timeWaitConfig.until as Expr | undefined) ?? { $expr: '' })}
                    onChange={(untilExpr) => updateWaitNodeConfig({ ...timeWaitConfig, until: untilExpr })}
                    fieldOptions={enhancedFieldOptions}
                    context={expressionContext}
                    disabled={!editable}
                  />
                )}
              </div>
            )}

            <MappingExprEditor
              idPrefix={`time-wait-assign-${step.id}`}
              label={t('designer.stepConfig.assignOnResume', { defaultValue: 'Assign on resume' })}
              value={(timeWaitConfig.assign as Record<string, Expr>) ?? {}}
              onChange={(assign) => updateWaitNodeConfig({ ...timeWaitConfig, assign })}
              fieldOptions={enhancedFieldOptions}
              context={expressionContext}
              disabled={!editable}
            />
          </div>
        );
      })()}

      {nodeSchema
        && step.type !== 'control.return'
        && step.type !== 'control.callWorkflow'
        && step.type !== 'event.wait'
        && step.type !== 'time.wait'
        && (
        <SchemaForm
          schema={nodeSchema}
          rootSchema={nodeSchema}
          value={(step as NodeStep).config as Record<string, unknown>}
          onChange={handleNodeConfigChange}
          fieldOptions={enhancedFieldOptions}
          actionRegistry={actionRegistry}
          stepId={step.id}
          excludeFields={step.type === 'action.call'
            ? [
                'actionId',
                'version',
                'saveAs',
                'inputMapping',
                'designerGroupKey',
                'designerTileKind',
                'designerAppKey',
                'outputs',
                'aiOutputSchemaMode',
                'aiOutputSchema',
                'aiOutputSchemaText',
              ]
            : []}
          sectionTitle={step.type === 'action.call'
            ? t('designer.schemaForm.stepSettings', { defaultValue: 'Step settings' })
            : undefined}
          expressionContext={expressionContext}
        />
      )}

      {/* §17 - Input Mapping Panel for action.call steps */}
      {step.type === 'action.call' && selectedAction && actionInputFields.length > 0 && (
        <WorkflowActionInputSection
          stepId={step.id}
          inputMapping={inputMapping}
          onInputMappingChange={handleInputMappingChange}
          targetFields={actionInputFields}
          dataContext={dataContext}
          fieldOptions={enhancedFieldOptions}
          mappedInputFieldCount={mappedInputFieldCount}
          requiredActionInputFields={requiredActionInputFields}
          unmappedRequiredInputFieldCount={unmappedRequiredInputFieldCount}
          disabled={!editable}
        />
      )}

      {step.type === 'action.call' && isAiInferStep && (
        <WorkflowAiSchemaSection
          stepId={step.id}
          config={actionCallConfig}
          disabled={!editable}
          onChange={handleAiSchemaChange}
        />
      )}

      {step.type === 'action.call' && isComposeTextStep && (
        <WorkflowComposeTextSection
          stepId={step.id}
          saveAs={saveAs}
          config={actionCallConfig}
          dataContext={dataContext}
          disabled={!editable}
          onChange={handleComposeTextChange}
        />
      )}

      {/* §16.1 - Action Schema Reference for action.call steps */}
      {step.type === 'action.call' && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <ActionSchemaReference
            action={selectedAction}
            saveAs={saveAs}
            outputSchemaOverride={resolvedActionOutputSchema}
            onCopyPath={handleCopyPath}
          />
        </div>
      )}

      {/* §16.3 - Data Context Panel (collapsible) */}
      <div className="mt-4 pt-4 border-t border-gray-200">
        <button
          onClick={() => setShowDataContext(!showDataContext)}
          className="flex items-center gap-2 text-xs text-gray-600 hover:text-gray-800"
        >
          {showDataContext ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          <HelpCircle className="w-3.5 h-3.5" />
          {t('designer.stepConfig.dataContextToggle', { defaultValue: 'What data can I access here?' })}
        </button>

        {showDataContext && (
          <div className="mt-3">
            <DataContextPanel context={dataContext} onCopyPath={handleCopyPath} />
          </div>
        )}
      </div>
    </div>
  );
};

// Portal-based tooltip for palette items (avoids overflow/stacking context issues)
// Field metadata for friendly labels and descriptions.
// English defaults live here; localization happens via `getFieldMeta(t, key)` so step-config
// schema-form fields translate their labels/descriptions under `designer.fieldMetadata.*`.
const FIELD_METADATA_DEFAULTS: Record<string, { label: string; description?: string; advanced?: boolean }> = {
  actionId: { label: 'Action', description: 'The action to invoke' },
  version: { label: 'Version', description: 'Action version number' },
  inputMapping: { label: 'Input Mapping', description: 'Map data to action inputs' },
  saveAs: { label: 'Save Result As', description: 'Variable name or assignment path (e.g., result, vars.result, payload.result)' },
  idempotencyKey: {
    label: 'Idempotency Key',
    description: 'Expression that produces a unique key to prevent duplicate executions. If the same key is seen twice, the cached result is returned.',
    advanced: true
  },
  onError: { label: 'Error Handling', description: 'How to handle errors', advanced: true },
  eventName: { label: 'Event Name', description: 'Name of the event to wait for' },
  correlationKey: { label: 'Correlation Key', description: 'Expression to match incoming events' },
  filters: { label: 'Payload Filters', description: 'Optional event payload filters (AND semantics)' },
  timeoutMs: { label: 'Timeout (ms)', description: 'Maximum time to wait in milliseconds', advanced: true },
  mode: { label: 'Wait Mode', description: 'Duration or until time' },
  durationMs: { label: 'Duration', description: 'Relative duration stored in milliseconds' },
  until: { label: 'Until', description: 'Expression resolving to an absolute date/time' },
  state: { label: 'State Name', description: 'The state to transition to' },
  assign: { label: 'Assignments', description: 'Variables to assign' },
  taskType: { label: 'Task Type', description: 'Type of human task' },
  title: { label: 'Title', description: 'Task title shown to assignee' },
  contextData: { label: 'Context Data', description: 'Additional data to include with the task' },
};

const getFieldMeta = (
  t: TFunction,
  key: string,
): { label: string; description?: string; advanced?: boolean } => {
  const defaults = FIELD_METADATA_DEFAULTS[key];
  if (defaults) {
    return {
      label: t(`designer.fieldMetadata.${key}.label`, { defaultValue: defaults.label }),
      description: defaults.description
        ? t(`designer.fieldMetadata.${key}.description`, { defaultValue: defaults.description })
        : undefined,
      advanced: defaults.advanced,
    };
  }
  // Convert camelCase to Title Case as fallback
  const fallbackLabel = key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();
  return { label: fallbackLabel };
};

const getSchemaFormVisibleEntries = (
  schema: JsonSchema,
  rootSchema: JsonSchema,
  excludeFields: string[]
) => {
  const resolved = resolveSchema(schema, rootSchema);
  const allProperties = resolved.properties ?? {};
  return Object.entries(allProperties).filter(([key]) => !excludeFields.includes(key));
};

const SchemaForm: React.FC<{
  schema: JsonSchema;
  rootSchema: JsonSchema;
  value: Record<string, unknown> | undefined;
  onChange: (value: Record<string, unknown>) => void;
  fieldOptions: SelectOption[];
  actionRegistry: ActionRegistryItem[];
  stepId: string;
  excludeFields?: string[];
  sectionTitle?: string;
  showSectionHeader?: boolean;
  expressionContext?: ExpressionContext;
  disabled?: boolean;
}> = ({
  schema,
  rootSchema,
  value,
  onChange,
  fieldOptions,
  actionRegistry,
  stepId,
  excludeFields = [],
  sectionTitle,
  showSectionHeader = true,
  expressionContext,
  disabled = false
}) => {
  const { t } = useTranslation('msp/workflows');
  const resolvedSectionTitle = sectionTitle ?? t('designer.schemaForm.sectionTitle', { defaultValue: 'Node Configuration' });
  const resolved = resolveSchema(schema, rootSchema);
  const configValue = value ?? {};
  const fieldEntries = getSchemaFormVisibleEntries(schema, rootSchema, excludeFields);
  const properties = Object.fromEntries(fieldEntries);
  const required = (resolved.required ?? []).filter((key) => !excludeFields.includes(key));
  const [showAdvanced, setShowAdvanced] = useState(false);

  const updateValue = (key: string, nextValue: unknown) => {
    onChange({
      ...configValue,
      [key]: nextValue
    });
  };

  const missingRequired = required.filter((key) => {
    const current = configValue[key];
    if (current === undefined || current === null) return true;
    if (typeof current === 'string' && current.trim() === '') return true;
    if (isExprSchema(properties[key], rootSchema)) {
      const exprValue = current as Expr | undefined;
      return !exprValue?.$expr?.trim();
    }
    return false;
  });

  // Separate regular and advanced fields
  const regularFields = fieldEntries.filter(([key]) => !getFieldMeta(t, key).advanced);
  const advancedFields = fieldEntries.filter(([key]) => getFieldMeta(t, key).advanced);

  const renderField = (key: string, propSchema: JsonSchema) => {
    const resolvedProp = resolveSchema(propSchema, rootSchema);
    const meta = getFieldMeta(t, key);
    const fieldDescription = meta.description || resolvedProp.description;

    if (isExprSchema(resolvedProp, rootSchema)) {
      return (
        <ExpressionField
          key={key}
          idPrefix={`config-${stepId}-${key}`}
          label={meta.label}
          value={ensureExpr(configValue[key] as Expr | undefined)}
          onChange={(expr) => updateValue(key, expr)}
          fieldOptions={fieldOptions}
          description={fieldDescription}
          context={expressionContext}
          disabled={disabled}
        />
      );
    }

    if (resolvedProp.enum) {
      return (
        <div key={key}>
          <CustomSelect
            id={`config-${stepId}-${key}`}
            label={meta.label}
            options={resolvedProp.enum.map((item) => ({ value: String(item ?? ''), label: String(item ?? '') }))}
            value={configValue[key] === undefined || configValue[key] === null ? '' : String(configValue[key])}
            onValueChange={(val) => updateValue(key, val)}
            disabled={disabled}
          />
          {fieldDescription && <div className="text-xs text-gray-500 mt-1">{fieldDescription}</div>}
        </div>
      );
    }

    const propType = normalizeSchemaType(resolvedProp);
    if (propType === 'string') {
      return (
        <div key={key}>
          <Input
            id={`config-${stepId}-${key}`}
            label={meta.label}
            value={(configValue[key] as string) ?? ''}
            disabled={disabled}
            onChange={(event) => updateValue(key, event.target.value)}
          />
          {fieldDescription && <div className="text-xs text-gray-500 mt-1">{fieldDescription}</div>}
        </div>
      );
    }

    if (propType === 'number' || propType === 'integer') {
      return (
        <div key={key}>
          <Input
            id={`config-${stepId}-${key}`}
            label={meta.label}
            type="number"
            value={(configValue[key] as number) ?? 0}
            disabled={disabled}
            onChange={(event) => updateValue(key, Number(event.target.value))}
          />
          {fieldDescription && <div className="text-xs text-gray-500 mt-1">{fieldDescription}</div>}
        </div>
      );
    }

    if (propType === 'boolean') {
      return (
        <div key={key} className="flex items-center justify-between">
          <div>
            <Label htmlFor={`config-${stepId}-${key}`}>{meta.label}</Label>
            {fieldDescription && <div className="text-xs text-gray-500">{fieldDescription}</div>}
          </div>
          <Switch
            id={`config-${stepId}-${key}`}
            checked={Boolean(configValue[key])}
            disabled={disabled}
            onCheckedChange={(checked) => updateValue(key, checked)}
          />
        </div>
      );
    }

    if (propType === 'object') {
      if (resolvedProp.additionalProperties && typeof resolvedProp.additionalProperties === 'object' && isExprSchema(resolvedProp.additionalProperties, rootSchema)) {
        return (
          <MappingExprEditor
            key={key}
            idPrefix={`config-${stepId}-${key}`}
            label={meta.label}
            value={(configValue[key] as Record<string, Expr>) ?? {}}
            onChange={(mapping) => updateValue(key, mapping)}
            fieldOptions={fieldOptions}
            context={expressionContext}
            disabled={disabled}
          />
        );
      }

      if (resolvedProp.additionalProperties) {
        return (
          <JsonField
            key={key}
            idPrefix={`config-${stepId}-${key}`}
            label={meta.label}
            value={configValue[key]}
            onChange={(nextValue) => updateValue(key, nextValue)}
            disabled={disabled}
          />
        );
      }

      return (
        <div key={key} className="border border-gray-200 rounded-md p-3 space-y-2">
          <div className="text-xs font-semibold text-gray-500 uppercase">{meta.label}</div>
          {fieldDescription && <div className="text-xs text-gray-500 mb-2">{fieldDescription}</div>}
          <SchemaForm
            schema={resolvedProp}
            rootSchema={rootSchema}
            value={(configValue[key] as Record<string, unknown>) ?? {}}
            onChange={(next) => updateValue(key, next)}
            fieldOptions={fieldOptions}
            actionRegistry={actionRegistry}
            stepId={`${stepId}-${key}`}
            showSectionHeader={false}
            expressionContext={expressionContext}
            disabled={disabled}
          />
        </div>
      );
    }

    if (propType === 'array') {
      return (
        <div key={key}>
          <JsonField
            idPrefix={`config-${stepId}-${key}`}
            label={meta.label}
            value={configValue[key]}
            onChange={(nextValue) => updateValue(key, nextValue)}
            disabled={disabled}
          />
          {fieldDescription && <div className="text-xs text-gray-500 mt-1">{fieldDescription}</div>}
        </div>
      );
    }

    return (
      <div key={key}>
        <JsonField
          idPrefix={`config-${stepId}-${key}`}
          label={meta.label}
          value={configValue[key]}
          onChange={(nextValue) => updateValue(key, nextValue)}
          disabled={disabled}
        />
        {fieldDescription && <div className="text-xs text-gray-500 mt-1">{fieldDescription}</div>}
      </div>
    );
  };

  if (fieldEntries.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {showSectionHeader && (
        <div>
          <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">{resolvedSectionTitle}</div>
          {missingRequired.length > 0 && (
            <div className="text-xs text-destructive">
              {t('designer.schemaForm.missingRequired', {
                defaultValue: 'Missing required: {{fields}}',
                fields: missingRequired.map(k => getFieldMeta(t, k).label).join(', '),
              })}
            </div>
          )}
        </div>
      )}

      {/* Regular fields */}
      {regularFields.map(([key, propSchema]) => renderField(key, propSchema))}

      {/* Advanced fields (collapsible) */}
      {advancedFields.length > 0 && (
        <div className="border-t border-gray-200 pt-3">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-700"
          >
            {showAdvanced ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            Advanced Options
          </button>
          {showAdvanced && (
            <div className="mt-3 space-y-4">
              {advancedFields.map(([key, propSchema]) => renderField(key, propSchema))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const ExpressionField: React.FC<{
  idPrefix: string;
  label: string;
  value: Expr;
  onChange: (expr: Expr) => void;
  fieldOptions: SelectOption[];
  description?: string;
  context?: ExpressionContext;
  disabled?: boolean;
}> = ({ idPrefix, label, value, onChange, fieldOptions, description, context, disabled = false }) => {
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<ExpressionEditorHandle>(null);

  const handleChange = useCallback((nextValue: string) => {
    const expr = { $expr: nextValue };
    try {
      if (nextValue.trim().length > 0) {
        validateExpressionSource(nextValue);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid expression');
    }
    onChange(expr);
  }, [onChange]);

  const handleInsert = useCallback((path: string) => {
    if (!path) return;
    editorRef.current?.insertAtCursor(path);
  }, []);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={`${idPrefix}-expr`}>{label}</Label>
        <CustomSelect
          id={`${idPrefix}-picker`}
          options={fieldOptions}
          value=""
          placeholder="Insert field"
          onValueChange={handleInsert}
          allowClear
          className="w-44"
          disabled={disabled}
        />
      </div>
      <ExpressionEditor
        ref={editorRef}
        value={value.$expr ?? ''}
        onChange={handleChange}
        context={context}
        singleLine={false}
        height={60}
        placeholder="Enter expression..."
        hasError={!!error}
        ariaLabel={label}
        readOnly={disabled}
      />
      {error && <div className="text-xs text-destructive">{error}</div>}
      {description && !error && <div className="text-xs text-gray-500">{description}</div>}
    </div>
  );
};

const MappingExprEditor: React.FC<{
  idPrefix: string;
  label: string;
  value: Record<string, Expr>;
  onChange: (value: Record<string, Expr>) => void;
  fieldOptions: SelectOption[];
  context?: ExpressionContext;
  disabled?: boolean;
}> = ({ idPrefix, label, value, onChange, fieldOptions, context, disabled = false }) => {
  const { t } = useTranslation('msp/workflows');
  const entries = Object.entries(value);

  const handleUpdate = (key: string, expr: Expr) => {
    onChange({ ...value, [key]: expr });
  };

  const handleKeyChange = (oldKey: string, newKey: string) => {
    if (!newKey.trim()) return;
    const next = { ...value };
    const expr = next[oldKey];
    delete next[oldKey];
    next[newKey] = expr;
    onChange(next);
  };

  const handleRemove = (key: string) => {
    const next = { ...value };
    delete next[key];
    onChange(next);
  };

  const handleAdd = () => {
    const nextKey = `field_${entries.length + 1}`;
    onChange({ ...value, [nextKey]: { $expr: '' } });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <Button id={`${idPrefix}-add`} variant="outline" size="sm" onClick={handleAdd} disabled={disabled}>
          {t('designer.mappingExpr.add', { defaultValue: 'Add' })}
        </Button>
      </div>
      {entries.length === 0 && (
        <div className="text-xs text-gray-400">
          {t('designer.mappingExpr.empty', { defaultValue: 'No mappings yet.' })}
        </div>
      )}
      <div className="space-y-3">
        {entries.map(([key, expr], index) => (
          <Card key={key} className="p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Input
                id={`${idPrefix}-key-${index}`}
                value={key}
                disabled={disabled}
                onChange={(event) => handleKeyChange(key, event.target.value)}
              />
              <Button
                id={`${idPrefix}-remove-${index}`}
                variant="ghost"
                size="sm"
                onClick={() => handleRemove(key)}
                disabled={disabled}
              >
                {t('designer.mappingExpr.remove', { defaultValue: 'Remove' })}
              </Button>
            </div>
            <ExpressionField
              idPrefix={`${idPrefix}-expr-${index}`}
              label={t('designer.mappingExpr.expressionLabel', { defaultValue: 'Expression' })}
              value={expr}
              onChange={(nextExpr) => handleUpdate(key, nextExpr)}
              fieldOptions={fieldOptions}
              context={context}
              disabled={disabled}
            />
          </Card>
        ))}
      </div>
    </div>
  );
};

const JsonField: React.FC<{
  idPrefix: string;
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}> = ({ idPrefix, label, value, onChange, disabled = false }) => {
  const [text, setText] = useState(() => JSON.stringify(value ?? {}, null, 2));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(JSON.stringify(value ?? {}, null, 2));
  }, [value]);

  const handleChange = (nextValue: string) => {
    setText(nextValue);
    try {
      const parsed = JSON.parse(nextValue);
      setError(null);
      onChange(parsed);
    } catch (err) {
      setError('Invalid JSON');
    }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={`${idPrefix}-json`}>{label}</Label>
      <TextArea
        id={`${idPrefix}-json`}
        value={text}
        disabled={disabled}
        onChange={(event) => handleChange(event.target.value)}
        rows={4}
        className={error ? 'border-destructive focus:ring-destructive focus:border-destructive' : ''}
      />
      {error && <div className="text-xs text-destructive">{error}</div>}
    </div>
  );
};

// §16.1 - Schema Field Row Component
const SchemaFieldRow: React.FC<{
  field: SchemaField;
  pathPrefix: string;
  depth?: number;
  onCopyPath?: (path: string) => void;
}> = ({ field, pathPrefix, depth = 0, onCopyPath }) => {
  const [expanded, setExpanded] = useState(depth < 2);
  const [copied, setCopied] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const hasChildren = field.children && field.children.length > 0;
  const fullPath = pathPrefix ? `${pathPrefix}.${field.name}` : field.name;

  const handleCopy = () => {
    const exprPath = `\${${fullPath}}`;
    navigator.clipboard.writeText(exprPath);
    setCopied(true);
    onCopyPath?.(exprPath);
    setTimeout(() => setCopied(false), 2000);
  };

  const typeColor = {
    string: 'text-green-600',
    number: 'text-blue-600',
    integer: 'text-blue-600',
    boolean: 'text-purple-600',
    object: 'text-orange-600',
    array: 'text-cyan-600'
  }[field.type] ?? 'text-gray-600';

  // §16.4 - Build tooltip content for constraints
  const hasConstraints = field.constraints && Object.keys(field.constraints).length > 0;
  const constraintLines: string[] = [];
  if (field.constraints) {
    if (field.constraints.enum) {
      constraintLines.push(`Values: ${field.constraints.enum.slice(0, 5).map(v => JSON.stringify(v)).join(', ')}${field.constraints.enum.length > 5 ? '...' : ''}`);
    }
    if (field.constraints.minimum !== undefined) constraintLines.push(`Min: ${field.constraints.minimum}`);
    if (field.constraints.maximum !== undefined) constraintLines.push(`Max: ${field.constraints.maximum}`);
    if (field.constraints.minLength !== undefined) constraintLines.push(`Min length: ${field.constraints.minLength}`);
    if (field.constraints.maxLength !== undefined) constraintLines.push(`Max length: ${field.constraints.maxLength}`);
    if (field.constraints.pattern) constraintLines.push(`Pattern: ${field.constraints.pattern}`);
    if (field.constraints.format) constraintLines.push(`Format: ${field.constraints.format}`);
    if (field.constraints.examples) constraintLines.push(`Examples: ${field.constraints.examples.slice(0, 3).map(v => JSON.stringify(v)).join(', ')}`);
  }
  if (field.defaultValue !== undefined) {
    constraintLines.push(`Default: ${JSON.stringify(field.defaultValue)}`);
  }

  return (
    <div className="text-xs">
      <div
        className={`flex items-center gap-1 py-1 px-1 rounded hover:bg-gray-50 group ${depth > 0 ? 'ml-3' : ''}`}
        style={{ paddingLeft: depth > 0 ? `${depth * 12}px` : undefined }}
      >
        {hasChildren ? (
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-0.5 hover:bg-gray-200 rounded"
          >
            {expanded ? (
              <ChevronDown className="w-3 h-3 text-gray-500" />
            ) : (
              <ChevronRight className="w-3 h-3 text-gray-500" />
            )}
          </button>
        ) : (
          <span className="w-4" />
        )}

        <span className="font-medium text-gray-800">{field.name}</span>
        {field.required && <span className="text-destructive">*</span>}

        {/* §16.4 - Type with tooltip for constraints */}
        <span
          className={`${typeColor} font-mono relative ${hasConstraints || field.defaultValue !== undefined ? 'cursor-help underline decoration-dotted' : ''}`}
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
        >
          {field.type}
          {showTooltip && constraintLines.length > 0 && (
            <div className="absolute left-0 top-full mt-1 z-50 bg-gray-900 text-white text-[10px] px-2 py-1.5 rounded shadow-lg whitespace-nowrap">
              {constraintLines.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          )}
        </span>
        {field.nullable && <span className="text-gray-400">| null</span>}

        <button
          onClick={handleCopy}
          className="ml-auto opacity-0 group-hover:opacity-100 p-0.5 hover:bg-gray-200 rounded transition-opacity"
          title={`Copy ${fullPath}`}
        >
          {copied ? (
            <Check className="w-3 h-3 text-green-600" />
          ) : (
            <Copy className="w-3 h-3 text-gray-500" />
          )}
        </button>
      </div>

      {field.description && (
        <div className="text-gray-500 text-[10px] ml-6 pl-1" style={{ paddingLeft: depth > 0 ? `${depth * 12 + 12}px` : undefined }}>
          {field.description}
        </div>
      )}

      {hasChildren && expanded && (
        <div className="border-l border-gray-200 ml-2">
          {field.children!.map((child) => (
            <SchemaFieldRow
              key={child.name}
              field={child}
              pathPrefix={fullPath}
              depth={depth + 1}
              onCopyPath={onCopyPath}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// §16.1 - Schema Reference Section (collapsible)
const SchemaReferenceSection: React.FC<{
  title: string;
  icon?: React.ReactNode;
  fields: SchemaField[];
  pathPrefix: string;
  defaultExpanded?: boolean;
  emptyMessage?: string;
  onCopyPath?: (path: string) => void;
  headerExtra?: React.ReactNode;
}> = ({ title, icon, fields, pathPrefix, defaultExpanded = false, emptyMessage = 'No fields', onCopyPath, headerExtra }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [copiedAll, setCopiedAll] = useState(false);

  // §16.7 - Collect all paths recursively
  const getAllPaths = (fieldList: SchemaField[], prefix: string): string[] => {
    const paths: string[] = [];
    for (const field of fieldList) {
      const fullPath = `\${${prefix}.${field.name}}`;
      paths.push(fullPath);
      if (field.children) {
        paths.push(...getAllPaths(field.children, `${prefix}.${field.name}`));
      }
    }
    return paths;
  };

  const handleCopyAllPaths = (e: React.MouseEvent) => {
    e.stopPropagation();
    const allPaths = getAllPaths(fields, pathPrefix);
    navigator.clipboard.writeText(allPaths.join('\n'));
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
    onCopyPath?.(`${allPaths.length} paths copied`);
  };

  return (
    <div className="border border-gray-200 rounded-md overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-gray-500" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-500" />
        )}
        {icon}
        <span className="text-xs font-semibold text-gray-700">{title}</span>
        <Badge variant="default" className="ml-auto text-[10px] px-1.5 py-0">
          {fields.length}
        </Badge>
        {headerExtra}
      </button>

      {expanded && (
        <div className="px-2 py-2 bg-white dark:bg-[rgb(var(--color-card))] max-h-64 overflow-y-auto">
          {fields.length === 0 ? (
            <div className="text-xs text-gray-400 text-center py-2">{emptyMessage}</div>
          ) : (
            <>
              {/* §16.7 - Copy all paths button */}
              <div className="flex justify-end mb-1">
                <button
                  onClick={handleCopyAllPaths}
                  className="text-[10px] text-gray-500 hover:text-gray-700 flex items-center gap-1"
                  title="Copy all field paths"
                >
                  {copiedAll ? (
                    <>
                      <Check className="w-3 h-3 text-green-600" />
                      <span className="text-green-600">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Copy all paths</span>
                    </>
                  )}
                </button>
              </div>
              {fields.map((field) => (
                <SchemaFieldRow
                  key={field.name}
                  field={field}
                  pathPrefix={pathPrefix}
                  onCopyPath={onCopyPath}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
};

// §16.3 - Data Context Panel (shows available data at current step)
const DataContextPanel: React.FC<{
  context: DataContext;
  onCopyPath?: (path: string) => void;
}> = ({ context, onCopyPath }) => {
  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold text-gray-700 flex items-center gap-2">
        <HelpCircle className="w-3.5 h-3.5" />
        Available Data at This Step
      </div>

      {/* Payload */}
      <SchemaReferenceSection
        title="Payload"
        fields={context.payload}
        pathPrefix="payload"
        defaultExpanded={true}
        emptyMessage={context.payloadSchema ? "No payload fields" : "Set 'Payload schema ref' to define payload structure"}
        onCopyPath={onCopyPath}
      />

      {/* Previous step outputs */}
      <div className="space-y-2">
        <div className="text-[10px] font-semibold text-gray-500 uppercase">Step Outputs (vars)</div>
        {context.steps.length > 0 ? (
          context.steps.map((stepOutput) => (
            <SchemaReferenceSection
              key={stepOutput.stepId}
              title={stepOutput.stepName}
              fields={stepOutput.fields}
              pathPrefix={`vars.${stepOutput.saveAs}`}
              defaultExpanded={false}
              emptyMessage="Output schema not available"
              onCopyPath={onCopyPath}
              headerExtra={
                <span className="text-[10px] text-gray-400 font-normal">
                  vars.{stepOutput.saveAs}
                </span>
              }
            />
          ))
        ) : (
          <div className="text-xs text-gray-400 p-2 border border-dashed border-gray-200 rounded-md text-center">
            No previous steps with "Save output as" configured
          </div>
        )}
      </div>

      {/* Globals */}
      <div className="space-y-2">
        <div className="text-[10px] font-semibold text-gray-500 uppercase">Globals</div>
        <SchemaReferenceSection
          title="meta"
          fields={context.globals.meta}
          pathPrefix="meta"
          defaultExpanded={false}
          onCopyPath={onCopyPath}
        />
        <SchemaReferenceSection
          title="error"
          fields={context.globals.error}
          pathPrefix="error"
          defaultExpanded={false}
          onCopyPath={onCopyPath}
        />
      </div>
    </div>
  );
};

export default WorkflowDesigner;
