'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DragDropContext, Draggable, Droppable, DropResult } from '@hello-pangea/dnd';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'react-hot-toast';
import {
  Plus, ChevronRight, ChevronDown, AlertTriangle, Copy, Info, HelpCircle,
  FileJson, Code, Check, Eye, EyeOff, Play, Trash2,
  // Dense palette icons
  GitBranch, Repeat, Shield, CornerDownRight, ArrowRight, Clock, User, Settings,
  Zap, Database, Link, Workflow, Mail, Send, Inbox, MailOpen,
  FileText, Layers, Box, Cog, Terminal, Globe, Search, GripVertical,
  // Business operations icons
  MessageSquare, Edit, UserPlus, CheckCircle, Paperclip, Building,
  Bell, Calendar, SquareCheck, StickyNote, ClipboardList
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
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Card } from '@alga-psa/ui/components/Card';
import { Badge } from '@alga-psa/ui/components/Badge';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import CustomTabs from '@alga-psa/ui/components/CustomTabs';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Label } from '@alga-psa/ui/components/Label';
import SearchableSelect from '@alga-psa/ui/components/SearchableSelect';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { analytics } from '@alga-psa/analytics/client';
import WorkflowRunList from './WorkflowRunList';
import WorkflowDeadLetterQueue from './WorkflowDeadLetterQueue';
import WorkflowEventList from './WorkflowEventList';
import WorkflowDefinitionAudit from './WorkflowDefinitionAudit';
import WorkflowRunDialog from './WorkflowRunDialog';
import WorkflowGraph from '../workflow-graph/WorkflowGraph';
import WorkflowListV2 from '../../../components/automation-hub/WorkflowList';
import { MappingPanel, type ActionInputField } from './mapping';
import { ExpressionEditor, type ExpressionEditorHandle, type ExpressionContext, type JsonSchema as ExprJsonSchema } from './expression-editor';
import { getCurrentUser, getCurrentUserPermissions } from '@alga-psa/users/actions';
import { getEventCatalogEntryByEventType } from '../../../actions';
import { listEventCatalogOptionsV2Action, type WorkflowEventCatalogOptionV2 } from '../../../actions';
import {
  createWorkflowDefinitionAction,
  getWorkflowSchemaAction,
  getWorkflowDefinitionVersionAction,
  listWorkflowSchemaRefsAction,
  listWorkflowSchemasMetaAction,
  listWorkflowDefinitionsAction,
  listWorkflowRegistryActionsAction,
  listWorkflowRegistryNodesAction,
  listWorkflowRunsAction,
  publishWorkflowDefinitionAction,
  updateWorkflowDefinitionDraftAction,
  updateWorkflowDefinitionMetadataAction
} from '../../../actions';

import type {
  WorkflowDefinition,
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
} from '@shared/workflow/runtime';
import { validateExpressionSource } from '@shared/workflow/runtime/expressionEngine';
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
  $ref?: string;
  definitions?: Record<string, JsonSchema>;
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

type PipeSegment = {
  index: number;
  branch: 'then' | 'else' | 'try' | 'catch' | 'body';
};

type PipeLocation = {
  pipePath: string;
  label: string;
};

const CONTROL_BLOCKS: Array<{ id: Step['type']; label: string; category: string; description: string }> = [
  { id: 'control.if', label: 'If', category: 'Control', description: 'Conditional branching' },
  { id: 'control.forEach', label: 'For Each', category: 'Control', description: 'Iterate over items' },
  { id: 'control.tryCatch', label: 'Try/Catch', category: 'Control', description: 'Handle errors' },
  { id: 'control.callWorkflow', label: 'Call Workflow', category: 'Control', description: 'Invoke another workflow' },
  { id: 'control.return', label: 'Return', category: 'Control', description: 'Stop execution' }
];

const DEFAULT_PAYLOAD_SCHEMA = 'payload.EmailWorkflowPayload.v1';

const createDefaultDefinition = (): WorkflowDefinition => ({
  id: uuidv4(),
  version: 1,
  name: 'New Workflow',
  description: '',
  payloadSchemaRef: DEFAULT_PAYLOAD_SCHEMA,
  steps: []
});

const isExprSchema = (schema: JsonSchema | undefined, root?: JsonSchema): boolean => {
  const resolved = schema ? resolveSchema(schema, root) : undefined;
  if (!resolved || resolved.type !== 'object' || !resolved.properties) return false;
  return Boolean(resolved.properties.$expr);
};

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
      return {
        ...resolved,
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

    let children: ActionInputField[] | undefined;
    if (type === 'object' && resolvedProp.properties) {
      children = extractActionInputFields(resolvedProp, root);
    } else if (type === 'array' && resolvedProp.items) {
      const itemSchema = resolveSchema(resolvedProp.items, root);
      if (itemSchema.properties) {
        children = extractActionInputFields(itemSchema, root);
      }
    }

    return {
      name,
      type,
      description: resolvedProp.description,
      required: isFieldRequired,
      enum: resolvedProp.enum,
      default: resolvedProp.default,
      children
    };
  });
};

// Block context for tracking forEach and catch blocks
type BlockContext = {
  forEach?: { itemVar: string; indexVar: string; itemType?: string };
  inCatchBlock?: boolean;
};

// Build data context for a specific step position in the workflow
const buildDataContext = (
  definition: WorkflowDefinition,
  currentStepId: string,
  actionRegistry: ActionRegistryItem[],
  payloadSchema: JsonSchema | null
): DataContext => {
  const context: DataContext = {
    payload: payloadSchema ? extractSchemaFields(payloadSchema, payloadSchema) : [],
    payloadSchema,
    steps: [],
    globals: {
      env: [{ name: 'env', type: 'object', required: false, nullable: false, description: 'Environment variables' }],
      secrets: [{ name: 'secrets', type: 'object', required: false, nullable: false, description: 'Workflow secrets' }],
      meta: [
        { name: 'state', type: 'string', required: false, nullable: true, description: 'Workflow state' },
        { name: 'traceId', type: 'string', required: false, nullable: true, description: 'Trace ID' },
        { name: 'tags', type: 'object', required: false, nullable: true, description: 'Workflow tags' }
      ],
      error: [
        { name: 'name', type: 'string', required: false, nullable: true, description: 'Error name' },
        { name: 'message', type: 'string', required: false, nullable: true, description: 'Error message' },
        { name: 'stack', type: 'string', required: false, nullable: true, description: 'Stack trace' },
        { name: 'nodePath', type: 'string', required: false, nullable: true, description: 'Error location' }
      ]
    }
  };

  // Walk through steps to build context up to currentStepId
  // Returns the block context if the target step is found
  const walkSteps = (steps: Step[], stopAtId: string, blockCtx: BlockContext): BlockContext | null => {
    for (const step of steps) {
      if (step.id === stopAtId) {
        // Found the target step - return the current block context
        return blockCtx;
      }

      // Handle any node step (not control blocks) that has saveAs configured
      if (!step.type.startsWith('control.')) {
        const nodeStep = step as NodeStep;
        const config = nodeStep.config as { actionId?: string; version?: number; saveAs?: string } | undefined;

        if (config?.saveAs) {
          // For action.call steps, look up the action's output schema
          if (step.type === 'action.call' && config?.actionId) {
            // Match by actionId, and optionally by version if specified
            const action = actionRegistry.find(a =>
              a.id === config.actionId &&
              (config.version === undefined || a.version === config.version)
            );
            if (action?.outputSchema) {
              context.steps.push({
                stepId: step.id,
                stepName: nodeStep.name || action.ui?.label || config.actionId,
                saveAs: config.saveAs,
                outputSchema: action.outputSchema,
                fields: extractSchemaFields(action.outputSchema, action.outputSchema)
              });
            }
          } else {
            // For custom node types, look up the action by the step type (which matches action.id)
            const action = actionRegistry.find(a => a.id === step.type);
            if (action?.outputSchema) {
              context.steps.push({
                stepId: step.id,
                stepName: nodeStep.name || action.ui?.label || step.type,
                saveAs: config.saveAs,
                outputSchema: action.outputSchema,
                fields: extractSchemaFields(action.outputSchema, action.outputSchema)
              });
            } else {
              // If no schema found, still show the step output as available (with empty fields)
              context.steps.push({
                stepId: step.id,
                stepName: nodeStep.name || step.type,
                saveAs: config.saveAs,
                outputSchema: {},
                fields: []
              });
            }
          }
        }
      }

      // Walk nested blocks with updated context
      if (step.type === 'control.if') {
        const ifBlock = step as IfBlock;
        const found = walkSteps(ifBlock.then, stopAtId, blockCtx);
        if (found) return found;
        if (ifBlock.else) {
          const foundElse = walkSteps(ifBlock.else, stopAtId, blockCtx);
          if (foundElse) return foundElse;
        }
      } else if (step.type === 'control.forEach') {
        const forEachBlock = step as ForEachBlock;
        // §17.3.1 - Pass forEach context to child steps
        const forEachCtx: BlockContext = {
          ...blockCtx,
          forEach: {
            itemVar: forEachBlock.itemVar,
            indexVar: '$index',
            itemType: 'any' // Could be inferred from items expression if needed
          }
        };
        const found = walkSteps(forEachBlock.body, stopAtId, forEachCtx);
        if (found) return found;
      } else if (step.type === 'control.tryCatch') {
        const tryCatchBlock = step as TryCatchBlock;
        const foundTry = walkSteps(tryCatchBlock.try, stopAtId, blockCtx);
        if (foundTry) return foundTry;
        // §17.3.1 - Pass catch block context (error is available)
        const catchCtx: BlockContext = { ...blockCtx, inCatchBlock: true };
        const foundCatch = walkSteps(tryCatchBlock.catch, stopAtId, catchCtx);
        if (foundCatch) return foundCatch;
      }
    }
    return null;
  };

  const foundBlockCtx = walkSteps(definition.steps, currentStepId, {});

  // Apply block context to DataContext
  if (foundBlockCtx) {
    if (foundBlockCtx.forEach) {
      context.forEach = foundBlockCtx.forEach;
    }
    if (foundBlockCtx.inCatchBlock) {
      context.inCatchBlock = true;
    }
  }

  return context;
};

// Get action by ID and version from registry
const getActionFromRegistry = (
  actionId: string | undefined,
  version: number | undefined,
  actionRegistry: ActionRegistryItem[]
): ActionRegistryItem | undefined => {
  if (!actionId) return undefined;
  return actionRegistry.find(a => a.id === actionId && (version === undefined || a.version === version));
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

// §16.5 - Expression path validation
type ExpressionValidation = {
  valid: boolean;
  error?: string;
  warning?: string;
};

// Extract variable paths from an expression string (e.g., "${payload.email}" -> ["payload.email"])
const extractExpressionPaths = (expr: string): string[] => {
  const paths: string[] = [];
  const regex = /\$\{([^}]+)\}/g;
  let match;
  while ((match = regex.exec(expr)) !== null) {
    // Extract the path portion (handles simple cases)
    const inner = match[1].trim();
    // Skip complex expressions like conditions or calculations
    if (!/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(inner)) continue;
    paths.push(inner);
  }
  return paths;
};

// Check if a path exists in the data context
const validateExpressionPath = (path: string, context: DataContext): ExpressionValidation => {
  const parts = path.split('.');
  const root = parts[0];

  // Check payload paths
  if (root === 'payload') {
    if (context.payload.length === 0) {
      return { valid: true, warning: 'No payload schema defined' };
    }
    // Simple path existence check
    return { valid: true };
  }

  // Check vars paths (step outputs)
  if (root === 'vars') {
    const varName = parts[1];
    if (!varName) return { valid: false, error: 'Missing variable name after vars.' };
    const stepOutput = context.steps.find(s => s.saveAs === varName);
    if (!stepOutput) {
      return { valid: false, error: `Unknown variable: ${varName}. Available: ${context.steps.map(s => s.saveAs).join(', ') || 'none'}` };
    }
    return { valid: true };
  }

  // Check global paths
  if (root === 'meta' || root === 'env' || root === 'secrets' || root === 'error') {
    return { valid: true };
  }

  return { valid: false, error: `Unknown root: ${root}. Use payload, vars, meta, env, or secrets.` };
};

// Validate all expressions in a step config
const validateStepExpressions = (
  config: Record<string, unknown>,
  context: DataContext
): { field: string; validation: ExpressionValidation }[] => {
  const results: { field: string; validation: ExpressionValidation }[] = [];

  const checkValue = (value: unknown, path: string) => {
    if (typeof value === 'string' && value.includes('${')) {
      const exprPaths = extractExpressionPaths(value);
      for (const exprPath of exprPaths) {
        const validation = validateExpressionPath(exprPath, context);
        if (!validation.valid || validation.warning) {
          results.push({ field: path, validation });
        }
      }
    } else if (value && typeof value === 'object') {
      if ('$expr' in (value as Record<string, unknown>)) {
        const expr = (value as { $expr: string }).$expr;
        if (expr) {
          const exprPaths = extractExpressionPaths(expr);
          for (const exprPath of exprPaths) {
            const validation = validateExpressionPath(exprPath, context);
            if (!validation.valid || validation.warning) {
              results.push({ field: path, validation });
            }
          }
        }
      } else if (!Array.isArray(value)) {
        // Recurse into object
        Object.entries(value).forEach(([key, val]) => {
          checkValue(val, `${path}.${key}`);
        });
      }
    }
  };

  Object.entries(config).forEach(([key, val]) => {
    checkValue(val, key);
  });

  return results;
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

// §16.2 - Enhanced field options that include step outputs from data context
const buildEnhancedFieldOptions = (
  payloadSchema: JsonSchema | null,
  dataContext: DataContext | null
): SelectOption[] => {
  const options: SelectOption[] = [
    { value: 'payload', label: '📦 payload' },
    { value: 'vars', label: '📝 vars' },
    { value: 'meta', label: '🏷️ meta' },
    { value: 'meta.state', label: 'meta.state' },
    { value: 'meta.traceId', label: 'meta.traceId' },
    { value: 'meta.tags', label: 'meta.tags' },
    { value: 'error', label: '⚠️ error' },
    { value: 'error.message', label: 'error.message' },
    { value: 'error.code', label: 'error.code' },
    { value: 'error.stack', label: 'error.stack' }
  ];

  // Add payload fields from schema
  if (payloadSchema) {
    collectSchemaPaths(payloadSchema, payloadSchema).forEach((path) => {
      if (!options.some((opt) => opt.value === path)) {
        options.push({ value: path, label: path });
      }
    });
  } else {
    // §16.2 - Add common payload placeholders when no schema is available
    // This allows autocomplete to work even for new workflows without a schema
    const commonPayloadFields = [
      'payload.id',
      'payload.type',
      'payload.data',
      'payload.timestamp',
      'payload.tenant'
    ];
    commonPayloadFields.forEach(path => {
      options.push({ value: path, label: `${path} (placeholder)` });
    });
  }

  // Add step outputs from data context
  if (dataContext) {
    dataContext.steps.forEach((stepOutput) => {
      const basePath = `vars.${stepOutput.saveAs}`;
      options.push({
        value: basePath,
        label: `🔗 ${basePath} (${stepOutput.stepName})`
      });

      // Add nested paths from output schema
      collectSchemaPaths(stepOutput.outputSchema, stepOutput.outputSchema, basePath).forEach((path) => {
        if (!options.some((opt) => opt.value === path)) {
          options.push({ value: path, label: path });
        }
      });
    });

    // §17.3.1 - Add forEach item and index when inside a forEach loop
    if (dataContext.forEach) {
      options.push({
        value: dataContext.forEach.itemVar,
        label: `🔄 ${dataContext.forEach.itemVar} (current item)`
      });
      options.push({
        value: dataContext.forEach.indexVar,
        label: `🔢 ${dataContext.forEach.indexVar} (loop index)`
      });
    }
  }

  return options;
};

const getStepLabel = (step: Step, nodeRegistry: Record<string, NodeRegistryItem>): string => {
  if (step.type === 'control.if') return 'If';
  if (step.type === 'control.forEach') return 'For Each';
  if (step.type === 'control.tryCatch') return 'Try/Catch';
  if (step.type === 'control.callWorkflow') return 'Call Workflow';
  if (step.type === 'control.return') return 'Return';
  const registryItem = nodeRegistry[step.type];
  const name = (step as NodeStep).name?.trim();
  return name || registryItem?.ui?.label || step.type;
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

const WorkflowDesigner: React.FC = () => {
  const [activeTab, setActiveTab] = useState('Workflows');
  const [definitions, setDefinitions] = useState<WorkflowDefinitionRecord[]>([]);
  const [activeDefinition, setActiveDefinition] = useState<WorkflowDefinition | null>(null);
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(null);
  const [runStatusByWorkflow, setRunStatusByWorkflow] = useState<Map<string, string>>(new Map());
  const [runCountByWorkflow, setRunCountByWorkflow] = useState<Map<string, number>>(new Map());
  const [nodeRegistry, setNodeRegistry] = useState<NodeRegistryItem[]>([]);
  const [actionRegistry, setActionRegistry] = useState<ActionRegistryItem[]>([]);
  const [payloadSchema, setPayloadSchema] = useState<JsonSchema | null>(null);
  const [payloadSchemaStatus, setPayloadSchemaStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [payloadSchemaLoadedRef, setPayloadSchemaLoadedRef] = useState<string | null>(null);
  const [triggerSourceSchema, setTriggerSourceSchema] = useState<JsonSchema | null>(null);
  const [triggerSourceSchemaStatus, setTriggerSourceSchemaStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [triggerSourceSchemaLoadedRef, setTriggerSourceSchemaLoadedRef] = useState<string | null>(null);
  const [search, setSearch] = useState('');
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
  const [schemaRefAdvanced, setSchemaRefAdvanced] = useState(false);
  const [triggerSourceSchemaAdvanced, setTriggerSourceSchemaAdvanced] = useState(false);
  const [showRunDialog, setShowRunDialog] = useState(false);
  const [showSchemaModal, setShowSchemaModal] = useState(false);
  const [schemaPreviewExpanded, setSchemaPreviewExpanded] = useState(false);
  const [schemaInferenceEnabled, setSchemaInferenceEnabled] = useState(true);
  const [inferredSchemaRef, setInferredSchemaRef] = useState<string | null>(null);
  const [inferredSchemaStatus, setInferredSchemaStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const lastAppliedInferredRef = useRef<string | null>(null);
  const lastCapturedUnknownSchemaRef = useRef<string | null>(null);
  const [showTriggerMapping, setShowTriggerMapping] = useState(false);
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
  const [isSavingMetadata, setIsSavingMetadata] = useState(false);
  const [stepsViewMode, setStepsViewMode] = useState<'list' | 'graph'>('list');
  const designerFloatAnchorRef = useRef<HTMLDivElement | null>(null);
  const designerFloatAnchorRectRef = useRef<{
    top: number;
    left: number;
    right: number;
    bottom: number;
  } | null>(null);
  const [designerFloatAnchorRect, setDesignerFloatAnchorRect] = useState<{
    top: number;
    left: number;
    right: number;
    bottom: number;
  } | null>(null);

  const nodeRegistryMap = useMemo(() => Object.fromEntries(nodeRegistry.map((node) => [node.id, node])), [nodeRegistry]);
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamsString = searchParams.toString();
  const workflowIdFromQuery = searchParams.get('workflowId');
  const newWorkflowFromQuery = searchParams.get('new') === '1';
  const tabFromQuery = searchParams.get('tab');
  const didApplyWorkflowIdFromQuery = useRef<string | null>(null);
  const didApplyNewWorkflowFromQuery = useRef<boolean>(false);

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

    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      if (rafId != null) window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [activeTab]);

  const stepPathMap = useMemo(() => {
    return activeDefinition ? buildStepPathMap(activeDefinition.steps as Step[]) : {};
  }, [activeDefinition]);

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
          locations.push({ pipePath: `${stepPath}.then`, label: `${getStepLabel(step, nodeRegistryMap)} THEN` });
          locations.push({ pipePath: `${stepPath}.else`, label: `${getStepLabel(step, nodeRegistryMap)} ELSE` });
          visit(ifStep.then, `${stepPath}.then`);
          if (ifStep.else) {
            visit(ifStep.else, `${stepPath}.else`);
          }
        }
        if (step.type === 'control.tryCatch') {
          const tcStep = step as TryCatchBlock;
          locations.push({ pipePath: `${stepPath}.try`, label: `${getStepLabel(step, nodeRegistryMap)} TRY` });
          locations.push({ pipePath: `${stepPath}.catch`, label: `${getStepLabel(step, nodeRegistryMap)} CATCH` });
          visit(tcStep.try, `${stepPath}.try`);
          visit(tcStep.catch, `${stepPath}.catch`);
        }
        if (step.type === 'control.forEach') {
          const feStep = step as ForEachBlock;
          locations.push({ pipePath: `${stepPath}.body`, label: `${getStepLabel(step, nodeRegistryMap)} BODY` });
          visit(feStep.body, `${stepPath}.body`);
        }
      });
    };

    visit(activeDefinition.steps as Step[], 'root');
    return locations;
  }, [activeDefinition, nodeRegistryMap]);

  const activeWorkflowRecord = useMemo(
    () => definitions.find((definition) => definition.workflow_id === activeWorkflowId) ?? null,
    [definitions, activeWorkflowId]
  );

  useEffect(() => {
    // For unsaved drafts (no workflowId yet), keep the local mode state.
    if (!activeWorkflowId) return;
    if (!activeWorkflowRecord) return;
    const mode = (activeWorkflowRecord.payload_schema_mode === 'inferred' ? 'inferred' : 'pinned') as 'inferred' | 'pinned';
    setPayloadSchemaModeDraft(mode);
    setPinnedPayloadSchemaRefDraft(activeWorkflowRecord.pinned_payload_schema_ref ?? activeWorkflowRecord.payload_schema_ref ?? '');
    setSchemaInferenceEnabled(mode === 'inferred');
  }, [activeWorkflowId, activeWorkflowRecord?.workflow_id]);

  const draftValidationErrors = useMemo(
    () => (Array.isArray(activeWorkflowRecord?.validation_errors) ? activeWorkflowRecord?.validation_errors : []) as PublishError[],
    [activeWorkflowRecord?.validation_errors]
  );

  const draftValidationWarnings = useMemo(
    () => (Array.isArray(activeWorkflowRecord?.validation_warnings) ? activeWorkflowRecord?.validation_warnings : []) as PublishError[],
    [activeWorkflowRecord?.validation_warnings]
  );

  const currentValidationErrors = publishErrors.length > 0 ? publishErrors : draftValidationErrors;
  const currentValidationWarnings = publishWarnings.length > 0 ? publishWarnings : draftValidationWarnings;

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
        return { label: 'Invalid', className: 'bg-red-100 text-red-700 border-red-200' };
      case 'warning':
        return { label: 'Warnings', className: 'bg-yellow-100 text-yellow-700 border-yellow-200' };
      case 'valid':
        return { label: 'Valid', className: 'bg-green-100 text-green-700 border-green-200' };
      default:
        return { label: 'Unknown', className: 'bg-gray-100 text-gray-600 border-gray-200' };
    }
  }, [workflowValidationStatus]);

  const canAdmin = useMemo(
    () => userPermissions.includes('workflow:admin'),
    [userPermissions]
  );
  const canManage = useMemo(
    () => userPermissions.includes('workflow:manage') || canAdmin,
    [userPermissions, canAdmin]
  );

  const tabLabelFromQuery = useMemo(() => {
    const raw = (tabFromQuery ?? '').trim().toLowerCase();
    if (!raw) return null;
    if (raw === 'workflows' || raw === 'list') return 'Workflows';
    if (raw === 'designer') return 'Designer';
    if (raw === 'runs') return 'Runs';
    if (raw === 'events') return 'Events';
    if (raw === 'dead-letter' || raw === 'deadletter' || raw === 'dead_letter') return 'Dead Letter';
    if (raw === 'audit') return 'Audit';
    return null;
  }, [tabFromQuery]);

  useEffect(() => {
    if (!tabLabelFromQuery) return;

    const isAdminTab = tabLabelFromQuery === 'Dead Letter' || tabLabelFromQuery === 'Audit';
    if (isAdminTab && !canAdmin) {
      const params = new URLSearchParams(searchParamsString);
      params.set('tab', 'workflows');
      router.replace(`/msp/workflows?${params.toString()}`);
      return;
    }

    setActiveTab(tabLabelFromQuery);
  }, [canAdmin, router, searchParamsString, tabLabelFromQuery]);

  const handleTabChange = useCallback((nextTabLabel: string) => {
    setActiveTab(nextTabLabel);

    const tabValue =
      nextTabLabel === 'Workflows' ? 'workflows'
        : nextTabLabel === 'Designer' ? 'designer'
          : nextTabLabel === 'Runs' ? 'runs'
            : nextTabLabel === 'Events' ? 'events'
              : nextTabLabel === 'Dead Letter' ? 'dead-letter'
                : nextTabLabel === 'Audit' ? 'audit'
                  : null;

    if (!tabValue) return;

    const params = new URLSearchParams(searchParamsString);
    params.set('tab', tabValue);
    const nextParamsString = params.toString();
    if (nextParamsString !== searchParamsString) {
      router.replace(`/msp/workflows?${nextParamsString}`);
    }
  }, [router, searchParamsString]);

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
  const canPublishEnabled =
    canPublishPermission &&
    triggerSchemaPolicy.ok &&
    payloadSchemaPolicy.ok &&
    (!triggerRequiresEventCatalog || eventCatalogStatus === 'loaded');
  const canRunEnabled =
    canRunPermission &&
    triggerSchemaPolicy.ok &&
    payloadSchemaPolicy.ok &&
    (!triggerRequiresEventCatalog || eventCatalogStatus === 'loaded');

  const publishDisabledReason = useMemo(() => {
    if (!canPublishPermission) return '';
    if (!triggerSchemaPolicy.ok) return triggerSchemaPolicy.message;
    if (!payloadSchemaPolicy.ok) return payloadSchemaPolicy.message;
    if (triggerRequiresEventCatalog && eventCatalogStatus !== 'loaded') return 'Event catalog is still loading. Publishing is disabled until it loads.';
    if (registryStatus !== 'loaded' && schemaRefs.length === 0) return 'Schema registry is still loading. Publishing is disabled until it loads.';
    return '';
  }, [canPublishPermission, eventCatalogStatus, payloadSchemaPolicy, registryStatus, schemaRefs.length, triggerRequiresEventCatalog, triggerSchemaPolicy]);

  const runDisabledReason = useMemo(() => {
    if (!canRunPermission) return '';
    if (!triggerSchemaPolicy.ok) return triggerSchemaPolicy.message;
    if (!payloadSchemaPolicy.ok) return payloadSchemaPolicy.message;
    if (triggerRequiresEventCatalog && eventCatalogStatus !== 'loaded') return 'Event catalog is still loading. Running is disabled until it loads.';
    if (registryStatus !== 'loaded' && schemaRefs.length === 0) return 'Schema registry is still loading. Running is disabled until it loads.';
    return '';
  }, [canRunPermission, eventCatalogStatus, payloadSchemaPolicy, registryStatus, schemaRefs.length, triggerRequiresEventCatalog, triggerSchemaPolicy]);
  const canEditMetadata = useMemo(
    () => canManage && (!activeWorkflowRecord?.is_system || canAdmin),
    [canManage, canAdmin, activeWorkflowRecord]
  );

	  const loadDefinitions = useCallback(async () => {
	    setIsLoading(true);
	    try {
	      const data = await listWorkflowDefinitionsAction();
	      const nextDefinitions = (data ?? []) as unknown as WorkflowDefinitionRecord[];
	      setDefinitions(nextDefinitions);
	    } catch (error) {
	      toast.error(error instanceof Error ? error.message : 'Failed to load workflows');
	    } finally {
      setIsLoading(false);
    }
  }, [newWorkflowFromQuery, workflowIdFromQuery]);

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
      const msg = err instanceof Error ? err.message : 'Failed to load event catalog';
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
        setNodeRegistry((overrides.registryNodes ?? []) as NodeRegistryItem[]);
        setActionRegistry((overrides.registryActions ?? []) as ActionRegistryItem[]);
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
      const [nodes, actions] = await Promise.all([
        listWorkflowRegistryNodesAction(),
        listWorkflowRegistryActionsAction()
      ]);
      setNodeRegistry((nodes ?? []) as unknown as NodeRegistryItem[]);
      setActionRegistry((actions ?? []) as unknown as ActionRegistryItem[]);
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
      setSchemaRefs([]);
      setSchemaMeta(new Map());
      setRegistryError(true);
      setRegistryStatus('error');
      toast.error('Failed to load workflow registries');
    }
  }, []);

  const loadPayloadSchema = useCallback(async (schemaRef: string | undefined) => {
    if (!schemaRef) {
      setPayloadSchema(null);
      setPayloadSchemaStatus('idle');
      setPayloadSchemaLoadedRef(null);
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
  }, [payloadSchemaLoadedRef, payloadSchemaStatus]);

  const ensurePayloadSchemaLoaded = useCallback(async () => {
    const schemaRef = effectivePayloadSchemaRef ?? '';
    if (!schemaRef) return;
    if (payloadSchemaStatus === 'loading') return;
    if (payloadSchemaLoadedRef === schemaRef && payloadSchemaStatus === 'loaded' && payloadSchema) return;
    await loadPayloadSchema(schemaRef);
  }, [effectivePayloadSchemaRef, loadPayloadSchema, payloadSchema, payloadSchemaLoadedRef, payloadSchemaStatus]);

  const triggerSourceSchemaRef = useMemo(() => {
    const trigger = activeDefinition?.trigger;
    if (trigger?.type !== 'event') return null;
    const override = (trigger as any)?.sourcePayloadSchemaRef;
    if (typeof override === 'string' && override.trim()) return override.trim();
    return inferredSchemaRef;
  }, [activeDefinition?.trigger, inferredSchemaRef]);

  const triggerSourceSchemaOrigin = useMemo<'override' | 'catalog' | 'unknown'>(() => {
    const trigger = activeDefinition?.trigger;
    if (trigger?.type !== 'event') return 'unknown';
    const override = (trigger as any)?.sourcePayloadSchemaRef;
    if (typeof override === 'string' && override.trim()) return 'override';
    if (typeof inferredSchemaRef === 'string' && inferredSchemaRef.trim()) return 'catalog';
    return 'unknown';
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
  }, [triggerSourceSchemaLoadedRef, triggerSourceSchemaStatus]);

  const ensureTriggerSourceSchemaLoaded = useCallback(async () => {
    if (!triggerSourceSchemaRef) return;
    if (triggerSourceSchemaStatus === 'loading') return;
    if (triggerSourceSchemaLoadedRef === triggerSourceSchemaRef && triggerSourceSchemaStatus === 'loaded' && triggerSourceSchema) return;
    await loadTriggerSourceSchema(triggerSourceSchemaRef);
  }, [loadTriggerSourceSchema, triggerSourceSchema, triggerSourceSchemaLoadedRef, triggerSourceSchemaRef, triggerSourceSchemaStatus]);

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
      toast.error('Failed to load permissions');
      return;
    }
    getCurrentUserPermissions()
      .then((perms) => setUserPermissions(perms ?? []))
      .catch(() => {
        setUserPermissions([]);
        toast.error('Failed to load permissions');
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
        const entry = await getEventCatalogEntryByEventType({ eventType: eventName, tenant: user.tenant });
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
    setActiveDefinition(record.draft_definition);
    setActiveWorkflowId(record.workflow_id);
    
    // Always reset these when selecting a workflow
    setPublishErrors([]);
    setPublishWarnings([]);
    setSelectedStepId(null);
    setSelectedPipePath('root');
  };

  useEffect(() => {
    if (!workflowIdFromQuery) {
      // Reset ref when workflowId is cleared
      didApplyWorkflowIdFromQuery.current = null;
      // Clear active definition if workflowId is cleared
      if (activeWorkflowId) {
        setActiveDefinition(null);
        setActiveWorkflowId(null);
      }
      return;
    }
    if (didApplyWorkflowIdFromQuery.current === workflowIdFromQuery) return;
    
    // Clear previous workflow immediately when a new one is selected
    if (activeWorkflowId !== workflowIdFromQuery) {
      setActiveDefinition(null);
      setActiveWorkflowId(null);
      setSelectedStepId(null);
      setSelectedPipePath('root');
    }
    
    const match = definitions.find((d) => d.workflow_id === workflowIdFromQuery);
    if (!match) return;
    didApplyWorkflowIdFromQuery.current = workflowIdFromQuery;
    handleSelectDefinition(match);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowIdFromQuery, definitions]);

  const handleCreateDefinition = () => {
    const draft = createDefaultDefinition();
    setActiveDefinition(draft);
    setActiveWorkflowId(null);
    setPayloadSchemaModeDraft('inferred');
    setSchemaInferenceEnabled(true);
    setPinnedPayloadSchemaRefDraft(draft.payloadSchemaRef ?? '');
    setSelectedStepId(null);
    setSelectedPipePath('root');
    setPublishErrors([]);
    setPublishWarnings([]);
  };

  useEffect(() => {
    if (!newWorkflowFromQuery) {
      didApplyNewWorkflowFromQuery.current = false;
      return;
    }
    if (didApplyNewWorkflowFromQuery.current) return;
    didApplyNewWorkflowFromQuery.current = true;
    handleCreateDefinition();

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete('new');
    router.replace(`?${nextParams.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newWorkflowFromQuery]);

  const handleDefinitionChange = (changes: Partial<WorkflowDefinition>) => {
    if (!activeDefinition) return;
    setActiveDefinition({ ...activeDefinition, ...changes });
  };

  const handleSaveDefinition = async () => {
    if (!activeDefinition) return;
    setIsSaving(true);
    try {
      const overrides = getWorkflowPlaywrightOverrides();
      await delayIfNeeded(overrides?.saveDraftDelayMs);
      if (overrides?.failSaveDraft) {
        throw new Error('Failed to save workflow');
      }
      if (!activeWorkflowId) {
        const data = await createWorkflowDefinitionAction({
          definition: activeDefinition,
          payloadSchemaMode: payloadSchemaModeDraft,
          pinnedPayloadSchemaRef: pinnedPayloadSchemaRefDraft ? pinnedPayloadSchemaRefDraft : undefined
        });
        setActiveWorkflowId(data.workflowId);
        setActiveDefinition({ ...activeDefinition, id: data.workflowId });

        // Keep the URL in sync with the newly created workflow so downstream effects (and tab navigation)
        // don't immediately clear the active workflow when `workflowId` is missing from the query string.
        const nextParams = new URLSearchParams(searchParams.toString());
        nextParams.set('workflowId', data.workflowId);
        nextParams.delete('new');
        router.replace(`?${nextParams.toString()}`, { scroll: false });
        toast.success('Workflow created');
      } else {
        await updateWorkflowDefinitionDraftAction({
          workflowId: activeWorkflowId,
          definition: activeDefinition,
          payloadSchemaMode: payloadSchemaModeDraft,
          pinnedPayloadSchemaRef: pinnedPayloadSchemaRefDraft ? pinnedPayloadSchemaRefDraft : undefined
        });
        toast.success('Workflow saved');
      }
      // Refresh list in the background; do not block the UI on it (it can be slow during dev + Playwright).
      void loadDefinitions();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save workflow');
    } finally {
      setIsSaving(false);
    }
  };

  const openRunDialog = () => {
    setShowRunDialog(true);
  };

  const handleSaveMetadata = async () => {
    if (!activeWorkflowId || !metadataDraft) return;
    setIsSavingMetadata(true);
    try {
      const overrides = getWorkflowPlaywrightOverrides();
      await delayIfNeeded(overrides?.saveSettingsDelayMs);
      if (overrides?.failSaveSettings) {
        throw new Error('Failed to update workflow settings');
      }
      await updateWorkflowDefinitionMetadataAction({
        workflowId: activeWorkflowId,
        isVisible: metadataDraft.isVisible,
        isPaused: metadataDraft.isPaused,
        concurrencyLimit: metadataDraft.concurrencyLimit ? Number(metadataDraft.concurrencyLimit) : null,
        autoPauseOnFailure: metadataDraft.autoPauseOnFailure,
        failureRateThreshold: metadataDraft.failureRateThreshold ? Number(metadataDraft.failureRateThreshold) : null,
        failureRateMinRuns: metadataDraft.failureRateMinRuns ? Number(metadataDraft.failureRateMinRuns) : null
      });
      toast.success('Workflow settings updated');
      void loadDefinitions();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update workflow settings');
    } finally {
      setIsSavingMetadata(false);
    }
  };

  const handlePublish = async () => {
    if (!activeDefinition || !activeWorkflowId) {
      toast.error('Save the workflow before publishing');
      return;
    }
    setIsPublishing(true);
    try {
      const overrides = getWorkflowPlaywrightOverrides();
      await delayIfNeeded(overrides?.publishDelayMs);
      if (overrides?.failPublish) {
        throw new Error('Failed to publish workflow');
      }
      const data = await publishWorkflowDefinitionAction({
        workflowId: activeWorkflowId,
        version: activeDefinition.version,
        definition: activeDefinition
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
            triggerEvent: activeDefinition?.trigger?.type === 'event' ? activeDefinition.trigger.eventName : null,
            errorCodes: codes
          });
        } catch {}
        toast.error('Publish failed - fix validation errors');
        return;
      }
      try {
        analytics.capture('workflow.publish.succeeded', {
          workflowId: activeWorkflowId,
          payloadSchemaMode: payloadSchemaModeDraft,
          effectivePayloadSchemaRef,
          triggerEvent: activeDefinition?.trigger?.type === 'event' ? activeDefinition.trigger.eventName : null,
          publishedVersion: (data as any)?.publishedVersion ?? activeDefinition.version
        });
      } catch {}
      toast.success('Workflow published');
      void loadDefinitions();
    } catch (error) {
      toast.error('Failed to publish workflow');
    } finally {
      setIsPublishing(false);
    }
  };

  // §16.6 - Enhanced handleAddStep to accept initial config (for pre-configured action items)
  // §19.4 - Auto-generate saveAs name for action.call steps
  // IBF - Supports insert-between via pendingInsertPosition
  const handleAddStep = (type: Step['type'], initialConfig?: Record<string, unknown>) => {
    if (!activeDefinition) return;
    let newStep = createStepFromPalette(type, nodeRegistryMap);
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
  } | null>(null);

  const handleDragStart = (start: { draggableId: string; source: { droppableId: string } }) => {
    isDraggingRef.current = true;
    hoveredPipePathRef.current = null;

    // PPD - Detect if dragging from palette
    if (start.source.droppableId === 'palette') {
      // Parse the palette item info from draggableId
      // Format: "palette:type" or "palette:action.call:actionId:version"
      const parts = start.draggableId.replace('palette:', '').split(':');
      if (parts[0] === 'action.call' && parts.length >= 3) {
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
      if (draggingFromPalette.type === 'action.call' && draggingFromPalette.actionId) {
        const existingConfig = (newStep as NodeStep).config as Record<string, unknown> | undefined;
        const autoSaveAs = generateSaveAsName(draggingFromPalette.actionId);
        newStep = {
          ...newStep,
          config: {
            ...existingConfig,
            actionId: draggingFromPalette.actionId,
            version: draggingFromPalette.actionVersion ?? 1,
            saveAs: autoSaveAs
          }
        };
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
    const registryItems = nodeRegistry.map((node) => {
      // For action.call nodes, find the corresponding action in actionRegistry
      const action = node.id === 'action.call'
        ? actionRegistry[0] // Just show a placeholder for action.call
        : actionRegistry.find(a => a.id === node.id);
      const outputFields = action?.outputSchema
        ? extractSchemaFields(action.outputSchema, action.outputSchema).map(f => f.name)
        : [];

      return {
        id: node.id,
        label: node.ui?.label || node.id,
        description: node.ui?.description || node.id,
        category: node.ui?.category || 'Nodes',
        type: node.id,
        outputSummary: outputFields.length > 0
          ? `Returns: ${outputFields.slice(0, 3).join(', ')}${outputFields.length > 3 ? '...' : ''}`
          : undefined,
        searchableFields: outputFields.join(' ').toLowerCase()
      };
    });

    // Also add action registry actions directly for better discoverability
    const actionItems = actionRegistry.map((action) => {
      const outputFields = action.outputSchema
        ? extractSchemaFields(action.outputSchema, action.outputSchema).map(f => f.name)
        : [];
      const inputFields = action.inputSchema
        ? extractSchemaFields(action.inputSchema, action.inputSchema).map(f => f.name)
        : [];

      return {
        id: `action:${action.id}`,
        label: action.ui?.label || action.id,
        description: action.ui?.description || `Action: ${action.id}`,
        category: action.ui?.category || 'Actions',
        type: 'action.call' as Step['type'],
        actionId: action.id,
        actionVersion: action.version,
        outputSummary: outputFields.length > 0
          ? `Returns: ${outputFields.slice(0, 3).join(', ')}${outputFields.length > 3 ? '...' : ''}`
          : undefined,
        searchableFields: [...outputFields, ...inputFields].join(' ').toLowerCase()
      };
    });

    const controlItems = CONTROL_BLOCKS.map((block) => ({
      id: block.id,
      label: block.label,
      description: block.description,
      category: block.category,
      type: block.id,
      outputSummary: undefined as string | undefined,
      searchableFields: ''
    }));

    // Remove the generic 'action.call' node, use action items directly
    const filteredRegistryItems = registryItems.filter(item => item.id !== 'action.call');
    const items = [...controlItems, ...filteredRegistryItems, ...actionItems];

    if (!searchTerm) return items;
    // §16.6 - Search also matches field names
    return items.filter((item) =>
      item.label.toLowerCase().includes(searchTerm) ||
      item.id.toLowerCase().includes(searchTerm) ||
      item.searchableFields.includes(searchTerm)
    );
  }, [nodeRegistry, actionRegistry, search]);

  const groupedPaletteItems = useMemo(() => {
    // First pass: collect all categories to detect conflicts
    const allCategories = new Set<string>();
    paletteItems.forEach(item => {
      if (item.category !== 'Business Operations') {
        allCategories.add(item.category);
      }
    });

    const grouped = paletteItems.reduce<Record<string, typeof paletteItems>>((acc, item) => {
      let category = item.category;
      
      // Split Business Operations into module-based subcategories
      if (category === 'Business Operations') {
        const itemWithAction = item as typeof item & { actionId?: string };
        if (itemWithAction.actionId) {
          // Extract module name from actionId (e.g., "tickets.create" -> "Tickets")
          const moduleName = itemWithAction.actionId.split('.')[0];
          // Capitalize first letter
          category = moduleName.charAt(0).toUpperCase() + moduleName.slice(1);
          // Handle special case for CRM
          if (category === 'Crm') category = 'CRM';
          
          // Check if this category already exists (e.g., "Email" conflicts with email workflow actions)
          // If it does, prefix with "Business Operations: " to keep them separate
          if (allCategories.has(category)) {
            category = `Business Operations: ${category}`;
          }
        }
      }
      
      acc[category] = acc[category] || [];
      acc[category].push(item);
      return acc;
    }, {});

    // Define category order: Control, Core, Transform, Email, then Business Operations subcategories
    const categoryOrder = [
      'Control',
      'Core',
      'Transform',
      'Email',
      // Business Operations subcategories in logical order
      'Tickets',
      'Clients',
      'Contacts',
      'Business Operations: Email',
      'Notifications',
      'Scheduling',
      'Projects',
      'Time',
      'CRM'
    ];

    // Sort categories: known categories first in order, then others alphabetically
    const sortedEntries = Object.entries(grouped).sort(([a], [b]) => {
      const aIndex = categoryOrder.indexOf(a);
      const bIndex = categoryOrder.indexOf(b);
      
      // If both are in the order list, sort by their position
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      // If only a is in the order list, it comes first
      if (aIndex !== -1) return -1;
      // If only b is in the order list, it comes first
      if (bIndex !== -1) return 1;
      // For Business Operations subcategories, sort them together
      const aIsBO = a.startsWith('Business Operations:');
      const bIsBO = b.startsWith('Business Operations:');
      if (aIsBO && !bIsBO) return 1; // Business Operations after main categories
      if (!aIsBO && bIsBO) return -1;
      if (aIsBO && bIsBO) return a.localeCompare(b); // Sort BO subcategories alphabetically
      // Otherwise, sort alphabetically
      return a.localeCompare(b);
    });

    return Object.fromEntries(sortedEntries);
  }, [paletteItems]);

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
    if (itemWithAction.actionId) {
      return `palette:action.call:${itemWithAction.actionId}:${itemWithAction.actionVersion ?? 1}`;
    }
    return `palette:${item.type}`;
  };

  // Dense palette icon mapping
  const getPaletteIcon = (item: typeof paletteItems[0]): React.ReactNode => {
    const iconClass = "h-5 w-5";
    const itemWithAction = item as typeof item & { actionId?: string };

    // If it's an action with a specific actionId, try to match by actionId
    if (itemWithAction.actionId) {
      const actionId = itemWithAction.actionId.toLowerCase();
      
      // Business Operations - Tickets
      if (actionId === 'tickets.create') return <ClipboardList className={iconClass} />;
      if (actionId === 'tickets.add_comment') return <MessageSquare className={iconClass} />;
      if (actionId === 'tickets.update_fields') return <Edit className={iconClass} />;
      if (actionId === 'tickets.assign') return <UserPlus className={iconClass} />;
      if (actionId === 'tickets.close') return <CheckCircle className={iconClass} />;
      if (actionId === 'tickets.link_entities') return <Link className={iconClass} />;
      if (actionId === 'tickets.add_attachment') return <Paperclip className={iconClass} />;
      if (actionId === 'tickets.find') return <Search className={iconClass} />;
      
      // Business Operations - Clients
      if (actionId === 'clients.find' || actionId === 'clients.search') return <Building className={iconClass} />;
      
      // Business Operations - Contacts
      if (actionId === 'contacts.find' || actionId === 'contacts.search') return <User className={iconClass} />;
      
      // Business Operations - Email
      if (actionId === 'email.send') return <Send className={iconClass} />;
      
      // Business Operations - Notifications
      if (actionId === 'notifications.send_in_app') return <Bell className={iconClass} />;
      
      // Business Operations - Scheduling
      if (actionId === 'scheduling.assign_user') return <Calendar className={iconClass} />;
      
      // Business Operations - Projects
      if (actionId === 'projects.create_task') return <SquareCheck className={iconClass} />;
      
      // Business Operations - Time
      if (actionId === 'time.create_entry') return <Clock className={iconClass} />;
      
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
      case 'control.tryCatch': return <Shield className={iconClass} />;
      case 'control.return': return <CornerDownRight className={iconClass} />;
      case 'control.callWorkflow': return <Workflow className={iconClass} />;
      case 'state.set': return <Database className={iconClass} />;
      case 'transform.assign': return <Settings className={iconClass} />;
      case 'event.wait': return <Clock className={iconClass} />;
      case 'human.task': return <User className={iconClass} />;
      case 'action.call': return <Zap className={iconClass} />;
      default: return <Box className={iconClass} />;
    }
  };

  const showInitialDesignerSkeleton = isLoading && !activeDefinition;

  const designerContent = (
    <DragDropContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
    <div className="flex flex-col h-full min-h-0">
	      <div ref={designerFloatAnchorRef} className="relative flex flex-col flex-1 min-h-0 overflow-hidden bg-gray-50">
        <div className="sticky top-4 z-20 h-0 pointer-events-none">
          {/* Floating Icon-Grid Palette (left) */}
          <aside
            className={`pointer-events-auto w-56 max-h-[calc(100vh-220px)] bg-white/95 backdrop-blur border border-gray-200 rounded-lg shadow-lg overflow-hidden flex flex-col min-h-0 z-40 ${designerFloatAnchorRect ? '' : 'hidden'}`}
            style={designerFloatAnchorRect ? {
              position: 'fixed',
              top: Math.min(Math.max(8, designerFloatAnchorRect.top + 16), window.innerHeight - 160),
              left: Math.min(Math.max(8, designerFloatAnchorRect.left + 16), window.innerWidth - 8 - 224),
              maxHeight: Math.max(160, designerFloatAnchorRect.bottom - (designerFloatAnchorRect.top + 16) - 16)
            } : undefined}
          >
            <div className="p-3 border-b">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  id="workflow-designer-search"
                  type="text"
                  placeholder="Search"
                  value={search}
                  disabled={registryError}
                  onChange={(event) => setSearch(event.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
            </div>
            {draggingFromPalette && (
              <div className="px-3 py-1.5 bg-primary-50 border-b text-xs text-primary-700">
                Drop on pipeline to add
              </div>
            )}
            <Droppable droppableId="palette" isDropDisabled={true}>
              {(provided) => (
                <div
                  id="workflow-designer-palette-scroll"
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className="flex-1 min-h-0 overflow-y-auto p-3 space-y-4"
                >
                  {Object.entries(groupedPaletteItems).map(([category, items]) => (
                    <div key={category}>
                      <div className="text-[10px] font-semibold uppercase text-gray-400 tracking-wider mb-2">{category}</div>
                      <div className="grid grid-cols-4 gap-1">
                        {items.map((item, itemIndex) => (
                          <Draggable
                            key={item.id}
                            draggableId={getPaletteDraggableId(item)}
                            index={itemIndex}
                          >
                            {(dragProvided, snapshot) => {
                              const itemWithAction = item as typeof item & { actionId?: string; actionVersion?: number };
                              return (
                                <PaletteItemWithTooltip
                                  item={itemWithAction}
                                  icon={getPaletteIcon(item)}
                                  isDragging={snapshot.isDragging}
                                  provided={dragProvided}
                                  onClick={() => {
                                    if (itemWithAction.actionId) {
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
                            }}
                          </Draggable>
                        ))}
                      </div>
                    </div>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </aside>

          {/* Floating Properties (right) */}
          <aside
            id="workflow-designer-sidebar-scroll"
            className={`pointer-events-auto w-[420px] max-h-[calc(100vh-220px)] bg-white/95 backdrop-blur border border-gray-200 rounded-lg shadow-lg overflow-y-auto p-4 space-y-4 z-40 ${designerFloatAnchorRect ? '' : 'hidden'}`}
            style={designerFloatAnchorRect ? {
              position: 'fixed',
              top: Math.min(Math.max(8, designerFloatAnchorRect.top + 16), window.innerHeight - 160),
              left: Math.min(Math.max(8, designerFloatAnchorRect.right - 16 - 420), window.innerWidth - 8 - 420),
              maxHeight: Math.max(160, designerFloatAnchorRect.bottom - (designerFloatAnchorRect.top + 16) - 16)
            } : undefined}
          >
            {activeWorkflowRecord && metadataDraft && canEditMetadata && (
              <Card className="p-3 space-y-3">
                <div>
                  <div className="text-sm font-semibold text-gray-800">Workflow Settings</div>
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
              canManage ? (
                <StepConfigPanel
                  step={selectedStep}
                  stepPath={stepPathMap[selectedStep.id]}
                  errors={errorsByStepId.get(selectedStep.id) ?? []}
                  nodeRegistry={nodeRegistryMap}
                  actionRegistry={actionRegistry}
                  fieldOptions={fieldOptions}
                  payloadSchema={payloadSchema}
                  definition={activeDefinition}
                  onChange={(updatedStep) => handleStepUpdate(selectedStep.id, () => updatedStep)}
                />
              ) : (
                <div className="text-sm text-gray-500">Read-only access: step editing is disabled.</div>
              )
            ) : (
              <div className="text-sm text-gray-500">Select a step to edit its configuration.</div>
            )}

            {currentValidationErrors.length > 0 && activeDefinition && (
              <div className="mt-6">
                <h3 className="text-sm font-semibold text-red-700 flex items-center gap-2 mb-2">
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
                    <Card key={`${error.stepPath}-${index}`} className="p-3 border border-red-200">
                      <div className="text-xs font-semibold text-red-700">{error.code}</div>
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
                    <Card key={`${warning.stepPath}-${index}`} className="p-3 border border-yellow-200">
                      <div className="text-xs font-semibold text-yellow-700">{warning.code}</div>
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

	        <div id="workflow-designer-center-scroll" className="flex-1 min-h-0 overflow-y-auto p-6 pl-72 pr-[460px]">
          <div className="max-w-4xl mx-auto space-y-6">
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
                      <Skeleton className="h-[650px] w-full rounded border border-gray-200 bg-white" />
                    </div>
                  </>
                ) : (
                  <>
                    <Card className="p-4 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Input
                      id="workflow-designer-name"
                      label="Workflow name"
                      value={activeDefinition?.name ?? ''}
                      onChange={(event) => handleDefinitionChange({ name: event.target.value })}
                    />
                    <Input
                      id="workflow-designer-version"
                      label="Version"
                      type="number"
                      value={activeDefinition?.version ?? 1}
                      onChange={(event) => handleDefinitionChange({ version: Number(event.target.value) })}
                    />
                    <div
                      id="workflow-designer-published-version"
                      className="col-span-2 text-xs text-gray-500"
                    >
                      Latest published version: {activeWorkflowRecord?.published_version ?? '—'}
                    </div>
                  </div>
                  <TextArea
                    id="workflow-designer-description"
                    label="Description"
                    value={activeDefinition?.description ?? ''}
                    onChange={(event) => handleDefinitionChange({ description: event.target.value })}
                    rows={2}
                  />
                  {(() => {
                    const selectedEventName = activeDefinition?.trigger?.type === 'event' ? activeDefinition.trigger.eventName : '';
                    const selectedOption = selectedEventName
                      ? eventCatalogOptions.find((e) => e.event_type === selectedEventName) ?? null
                      : null;
                    const schemaBadgeClass = (status: WorkflowEventCatalogOptionV2['payload_schema_ref_status']) => {
                      if (status === 'missing') return 'bg-gray-100 text-gray-600 border-gray-200';
                      if (status === 'unknown') return 'bg-red-50 text-red-700 border-red-200';
                      return 'bg-sky-50 text-sky-700 border-sky-200';
                    };
                    const schemaBadgeLabel = (status: WorkflowEventCatalogOptionV2['payload_schema_ref_status']) => {
                      if (status === 'missing') return 'No schema';
                      if (status === 'unknown') return 'Unknown schema';
                      return 'Schema';
                    };

                    const options: Array<{ value: string; label: string }> = [
                      { value: '', label: 'Manual (no trigger)' },
                      ...eventCatalogOptions.map((e) => ({
                        value: e.event_type,
                        label: e.category ? `${e.name} · ${e.category} (${e.event_type})` : `${e.name} (${e.event_type})`
                      }))
                    ];

                    if (selectedEventName && !selectedOption) {
                      options.unshift({ value: selectedEventName, label: `Unknown event (${selectedEventName})` });
                    }

	                    return (
	                      <div className="space-y-2">
	                        <label htmlFor="workflow-designer-trigger-event" className="block text-sm font-medium text-gray-700 mb-1">Event Trigger</label>
	                        {eventCatalogStatus === 'loading' ? (
	                          <Skeleton className="h-10 w-full" />
	                        ) : (
	                          <SearchableSelect
	                            id="workflow-designer-trigger-event"
	                            value={selectedEventName}
	                            onChange={(value) => {
	                              const next = value.trim();
	                              if (!next) {
	                                handleDefinitionChange({ trigger: undefined });
	                                return;
	                              }
	                              const chosen = eventCatalogOptions.find((e) => e.event_type === next) ?? null;
	                              if (chosen?.source === 'system' && (chosen.payload_schema_ref_status !== 'known' || !chosen.payload_schema_ref)) {
	                                toast.error('This system event is missing a valid schema and cannot be selected until fixed.');
	                                return;
	                              }
	                              const existing = activeDefinition?.trigger?.type === 'event' ? activeDefinition.trigger : undefined;
	                              handleDefinitionChange({ trigger: { ...(existing as any), type: 'event', eventName: next } });
	                            }}
	                            placeholder="Select trigger event"
	                            dropdownMode="overlay"
	                            options={options}
	                            disabled={!canManage}
	                          />
	                        )}
	                        {eventCatalogStatus === 'loading' && (
	                          <div className="rounded border border-gray-200 bg-white px-3 py-2 space-y-2">
	                            <div className="flex flex-wrap items-center gap-2">
	                              <Skeleton className="h-5 w-16 rounded-full" />
	                              <Skeleton className="h-5 w-16 rounded-full" />
	                              <Skeleton className="h-5 w-20 rounded-full" />
	                            </div>
	                            <Skeleton className="h-3 w-2/3" />
	                          </div>
	                        )}
	                        {selectedOption && (
	                          <div className="rounded border border-gray-200 bg-white px-3 py-2 space-y-1">
	                            <div className="flex flex-wrap items-center gap-2">
	                              <Badge className={selectedOption.source === 'system' ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}>
                                {selectedOption.source === 'system' ? 'System' : 'Tenant'}
                              </Badge>
                              <Badge className={
                                selectedOption.status === 'active' ? 'bg-green-50 text-green-700 border-green-200'
                                  : selectedOption.status === 'beta' ? 'bg-yellow-50 text-yellow-800 border-yellow-200'
                                    : selectedOption.status === 'draft' ? 'bg-gray-100 text-gray-700 border-gray-200'
                                      : 'bg-red-50 text-red-700 border-red-200'
                              }>
                                {selectedOption.status.charAt(0).toUpperCase() + selectedOption.status.slice(1)}
                              </Badge>
                              <Badge className={schemaBadgeClass(selectedOption.payload_schema_ref_status)}>
                                {schemaBadgeLabel(selectedOption.payload_schema_ref_status)}
                              </Badge>
                              {selectedOption.category && (
                                <Badge className="bg-white text-gray-700 border-gray-200">{selectedOption.category}</Badge>
                              )}
                            </div>
                            {selectedOption.description && (
                              <div className="text-xs text-gray-600">{selectedOption.description}</div>
                            )}
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
                            {eventCatalogStatus === 'loaded' && selectedOption.payload_schema_ref_status !== 'known' && (
                              <div className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                                This event is missing a valid schema reference. Publishing and running are disabled until it is fixed.
                              </div>
                            )}
                          </div>
                        )}
                        {eventCatalogStatus === 'loaded' && !selectedOption && selectedEventName && (
                          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                            Trigger event <span className="font-mono">{selectedEventName}</span> is not present in the event catalog. Publishing and running are disabled until it is fixed.
                          </div>
                        )}
                        {eventCatalogStatus === 'error' && (
                          <div className="text-xs text-red-700">
                            Failed to load the event catalog. Publishing and running are disabled for event-triggered workflows until this loads.
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {activeDefinition?.trigger?.type === 'event' && activeDefinition.trigger.eventName && (
                    <div className="mt-3 space-y-2">
                      <div className="rounded border border-gray-200 bg-white px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-xs font-semibold text-gray-800">Trigger source payload schema</div>
                          <Button
                            id="workflow-designer-trigger-schema-advanced"
                            variant="ghost"
                            size="sm"
                            type="button"
                            className="h-auto px-2 py-1 text-xs text-gray-500 hover:text-gray-700"
                            onClick={() => setTriggerSourceSchemaAdvanced((prev) => !prev)}
                            disabled={!canManage}
                          >
                            {triggerSourceSchemaAdvanced ? 'Hide override' : 'Override'}
                          </Button>
                        </div>
                        <div className="mt-1 text-[11px] text-gray-600">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-gray-500">Event:</span>
                            <span className="font-mono break-all">{activeDefinition.trigger.eventName}</span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <span className="text-gray-500">Source schema:</span>
                            <span className="font-mono break-all">{triggerSourceSchemaRef ?? '—'}</span>
                            {triggerSourceSchemaRef && (
                              <Badge className={
                                triggerSourceSchemaOrigin === 'override'
                                  ? 'bg-purple-50 text-purple-700 border-purple-200'
                                  : triggerSourceSchemaOrigin === 'catalog'
                                    ? 'bg-blue-50 text-blue-700 border-blue-200'
                                    : 'bg-gray-100 text-gray-600 border-gray-200'
                              }>
                                {triggerSourceSchemaOrigin === 'override' ? 'Override' : triggerSourceSchemaOrigin === 'catalog' ? 'Catalog' : 'Unknown'}
                              </Badge>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <span className="text-gray-500">Workflow payload schema:</span>
                            <span className="font-mono break-all">{activeDefinition.payloadSchemaRef ?? '—'}</span>
                            {triggerPayloadMappingInfo.schemaRefsMatch && (
                              <Badge className="bg-green-50 text-green-700 border-green-200">Match</Badge>
                            )}
                            {!triggerPayloadMappingInfo.schemaRefsMatch && triggerSourceSchemaRef && activeDefinition.payloadSchemaRef && (
                              <Badge className="bg-amber-50 text-amber-700 border-amber-200">Mismatch</Badge>
                            )}
                          </div>
                          {inferredSchemaRef && (
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <span className="text-gray-500">From catalog:</span>
                              <span className="font-mono break-all">{inferredSchemaRef}</span>
                            </div>
                          )}
                          {typeof (activeDefinition.trigger as any).sourcePayloadSchemaRef === 'string' && (
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <span className="text-gray-500">Override:</span>
                              <span className="font-mono break-all">{String((activeDefinition.trigger as any).sourcePayloadSchemaRef)}</span>
                            </div>
                          )}
                        </div>

                        {(triggerValidationErrors.length > 0 || triggerValidationWarnings.length > 0) && (
                          <div className="mt-3 space-y-2">
                            {triggerValidationErrors.length > 0 && (
                              <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                                <div className="font-semibold mb-1">Trigger validation errors</div>
                                <ul className="list-disc pl-4 space-y-1">
                                  {triggerValidationErrors.slice(0, 5).map((err, idx) => (
                                    <li key={`${err.code}-${idx}`}>{err.message}</li>
                                  ))}
                                </ul>
                                {triggerValidationErrors.length > 5 && (
                                  <div className="mt-1 text-[11px] text-red-700">+{triggerValidationErrors.length - 5} more</div>
                                )}
                              </div>
                            )}
                            {triggerValidationWarnings.length > 0 && (
                              <div className="rounded border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
                                <div className="font-semibold mb-1">Trigger warnings</div>
                                <ul className="list-disc pl-4 space-y-1">
                                  {triggerValidationWarnings.slice(0, 5).map((warn, idx) => (
                                    <li key={`${warn.code}-${idx}`}>{warn.message}</li>
                                  ))}
                                </ul>
                                {triggerValidationWarnings.length > 5 && (
                                  <div className="mt-1 text-[11px] text-yellow-700">+{triggerValidationWarnings.length - 5} more</div>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {triggerSourceSchemaAdvanced && (
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
                                handleDefinitionChange({ trigger: nextTrigger });
                              }}
                              placeholder="Use catalog schema…"
                              emptyMessage="No schemas found"
                              disabled={registryError || !canManage}
                              dropdownMode="overlay"
                            />
                          </div>
                        )}
                      </div>

                      {(() => {
                        const mapping = (activeDefinition.trigger as any).payloadMapping ?? {};
                        const mappingProvided = mapping && typeof mapping === 'object' && Object.keys(mapping).length > 0;
                        const payloadRef = activeDefinition.payloadSchemaRef ?? '';
                        const refsMatch = !!triggerSourceSchemaRef && !!payloadRef && triggerSourceSchemaRef === payloadRef;
                        const mappingRequired = !!triggerSourceSchemaRef && !!payloadRef && !refsMatch;
                        const showEditor = mappingRequired || showTriggerMapping || mappingProvided;
                        const mappingErrors = triggerValidationErrors.filter((err) => err.stepPath.startsWith('root.trigger.payloadMapping'));
                        const mappingWarnings = triggerValidationWarnings.filter((warn) => warn.stepPath.startsWith('root.trigger.payloadMapping'));

                        return (
                          <div className="rounded border border-gray-200 bg-white px-3 py-2">
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2">
                                <div className="text-xs font-semibold text-gray-800">Trigger mapping</div>
                                {mappingRequired ? (
                                  <Badge className="bg-red-100 text-red-700 border-red-200">Required</Badge>
                                ) : (
                                  <Badge className="bg-green-100 text-green-700 border-green-200">Optional</Badge>
                                )}
                              </div>
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
                                  {showEditor ? 'Hide' : 'Show'}
                                </Button>
                              )}
                            </div>

                            {!triggerSourceSchemaRef && (
                              <div className="mt-2 text-xs text-red-600">
                                No source schema available for this event yet. Add <code className="bg-red-50 px-1 rounded">payload_schema_ref</code> to the event catalog or set an override.
                              </div>
                            )}

                            {mappingRequired && !mappingProvided && (
                              <div className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div>
                                    A trigger mapping is required because the trigger source schema does not match the workflow payload schema.
                                  </div>
                                  <Button
                                    id="workflow-designer-trigger-mapping-jump-to-contract"
                                    variant="ghost"
                                    size="sm"
                                    type="button"
                                    className="h-auto px-2 py-1 text-xs text-red-700 hover:text-red-800"
                                    onClick={() => {
                                      document.getElementById('workflow-designer-contract-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                    }}
                                  >
                                    View contract
                                  </Button>
                                </div>
                              </div>
                            )}

                            {refsMatch && !mappingProvided && !showEditor && (
                              <div className="mt-2 text-xs text-gray-600">
                                Identity mapping (no mapping required).
                              </div>
                            )}

                            {(mappingErrors.length > 0 || mappingWarnings.length > 0) && (
                              <div className="mt-3 space-y-2">
                                {mappingErrors.length > 0 && (
                                  <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                                    <div className="font-semibold mb-1">Mapping errors</div>
                                    <ul className="list-disc pl-4 space-y-1">
                                      {mappingErrors.slice(0, 5).map((err, idx) => (
                                        <li key={`${err.code}-${idx}`}>{err.message}</li>
                                      ))}
                                    </ul>
                                    {mappingErrors.length > 5 && (
                                      <div className="mt-1 text-[11px] text-red-700">+{mappingErrors.length - 5} more</div>
                                    )}
                                  </div>
                                )}
                                {mappingWarnings.length > 0 && (
                                  <div className="rounded border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
                                    <div className="font-semibold mb-1">Mapping warnings</div>
                                    <ul className="list-disc pl-4 space-y-1">
                                      {mappingWarnings.slice(0, 5).map((warn, idx) => (
                                        <li key={`${warn.code}-${idx}`}>{warn.message}</li>
                                      ))}
                                    </ul>
                                    {mappingWarnings.length > 5 && (
                                      <div className="mt-1 text-[11px] text-yellow-700">+{mappingWarnings.length - 5} more</div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}

                            {showEditor && (
                              <div className="mt-3">
                                <p className="text-xs text-gray-500 mb-3">
                                  Map data from <code className="bg-gray-100 px-1 rounded">event.payload</code> to the workflow payload.
                                </p>
                                <MappingPanel
                                  value={mapping}
                                  onChange={(next) => {
                                    const nextTrigger: any = { ...activeDefinition.trigger };
                                    nextTrigger.payloadMapping = Object.keys(next).length > 0 ? next : undefined;
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
                        );
                      })()}
                    </div>
                  )}

                  <div id="workflow-designer-contract-section" className="mt-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <Label htmlFor="workflow-designer-contract-mode">Workflow data contract</Label>
                        <div className="text-xs text-gray-500">
                          {activeDefinition?.trigger?.type === 'event' ? (
                            <>
                              The trigger event defines <span className="font-mono">event.payload</span>. The workflow contract defines the
                              <span className="font-mono"> payload</span> object that steps read (after trigger mapping, if any).
                            </>
                          ) : (
                            <>
                              No trigger is selected. The workflow contract defines the <span className="font-mono">payload</span> object that steps read.
                              Manual workflows must pin a schema before publishing or running.
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-gray-500">Pin schema (advanced)</span>
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
                            setPinnedPayloadSchemaRefDraft(activeDefinition.payloadSchemaRef ?? pinnedPayloadSchemaRefDraft ?? '');
                            lastAppliedInferredRef.current = null;
                            if (inferredSchemaRef && activeDefinition.payloadSchemaRef !== inferredSchemaRef) {
                              handleDefinitionChange({ payloadSchemaRef: inferredSchemaRef });
                            }
                          }}
                          disabled={!canManage}
                        />
                      </div>
                    </div>

                    {payloadSchemaModeDraft === 'pinned' ? (
                      <>
                        <div className="mt-2 flex items-center justify-between">
                          <div className="text-xs text-gray-600">Pinned payload schema</div>
                          <Button
                            id="workflow-designer-schema-advanced"
                            variant="ghost"
                            size="sm"
                            type="button"
                            className="h-auto px-2 py-1 text-xs text-gray-500 hover:text-gray-700"
                            onClick={() => setSchemaRefAdvanced((prev) => !prev)}
                          >
                            {schemaRefAdvanced ? 'Hide advanced' : 'Advanced'}
                          </Button>
                        </div>
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
                                setPinnedPayloadSchemaRefDraft(value);
                                analytics.capture('workflow.payload_schema_ref.selected', {
                                  schemaRef: value || null,
                                  workflowId: activeWorkflowId ?? activeDefinition?.id ?? null,
                                  inferenceEnabled: false,
                                  triggerEvent: activeDefinition?.trigger?.type === 'event' ? activeDefinition.trigger.eventName : null
                                });
                                handleDefinitionChange({ payloadSchemaRef: value });
                              }}
                              placeholder="Select schema…"
                              emptyMessage="No schemas found"
                              disabled={registryError || !canManage}
                              required
                              dropdownMode="overlay"
                            />
                          )}
                        </div>

                        {schemaRefAdvanced && (
                          <div className="mt-2">
                            <Input
                              id="workflow-designer-schema"
                              label="Payload schema ref (advanced)"
                              value={activeDefinition?.payloadSchemaRef ?? ''}
                              onChange={(event) => {
                                setPinnedPayloadSchemaRefDraft(event.target.value);
                                handleDefinitionChange({ payloadSchemaRef: event.target.value });
                              }}
                              disabled={!canManage}
                            />
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="mt-2 rounded border border-gray-200 bg-white px-3 py-2">
                        <div className="text-xs text-gray-700">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <span className="font-semibold text-gray-800">Inferred</span>{' '}
                              <span className="text-gray-600">from the selected trigger event.</span>
                            </div>
                            {effectivePayloadSchemaRef && (
                              <Badge className="bg-sky-50 text-sky-700 border-sky-200">Effective</Badge>
                            )}
                          </div>
                          <div className="mt-1 text-[11px] text-gray-500 font-mono break-all">
                            {inferredSchemaStatus === 'loading' ? (
                              <Skeleton className="h-4 w-56" />
                            ) : (
                              (effectivePayloadSchemaRef || 'Select a trigger event to infer a schema.')
                            )}
                          </div>
                          {inferredSchemaStatus === 'error' && activeDefinition?.trigger?.type === 'event' && (
                            <div className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                              No schema is available for <span className="font-mono">{activeDefinition.trigger.eventName}</span>. Fix the event catalog entry to include a valid schema.
                            </div>
                          )}
                          {activeWorkflowRecord?.published_version != null &&
                            activeWorkflowRecord?.payload_schema_ref &&
                            effectivePayloadSchemaRef &&
                            activeWorkflowRecord.payload_schema_ref !== effectivePayloadSchemaRef && (
                            <div className="mt-2 rounded border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-900">
                              <div className="font-semibold">Draft contract differs from published</div>
                              <div className="mt-1 text-yellow-800">
                                Published contract uses <span className="font-mono">{activeWorkflowRecord.payload_schema_ref}</span>. This draft is currently inferred as{' '}
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
                                      setPinnedPayloadSchemaRefDraft(activeWorkflowRecord.payload_schema_ref ?? '');
                                      if (activeDefinition?.payloadSchemaRef !== activeWorkflowRecord.payload_schema_ref) {
                                        handleDefinitionChange({ payloadSchemaRef: activeWorkflowRecord.payload_schema_ref });
                                      }
                                    }}
                                  >
                                    Pin to published contract
                                  </Button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {effectivePayloadSchemaRef &&
                      schemaRefs.length > 0 &&
                      !schemaRefs.includes(effectivePayloadSchemaRef) && (
                      <div className="mt-2 flex items-center justify-between gap-3 text-xs text-red-600">
                        <div>
                          Unknown schema ref. Select a valid schema from the dropdown (or update the ref in Advanced).
                        </div>
                        {canManage && (
                          <Button
                            id="workflow-designer-schema-clear"
                            variant="ghost"
                            size="sm"
                            type="button"
                            className="h-auto px-2 py-1 text-xs text-red-600 hover:text-red-700"
                            onClick={() => {
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

                    {effectivePayloadSchemaRef && (
                      <div className="mt-3 rounded border border-gray-200 bg-gray-50 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-xs font-semibold text-gray-700">
                            {payloadSchemaModeDraft === 'pinned' ? 'Contract schema preview' : 'Effective schema preview'}
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              id="workflow-designer-schema-preview-toggle"
                              variant="ghost"
                              size="sm"
                              type="button"
                              className="h-auto px-2 py-1 text-xs text-gray-600 hover:text-gray-800"
                              onClick={() => setSchemaPreviewExpanded((prev) => !prev)}
                            >
                              {schemaPreviewExpanded ? 'Hide preview' : 'Show preview'}
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
                              View full schema
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
                                    <span key={k} className="rounded bg-white px-2 py-0.5 border border-gray-200">
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
                    <div className="w-full max-w-3xl rounded-lg bg-white shadow-xl border border-gray-200 overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                        <div className="text-sm font-semibold text-gray-900">Workflow payload contract schema</div>
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
                      <div className="px-4 py-2 border-b border-gray-200 bg-gray-50">
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
                          <div className="text-xs text-red-600">Failed to load schema.</div>
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
                    <div className="w-full max-w-3xl rounded-lg bg-white shadow-xl border border-gray-200 overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                        <div className="text-sm font-semibold text-gray-900">{triggerSchemaModalTitle}</div>
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
                      <div className="px-4 py-2 border-b border-gray-200 bg-gray-50">
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
                          <div className="text-xs text-red-600">Failed to load schema.</div>
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
                    <div className="w-full max-w-3xl rounded-lg bg-white shadow-xl border border-gray-200 overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                        <div className="text-sm font-semibold text-gray-900">
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
                          <div className="text-xs text-red-600">
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
                      <h2 className="text-lg font-semibold text-gray-900">Workflow Steps</h2>
                      <p className="text-sm text-gray-500">
                        {stepsViewMode === 'list'
                          ? 'Drag steps to reorder or move between pipes.'
                          : 'Pan/zoom the graph. Branches render as separate lanes.'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        id="workflow-steps-view-list"
                        variant={stepsViewMode === 'list' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setStepsViewMode('list')}
                      >
                        List
                      </Button>
                      <Button
                        id="workflow-steps-view-graph"
                        variant={stepsViewMode === 'graph' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setStepsViewMode('graph')}
                      >
                        Graph
                      </Button>
                      {publishWarnings.length > 0 && (
                        <Badge className="bg-yellow-100 text-yellow-800">{publishWarnings.length} warnings</Badge>
                      )}
                    </div>
                  </div>
                  {stepsViewMode === 'graph' ? (
                    <div className="h-[650px] rounded border border-gray-200 bg-white overflow-hidden">
                      <WorkflowGraph
                        steps={(activeDefinition?.steps ?? []) as Step[]}
                        getLabel={(step) => getStepLabel(step as Step, nodeRegistryMap)}
                        getSubtitle={(step) => getGraphSubtitle(step as Step) ?? (step as Step).type}
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
                      selectedStepId={selectedStepId}
                      onSelectStep={setSelectedStepId}
                      onDeleteStep={handleDeleteStep}
                      onSelectPipe={handlePipeSelect}
                      onPipeHover={handlePipeHover}
                      onInsertStep={(index) => handleInsertStep('root', index)}
                      onInsertAtPath={handleInsertStep}
                      nodeRegistry={nodeRegistryMap}
                        errorMap={errorsByStepId}
                        isRoot={true}
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
        payload_schema_ref: definition.payload_schema_ref,
        published_version: definition.published_version ?? null,
        validation_status: definition.validation_status ?? null,
        is_paused: definition.is_paused ?? false,
        concurrency_limit: definition.concurrency_limit ?? null,
        is_system: definition.is_system ?? false
      }))}
      workflowStatusById={runStatusByWorkflow}
      workflowRunCountById={runCountByWorkflow}
      isActive={activeTab === 'Runs'}
      canAdmin={canAdmin}
      canManage={canManage}
    />
  );

  const eventListContent = (
    <WorkflowEventList
      isActive={activeTab === 'Events'}
      canAdmin={canAdmin}
    />
  );

  const deadLetterContent = (
    <WorkflowDeadLetterQueue
      isActive={activeTab === 'Dead Letter'}
      canAdmin={canAdmin}
    />
  );

  const auditContent = (
    <WorkflowDefinitionAudit
      workflowId={activeWorkflowId}
      workflowName={activeWorkflowRecord?.name}
      isActive={activeTab === 'Audit'}
    />
  );

  const workflowListContent = (
    <WorkflowListV2
      onSelectWorkflow={(workflowId) => {
        const params = new URLSearchParams(searchParamsString);
        params.delete('search');
        params.delete('status');
        params.delete('trigger');
        params.delete('new');
        params.set('workflowId', workflowId);
        params.set('tab', 'designer');
        router.push(`/msp/workflows?${params.toString()}`);
      }}
      onCreateNew={() => {
        const params = new URLSearchParams(searchParamsString);
        params.delete('search');
        params.delete('status');
        params.delete('trigger');
        params.delete('workflowId');
        params.set('new', '1');
        params.set('tab', 'designer');
        router.push(`/msp/workflows?${params.toString()}`);
      }}
    />
  );

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="border-b bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Workflows</h1>
            <p className="text-sm text-gray-500">Create, run, and audit workflow automations.</p>
          </div>
          {activeTab === 'Designer' && (
            <div className="flex items-center gap-2">
              {activeWorkflowRecord && (
                <span
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border text-xs font-medium ${workflowValidationBadge.className}`}
                  title={activeWorkflowRecord.validated_at ? `Last validated: ${activeWorkflowRecord.validated_at}` : 'Validation status unknown'}
                >
                  {workflowValidationBadge.label}
                  {currentValidationErrors.length > 0 && <span>({currentValidationErrors.length})</span>}
                </span>
              )}
              {canManage && (
                <Button id="workflow-designer-create" variant="outline" onClick={handleCreateDefinition}>
                  New Workflow
                </Button>
              )}
              {canManage && (
                <Button
                  id="workflow-designer-save"
                  onClick={handleSaveDefinition}
                  disabled={isSaving || !activeDefinition}
                >
                  {isSaving ? 'Saving...' : 'Save Draft'}
                </Button>
              )}
              {(canPublishPermission) && (
                <Button
                  id="workflow-designer-publish"
                  onClick={handlePublish}
                  disabled={isPublishing || !activeDefinition || !canPublishEnabled}
                  title={!canPublishEnabled ? publishDisabledReason || undefined : undefined}
                >
                  {isPublishing ? 'Publishing...' : 'Publish'}
                </Button>
              )}
              {(canRunPermission) && (
                <Button
                  id="workflow-designer-run"
                  onClick={openRunDialog}
                  disabled={
                    !activeDefinition
                    || !activeWorkflowId
                    || activeWorkflowRecord?.validation_status === 'error'
                    || activeWorkflowRecord?.is_paused
                    || !canRunEnabled
                  }
                  title={
                    !canRunEnabled ? runDisabledReason || undefined
                      : !activeWorkflowRecord?.published_version ? 'Preview only until a version is published.'
                        : undefined
                  }
                >
                  Run
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
        triggerLabel={activeDefinition?.trigger?.eventName ? `Event: ${activeDefinition.trigger.eventName}` : 'Manual'}
        triggerEventName={activeDefinition?.trigger?.eventName ?? null}
        triggerSourcePayloadSchemaRef={triggerSourceSchemaRef}
        triggerPayloadMappingProvided={triggerPayloadMappingInfo.mappingProvided}
        triggerPayloadMappingRequired={triggerPayloadMappingInfo.mappingRequired}
        payloadSchemaRef={activeDefinition?.payloadSchemaRef ?? activeWorkflowRecord?.payload_schema_ref ?? null}
        publishedVersion={activeWorkflowRecord?.published_version ?? null}
        draftVersion={activeDefinition?.version ?? null}
        isSystem={activeWorkflowRecord?.is_system ?? false}
        isPaused={activeWorkflowRecord?.is_paused ?? false}
        validationStatus={activeWorkflowRecord?.validation_status ?? null}
        concurrencyLimit={activeWorkflowRecord?.concurrency_limit ?? null}
        canPublish={canPublishPermission}
        onPublishDraft={handlePublish}
      />

      <div className="flex-1 min-h-0 overflow-hidden">
        <CustomTabs
          idPrefix="workflow-designer-tabs"
          value={activeTab}
          onTabChange={handleTabChange}
          tabs={[
            { label: 'Workflows', content: workflowListContent },
            { label: 'Designer', content: designerContent },
            { label: 'Runs', content: runListContent },
            { label: 'Events', content: eventListContent },
            ...(canAdmin ? [{ label: 'Dead Letter', content: deadLetterContent }] : []),
            ...(canAdmin ? [{ label: 'Audit', content: auditContent }] : [])
          ]}
          tabStyles={{
            root: 'h-full min-h-0 flex flex-col',
            content: 'flex-1 min-h-0 overflow-hidden',
            list: 'px-6 bg-white border-b border-gray-200 mb-0'
          }}
        />
      </div>
    </div>
  );
};

const Pipe: React.FC<{
  steps: Step[];
  pipePath: string;
  stepPathPrefix: string;
  selectedStepId: string | null;
  onSelectStep: (id: string) => void;
  onDeleteStep: (id: string) => void;
  onSelectPipe: (pipePath: string) => void;
  onPipeHover: (pipePath: string) => void;
  onInsertStep?: (index: number) => void;
  onInsertAtPath?: (pipePath: string, index: number) => void;
  nodeRegistry: Record<string, NodeRegistryItem>;
  errorMap: Map<string, PublishError[]>;
  isRoot?: boolean;
  disabled?: boolean;
}> = ({
  steps,
  pipePath,
  stepPathPrefix,
  selectedStepId,
  onSelectStep,
  onDeleteStep,
  onSelectPipe,
  onPipeHover,
  onInsertStep,
  onInsertAtPath,
  nodeRegistry,
  errorMap,
  isRoot = false,
  disabled = false
}) => {
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
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-green-100 border-2 border-green-500" data-testid="pipeline-start">
                <Play className="h-4 w-4 text-green-600 ml-0.5" />
              </div>
              <div className="text-xs text-gray-500 mt-1">Start</div>
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
              <Draggable draggableId={step.id} index={index}>
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
                      selected={selectedStepId === step.id}
                      selectedStepId={selectedStepId}
                      onSelectStep={onSelectStep}
                      onDeleteStep={onDeleteStep}
                      onSelectPipe={onSelectPipe}
                      onPipeHover={onPipeHover}
                      onInsertStep={onInsertStep}
                      onInsertAtPath={onInsertAtPath}
                      dragHandleProps={dragProvided.dragHandleProps ?? undefined}
                      nodeRegistry={nodeRegistry}
                      errorCount={errorMap.get(step.id)?.length ?? 0}
                      errorMap={errorMap}
                      disabled={disabled}
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
  selected: boolean;
  selectedStepId: string | null;
  onSelectStep: (id: string) => void;
  onDeleteStep: (id: string) => void;
  onSelectPipe: (pipePath: string) => void;
  onPipeHover: (pipePath: string) => void;
  onInsertStep?: (index: number) => void;
  onInsertAtPath?: (pipePath: string, index: number) => void;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  nodeRegistry: Record<string, NodeRegistryItem>;
  errorCount: number;
  errorMap: Map<string, PublishError[]>;
  disabled?: boolean;
}> = ({
  step,
  stepPath,
  selected,
  selectedStepId,
  onSelectStep,
  onDeleteStep,
  onSelectPipe,
  onPipeHover,
  onInsertStep,
  onInsertAtPath,
  dragHandleProps,
  nodeRegistry,
  errorCount,
  errorMap,
  disabled = false
}) => {
  const label = getStepLabel(step, nodeRegistry);
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
          aria-label={`Select ${label} step`}
        >
          <div className="flex items-center gap-2">
            {/* Step type icon */}
            <div className={`flex-shrink-0 ${colors.icon}`}>
              {icon}
            </div>
            {/* Step label */}
            <span className="text-sm font-medium text-gray-900 truncate">{label}</span>
            {/* Block badge */}
            {isBlock && (
              <Badge className={`text-xs ${colors.badge}`}>
                {step.type === 'control.if' ? 'If' : step.type === 'control.forEach' ? 'Loop' : step.type === 'control.tryCatch' ? 'Try' : 'Block'}
              </Badge>
            )}
            {/* Error badge */}
            {errorCount > 0 && (
              <Badge className="bg-red-100 text-red-700 text-xs">
                {errorCount} {errorCount === 1 ? 'error' : 'errors'}
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
                id={`workflow-step-delete-${step.id}`}
                variant="ghost"
                size="sm"
                onClick={() => onDeleteStep(step.id)}
                className="text-gray-400 hover:text-red-500 p-1 h-auto"
                data-testid={`step-delete-${step.id}`}
                title="Delete step"
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
            <BlockSection title="THEN" idPrefix={`${step.id}-then`}>
              <Pipe
                steps={ifStep.then}
                pipePath={thenPath}
                stepPathPrefix={thenPath}
                selectedStepId={selectedStepId}
                onSelectStep={onSelectStep}
                onDeleteStep={onDeleteStep}
                onSelectPipe={onSelectPipe}
                onPipeHover={onPipeHover}
                onInsertStep={onInsertAtPath ? (index) => onInsertAtPath(thenPath, index) : undefined}
                onInsertAtPath={onInsertAtPath}
                nodeRegistry={nodeRegistry}
                errorMap={errorMap}
                disabled={disabled}
              />
            </BlockSection>
            <BlockSection title="ELSE" idPrefix={`${step.id}-else`}>
              <Pipe
                steps={ifStep.else ?? []}
                pipePath={elsePath}
                stepPathPrefix={elsePath}
                selectedStepId={selectedStepId}
                onSelectStep={onSelectStep}
                onDeleteStep={onDeleteStep}
                onSelectPipe={onSelectPipe}
                onPipeHover={onPipeHover}
                onInsertStep={onInsertAtPath ? (index) => onInsertAtPath(elsePath, index) : undefined}
                onInsertAtPath={onInsertAtPath}
                nodeRegistry={nodeRegistry}
                errorMap={errorMap}
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
            <BlockSection title="TRY" idPrefix={`${step.id}-try`}>
              <Pipe
                steps={tcStep.try}
                pipePath={tryPath}
                stepPathPrefix={tryPath}
                selectedStepId={selectedStepId}
                onSelectStep={onSelectStep}
                onDeleteStep={onDeleteStep}
                onSelectPipe={onSelectPipe}
                onPipeHover={onPipeHover}
                onInsertStep={onInsertAtPath ? (index) => onInsertAtPath(tryPath, index) : undefined}
                onInsertAtPath={onInsertAtPath}
                nodeRegistry={nodeRegistry}
                errorMap={errorMap}
                disabled={disabled}
              />
            </BlockSection>
            <BlockSection title="CATCH" idPrefix={`${step.id}-catch`}>
              <Pipe
                steps={tcStep.catch}
                pipePath={catchPath}
                stepPathPrefix={catchPath}
                selectedStepId={selectedStepId}
                onSelectStep={onSelectStep}
                onDeleteStep={onDeleteStep}
                onSelectPipe={onSelectPipe}
                onPipeHover={onPipeHover}
                onInsertStep={onInsertAtPath ? (index) => onInsertAtPath(catchPath, index) : undefined}
                onInsertAtPath={onInsertAtPath}
                nodeRegistry={nodeRegistry}
                errorMap={errorMap}
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
            <div className="text-xs text-gray-500 mb-2">Item: {feStep.itemVar} | Concurrency: {feStep.concurrency ?? 1}</div>
            <BlockSection title="BODY" idPrefix={`${step.id}-body`}>
              <Pipe
                steps={feStep.body}
                pipePath={bodyPath}
                stepPathPrefix={bodyPath}
                selectedStepId={selectedStepId}
                onSelectStep={onSelectStep}
                onDeleteStep={onDeleteStep}
                onSelectPipe={onSelectPipe}
                onPipeHover={onPipeHover}
                onInsertStep={onInsertAtPath ? (index) => onInsertAtPath(bodyPath, index) : undefined}
                onInsertAtPath={onInsertAtPath}
                nodeRegistry={nodeRegistry}
                errorMap={errorMap}
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

const StepConfigPanel: React.FC<{
  step: Step;
  stepPath?: string;
  errors: PublishError[];
  nodeRegistry: Record<string, NodeRegistryItem>;
  actionRegistry: ActionRegistryItem[];
  fieldOptions: SelectOption[];
  payloadSchema: JsonSchema | null;
  definition: WorkflowDefinition;
  onChange: (step: Step) => void;
}> = ({
  step,
  stepPath,
  errors,
  nodeRegistry,
  actionRegistry,
  fieldOptions,
  payloadSchema,
  definition,
  onChange
}) => {
  const nodeSchema = step.type.startsWith('control.') ? null : nodeRegistry[step.type]?.configSchema;
  const [showDataContext, setShowDataContext] = useState(false);

  // Build data context for this step position
  const dataContext = useMemo(() =>
    buildDataContext(definition, step.id, actionRegistry, payloadSchema),
    [definition, step.id, actionRegistry, payloadSchema]
  );

  // For action.call steps, get the selected action
  const selectedAction = useMemo(() => {
    if (step.type !== 'action.call') return undefined;
    const config = (step as NodeStep).config as { actionId?: string; version?: number } | undefined;
    return getActionFromRegistry(config?.actionId, config?.version, actionRegistry);
  }, [step, actionRegistry]);

  const saveAs = step.type === 'action.call'
    ? ((step as NodeStep).config as { saveAs?: string } | undefined)?.saveAs
    : undefined;

  // §17 - Extract action input fields for InputMappingEditor
  const actionInputFields = useMemo(() => {
    if (!selectedAction?.inputSchema) return [];
    return extractActionInputFields(selectedAction.inputSchema, selectedAction.inputSchema);
  }, [selectedAction]);

  // §17 - Get current input mapping from config
  const inputMapping = useMemo(() => {
    if (step.type !== 'action.call') return {};
    const config = (step as NodeStep).config as { inputMapping?: InputMapping } | undefined;
    return config?.inputMapping ?? {};
  }, [step]);

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

  // §16.2 - Enhanced field options with step outputs
  const enhancedFieldOptions = useMemo(() =>
    buildEnhancedFieldOptions(payloadSchema, dataContext),
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

  const handleNodeConfigChange = (config: Record<string, unknown>) => {
    onChange({ ...step, config });
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-semibold text-gray-800">{getStepLabel(step, nodeRegistry)}</div>
        <div className="text-xs text-gray-500">{stepPath ?? step.id}</div>
      </div>

      {errors.length > 0 && (
        <Card className="border border-red-200 bg-red-50 p-3">
          <div className="text-xs font-semibold text-red-700 mb-1">Validation errors</div>
          <ul className="text-xs text-red-700 space-y-1">
            {errors.map((error, index) => (
              <li key={`${error.code}-${index}`}>{error.message}</li>
            ))}
          </ul>
        </Card>
      )}

      {/* §16.5 - Expression validation errors/warnings */}
      {expressionValidations.length > 0 && (
        <div className="space-y-2">
          {expressionValidations.filter(v => v.validation.error).length > 0 && (
            <Card className="border border-red-200 bg-red-50 p-3">
              <div className="text-xs font-semibold text-red-700 mb-1 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                Expression errors
              </div>
              <ul className="text-xs text-red-700 space-y-1">
                {expressionValidations
                  .filter(v => v.validation.error)
                  .map((v, i) => (
                    <li key={i}><code className="bg-red-100 px-1 rounded">{v.field}</code>: {v.validation.error}</li>
                  ))}
              </ul>
            </Card>
          )}
          {expressionValidations.filter(v => v.validation.warning && !v.validation.error).length > 0 && (
            <Card className="border border-yellow-200 bg-yellow-50 p-3">
              <div className="text-xs font-semibold text-yellow-700 mb-1 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                Warnings
              </div>
              <ul className="text-xs text-yellow-700 space-y-1">
                {expressionValidations
                  .filter(v => v.validation.warning && !v.validation.error)
                  .map((v, i) => (
                    <li key={i}><code className="bg-yellow-100 px-1 rounded">{v.field}</code>: {v.validation.warning}</li>
                  ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      {!step.type.startsWith('control.') && (
        <Input
          id={`workflow-step-name-${step.id}`}
          label="Step name"
          value={(step as NodeStep).name ?? ''}
          onChange={(event) => onChange({ ...(step as NodeStep), name: event.target.value })}
        />
      )}

      {/* §19.4 - Enhanced Save Output section with toggle, preview, and copy */}
      {!step.type.startsWith('control.') && (() => {
        const nodeStep = step as NodeStep;
        const existingConfig = nodeStep.config as Record<string, unknown> | undefined;
        const currentSaveAs = (existingConfig?.saveAs as string) ?? '';
        const isSaveEnabled = !!currentSaveAs;
        const actionId = (existingConfig?.actionId as string) ?? '';

        const handleToggleSave = (enabled: boolean) => {
          if (enabled) {
            // Auto-generate name from actionId if available
            const autoName = actionId ? generateSaveAsName(actionId) : 'result';
            onChange({
              ...nodeStep,
              config: { ...existingConfig, saveAs: autoName }
            });
          } else {
            onChange({
              ...nodeStep,
              config: { ...existingConfig, saveAs: undefined }
            });
          }
        };

        const handleSaveAsChange = (value: string) => {
          onChange({
            ...nodeStep,
            config: { ...existingConfig, saveAs: value.trim() || undefined }
          });
        };

        return (
          <div className="space-y-2">
            {/* Toggle row */}
            <div className="flex items-center justify-between">
              <Label htmlFor={`workflow-step-saveAs-toggle-${step.id}`} className="text-sm font-medium">
                Save output
              </Label>
              <Switch
                id={`workflow-step-saveAs-toggle-${step.id}`}
                checked={isSaveEnabled}
                onCheckedChange={handleToggleSave}
              />
            </div>

            {/* Input and copy button when enabled */}
            {isSaveEnabled && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Input
                    id={`workflow-step-saveAs-${step.id}`}
                    placeholder="e.g., ticketDefaults"
                    value={currentSaveAs}
                    onChange={(event) => handleSaveAsChange(event.target.value)}
                    className={`flex-1 ${saveAsValidation?.type === 'error' ? 'border-red-500' : saveAsValidation?.type === 'warning' ? 'border-yellow-500' : ''}`}
                  />
                  <Button
                    id={`workflow-step-saveAs-copy-${step.id}`}
                    variant="outline"
                    size="sm"
                    onClick={() => handleCopyPath(`vars.${currentSaveAs}`)}
                    title="Copy full path"
                    className="flex-shrink-0"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>

                {/* Path preview */}
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <span>Accessible as:</span>
                  <code className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-700 font-mono">
                    vars.{currentSaveAs}
                  </code>
                </div>

                {/* §16.1 - saveAs conflict validation warning */}
                {saveAsValidation && (
                  <div className={`flex items-center gap-1 text-xs ${
                    saveAsValidation.type === 'error' ? 'text-red-600' : 'text-yellow-600'
                  }`}>
                    <AlertTriangle className="w-3 h-3" />
                    {saveAsValidation.message}
                  </div>
                )}
              </div>
            )}
          </div>
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
              options={[
                { value: 'continue', label: 'Continue' },
                { value: 'fail', label: 'Fail' }
              ]}
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

      {nodeSchema && step.type !== 'control.return' && step.type !== 'control.callWorkflow' && (
        <SchemaForm
          schema={nodeSchema}
          rootSchema={nodeSchema}
          value={(step as NodeStep).config as Record<string, unknown>}
          onChange={handleNodeConfigChange}
          fieldOptions={enhancedFieldOptions}
          actionRegistry={actionRegistry}
          stepId={step.id}
          excludeFields={step.type === 'action.call' ? ['inputMapping'] : []}
          expressionContext={expressionContext}
        />
      )}

      {/* §17 - Input Mapping Panel for action.call steps */}
      {step.type === 'action.call' && selectedAction && actionInputFields.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <p className="text-xs text-gray-500 mb-3">
            Map workflow data to action inputs. Drag fields or click to assign values.
          </p>
          <MappingPanel
            value={inputMapping}
            onChange={handleInputMappingChange}
            targetFields={actionInputFields}
            dataContext={dataContext}
            fieldOptions={enhancedFieldOptions}
            stepId={step.id}
          />
        </div>
      )}

      {/* §16.1 - Action Schema Reference for action.call steps */}
      {step.type === 'action.call' && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <ActionSchemaReference
            action={selectedAction}
            saveAs={saveAs}
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
          What data can I access here?
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
const PaletteTooltip: React.FC<{
  label: string;
  description: string;
  triggerRef: React.RefObject<HTMLDivElement | null>;
  isHovered: boolean;
}> = ({ label, description, triggerRef, isHovered }) => {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isHovered && triggerRef.current) {
      // Start delay timer
      timeoutRef.current = setTimeout(() => {
        if (triggerRef.current) {
          const rect = triggerRef.current.getBoundingClientRect();
          setPosition({
            top: rect.top + rect.height / 2,
            left: rect.right + 8
          });
          setVisible(true);
        }
      }, 500);
    } else {
      // Clear timer and hide immediately
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setVisible(false);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [isHovered, triggerRef]);

  if (!visible || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed px-2.5 py-1.5 rounded-md shadow-lg bg-gray-900 text-white text-xs whitespace-nowrap pointer-events-none"
      style={{
        top: position.top,
        left: position.left,
        transform: 'translateY(-50%)',
        zIndex: 99999
      }}
    >
      <div className="font-medium">{label}</div>
      <div className="text-gray-400 text-[10px]">{description}</div>
      {/* Arrow */}
      <div
        className="absolute border-4 border-transparent border-r-gray-900"
        style={{ right: '100%', top: '50%', transform: 'translateY(-50%)' }}
      />
    </div>,
    document.body
  );
};

// Wrapper component for palette item with tooltip
const PaletteItemWithTooltip: React.FC<{
  item: { id: string; label: string; description: string; type: string; actionId?: string; actionVersion?: number };
  icon: React.ReactNode;
  isDragging: boolean;
  provided: any;
  onClick: () => void;
}> = ({ item, icon, isDragging, provided, onClick }) => {
  const [isHovered, setIsHovered] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={(node) => {
        provided.innerRef(node);
        (triggerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }}
      {...provided.draggableProps}
      {...provided.dragHandleProps}
      className={`
        group relative flex items-center justify-center
        w-10 h-10 rounded-lg border cursor-grab
        transition-all duration-150
        ${isDragging
          ? 'shadow-lg ring-2 ring-primary-400 bg-primary-50 border-primary-300 z-50'
          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
        }
      `}
      data-testid={`palette-item-${item.id}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <span className="text-gray-500 group-hover:text-gray-700">
        {icon}
      </span>
      <PaletteTooltip
        label={item.label}
        description={item.description}
        triggerRef={triggerRef}
        isHovered={isHovered && !isDragging}
      />
    </div>
  );
};

// Field metadata for friendly labels and descriptions
const FIELD_METADATA: Record<string, { label: string; description?: string; advanced?: boolean }> = {
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
  timeoutMs: { label: 'Timeout (ms)', description: 'Maximum time to wait in milliseconds', advanced: true },
  state: { label: 'State Name', description: 'The state to transition to' },
  assign: { label: 'Assignments', description: 'Variables to assign' },
  taskType: { label: 'Task Type', description: 'Type of human task' },
  title: { label: 'Title', description: 'Task title shown to assignee' },
  contextData: { label: 'Context Data', description: 'Additional data to include with the task' },
};

const getFieldMeta = (key: string) => {
  if (FIELD_METADATA[key]) return FIELD_METADATA[key];
  // Convert camelCase to Title Case as fallback
  const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();
  return { label };
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
  expressionContext?: ExpressionContext;
}> = ({ schema, rootSchema, value, onChange, fieldOptions, actionRegistry, stepId, excludeFields = [], expressionContext }) => {
  const resolved = resolveSchema(schema, rootSchema);
  const configValue = value ?? {};
  const allProperties = resolved.properties ?? {};
  // Filter out excluded fields (e.g., inputMapping when MappingPanel is shown)
  const properties = Object.fromEntries(
    Object.entries(allProperties).filter(([key]) => !excludeFields.includes(key))
  );
  const required = resolved.required ?? [];
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
  const fieldEntries = Object.entries(properties);
  const regularFields = fieldEntries.filter(([key]) => !getFieldMeta(key).advanced);
  const advancedFields = fieldEntries.filter(([key]) => getFieldMeta(key).advanced);

  const renderField = (key: string, propSchema: JsonSchema) => {
    const resolvedProp = resolveSchema(propSchema, rootSchema);
    const meta = getFieldMeta(key);
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
            expressionContext={expressionContext}
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
        />
        {fieldDescription && <div className="text-xs text-gray-500 mt-1">{fieldDescription}</div>}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-semibold text-gray-800">Node Configuration</div>
        {missingRequired.length > 0 && (
          <div className="text-xs text-red-600">Missing required: {missingRequired.map(k => getFieldMeta(k).label).join(', ')}</div>
        )}
      </div>

      {/* Regular fields */}
      {regularFields.map(([key, propSchema]) => renderField(key, propSchema))}

      {/* Advanced fields (collapsible) */}
      {advancedFields.length > 0 && (
        <div className="border-t border-gray-200 pt-3">
          <button
            type="button"
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
}> = ({ idPrefix, label, value, onChange, fieldOptions, description, context }) => {
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
      />
      {error && <div className="text-xs text-red-600">{error}</div>}
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
}> = ({ idPrefix, label, value, onChange, fieldOptions, context }) => {
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
        <Button id={`${idPrefix}-add`} variant="outline" size="sm" onClick={handleAdd}>
          Add
        </Button>
      </div>
      {entries.length === 0 && <div className="text-xs text-gray-400">No mappings yet.</div>}
      <div className="space-y-3">
        {entries.map(([key, expr], index) => (
          <Card key={key} className="p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Input
                id={`${idPrefix}-key-${index}`}
                value={key}
                onChange={(event) => handleKeyChange(key, event.target.value)}
              />
              <Button
                id={`${idPrefix}-remove-${index}`}
                variant="ghost"
                size="sm"
                onClick={() => handleRemove(key)}
              >
                Remove
              </Button>
            </div>
            <ExpressionField
              idPrefix={`${idPrefix}-expr-${index}`}
              label="Expression"
              value={expr}
              onChange={(nextExpr) => handleUpdate(key, nextExpr)}
              fieldOptions={fieldOptions}
              context={context}
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
}> = ({ idPrefix, label, value, onChange }) => {
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
        onChange={(event) => handleChange(event.target.value)}
        rows={4}
        className={error ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : ''}
      />
      {error && <div className="text-xs text-red-600">{error}</div>}
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
        {field.required && <span className="text-red-500">*</span>}

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
        <div className="px-2 py-2 bg-white max-h-64 overflow-y-auto">
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

// §16.1 - Action Schema Reference (shows input/output for action.call steps)
const ActionSchemaReference: React.FC<{
  action: ActionRegistryItem | undefined;
  saveAs?: string;
  onCopyPath?: (path: string) => void;
}> = ({ action, saveAs, onCopyPath }) => {
  const [showRawSchema, setShowRawSchema] = useState(false);

  if (!action) {
    return (
      <div className="text-xs text-gray-400 p-3 border border-dashed border-gray-200 rounded-md text-center">
        Select an action to see its input/output schema
      </div>
    );
  }

  const inputFields = extractSchemaFields(action.inputSchema, action.inputSchema);
  const outputFields = extractSchemaFields(action.outputSchema, action.outputSchema);

  return (
    <div className="space-y-3">
      {/* Action description */}
      {action.ui?.description && (
        <div className="text-xs text-gray-600 bg-blue-50 p-2 rounded-md flex items-start gap-2">
          <Info className="w-3.5 h-3.5 text-blue-500 mt-0.5 flex-shrink-0" />
          <span>{action.ui.description}</span>
        </div>
      )}

      {/* Input Schema */}
      <SchemaReferenceSection
        title="Input Schema"
        icon={<Code className="w-3.5 h-3.5 text-gray-500" />}
        fields={inputFields}
        pathPrefix="input"
        defaultExpanded={true}
        emptyMessage="No input parameters"
        onCopyPath={onCopyPath}
      />

      {/* Output Schema */}
      <SchemaReferenceSection
        title="Output Schema"
        icon={<FileJson className="w-3.5 h-3.5 text-gray-500" />}
        fields={outputFields}
        pathPrefix={saveAs ? `vars.${saveAs}` : 'output'}
        defaultExpanded={true}
        emptyMessage="No output fields"
        onCopyPath={onCopyPath}
        headerExtra={
          saveAs && (
            <span className="text-[10px] text-gray-500 font-normal">
              → vars.{saveAs}
            </span>
          )
        }
      />

      {/* SaveAs preview */}
      {saveAs && (
        <div className="text-xs bg-green-50 border border-green-200 rounded-md p-2 flex items-center gap-2">
          <Check className="w-3.5 h-3.5 text-green-600" />
          <span className="text-green-700">
            Output available at <code className="bg-green-100 px-1 rounded">${`{vars.${saveAs}}`}</code>
          </span>
        </div>
      )}

      {/* Raw schema toggle and export */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setShowRawSchema(!showRawSchema)}
          className="text-[10px] text-gray-500 hover:text-gray-700 flex items-center gap-1"
        >
          {showRawSchema ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          {showRawSchema ? 'Hide' : 'Show'} raw JSON Schema
        </button>

        {/* §16.7 - Export schema as JSON */}
        <button
          onClick={() => {
            const schema = {
              actionId: action.id,
              version: action.version,
              inputSchema: action.inputSchema,
              outputSchema: action.outputSchema
            };
            const blob = new Blob([JSON.stringify(schema, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${action.id}-schema.json`;
            a.click();
            URL.revokeObjectURL(url);
          }}
          className="text-[10px] text-blue-500 hover:text-blue-700 flex items-center gap-1"
          title="Download schema as JSON file"
        >
          <FileJson className="w-3 h-3" />
          Export schema
        </button>
      </div>

      {showRawSchema && (
        <div className="text-[10px] font-mono bg-gray-900 text-gray-100 p-2 rounded-md overflow-x-auto">
          <div className="text-gray-400 mb-1">// Input Schema</div>
          <pre>{JSON.stringify(action.inputSchema, null, 2)}</pre>
          <div className="text-gray-400 mt-2 mb-1">// Output Schema</div>
          <pre>{JSON.stringify(action.outputSchema, null, 2)}</pre>
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
