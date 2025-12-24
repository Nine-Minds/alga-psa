'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DragDropContext, Draggable, Droppable, DropResult } from '@hello-pangea/dnd';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'react-hot-toast';
import { Plus, GripVertical, ChevronRight, ChevronDown, AlertTriangle, Copy, Info, HelpCircle, FileJson, Code, Check, Eye, EyeOff } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TextArea } from '@/components/ui/TextArea';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import CustomSelect, { SelectOption } from '@/components/ui/CustomSelect';
import CustomTabs from '@/components/ui/CustomTabs';
import { Switch } from '@/components/ui/Switch';
import { Label } from '@/components/ui/Label';
import WorkflowRunList from './WorkflowRunList';
import WorkflowDeadLetterQueue from './WorkflowDeadLetterQueue';
import WorkflowEventList from './WorkflowEventList';
import WorkflowDefinitionAudit from './WorkflowDefinitionAudit';
import { MappingPanel, type ActionInputField } from './mapping';
import { getCurrentUserPermissions } from 'server/src/lib/actions/user-actions/userActions';
import {
  createWorkflowDefinitionAction,
  getWorkflowSchemaAction,
  listWorkflowDefinitionsAction,
  listWorkflowRegistryActionsAction,
  listWorkflowRegistryNodesAction,
  publishWorkflowDefinitionAction,
  updateWorkflowDefinitionDraftAction,
  updateWorkflowDefinitionMetadataAction
} from 'server/src/lib/actions/workflow-runtime-v2-actions';

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

type WorkflowDefinitionRecord = {
  workflow_id: string;
  name: string;
  description?: string | null;
  payload_schema_ref: string;
  trigger?: Record<string, unknown> | null;
  draft_definition: WorkflowDefinition;
  draft_version: number;
  status: string;
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
  if (!schema.$ref || !root?.definitions) return schema;
  const refKey = schema.$ref.replace('#/definitions/', '');
  return root.definitions?.[refKey] ?? schema;
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
      return Object.keys(resolved.properties).reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = buildDefaultValueFromSchema(resolved.properties?.[key] ?? {}, root);
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
    { value: 'error', label: '⚠️ error' },
    { value: 'error.message', label: 'error.message' }
  ];

  // Add payload fields
  if (payloadSchema) {
    collectSchemaPaths(payloadSchema, payloadSchema).forEach((path) => {
      if (!options.some((opt) => opt.value === path)) {
        options.push({ value: path, label: path });
      }
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

const ensureExpr = (value: Expr | undefined): Expr => ({ $expr: value?.$expr ?? '' });

const createStepFromPalette = (
  type: Step['type'],
  nodeRegistry: Record<string, NodeRegistryItem>
): Step => {
  const id = uuidv4();

  if (type === 'control.if') {
    return {
      id,
      type: 'control.if',
      condition: { $expr: '' },
      then: [],
      else: []
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
      try: [],
      catch: []
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
  const [activeTab, setActiveTab] = useState('Designer');
  const [definitions, setDefinitions] = useState<WorkflowDefinitionRecord[]>([]);
  const [activeDefinition, setActiveDefinition] = useState<WorkflowDefinition | null>(null);
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(null);
  const [nodeRegistry, setNodeRegistry] = useState<NodeRegistryItem[]>([]);
  const [actionRegistry, setActionRegistry] = useState<ActionRegistryItem[]>([]);
  const [payloadSchema, setPayloadSchema] = useState<JsonSchema | null>(null);
  const [search, setSearch] = useState('');
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [selectedPipePath, setSelectedPipePath] = useState<string>('root');
  const [publishErrors, setPublishErrors] = useState<PublishError[]>([]);
  const [publishWarnings, setPublishWarnings] = useState<PublishError[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [userPermissions, setUserPermissions] = useState<string[]>([]);
  const [registryError, setRegistryError] = useState(false);
  const [metadataDraft, setMetadataDraft] = useState<{
    isVisible: boolean;
    isPaused: boolean;
    concurrencyLimit: string;
    autoPauseOnFailure: boolean;
    failureRateThreshold: string;
    failureRateMinRuns: string;
  } | null>(null);
  const [isSavingMetadata, setIsSavingMetadata] = useState(false);

  const nodeRegistryMap = useMemo(() => Object.fromEntries(nodeRegistry.map((node) => [node.id, node])), [nodeRegistry]);

  const stepPathMap = useMemo(() => {
    return activeDefinition ? buildStepPathMap(activeDefinition.steps as Step[]) : {};
  }, [activeDefinition]);

  const fieldOptions = useMemo(() => buildFieldOptions(payloadSchema), [payloadSchema]);

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

  const errorsByStepId = useMemo(() => {
    const map = new Map<string, PublishError[]>();
    publishErrors.forEach((error) => {
      const entry = Object.entries(stepPathMap).find(([, path]) => path === error.stepPath);
      const stepId = error.stepId ?? entry?.[0];
      if (stepId) {
        const existing = map.get(stepId) ?? [];
        existing.push(error);
        map.set(stepId, existing);
      }
    });
    return map;
  }, [publishErrors, stepPathMap]);

  const activeWorkflowRecord = useMemo(
    () => definitions.find((definition) => definition.workflow_id === activeWorkflowId) ?? null,
    [definitions, activeWorkflowId]
  );

  const canAdmin = useMemo(
    () => userPermissions.includes('workflow:admin'),
    [userPermissions]
  );
  const canManage = useMemo(
    () => userPermissions.includes('workflow:manage') || canAdmin,
    [userPermissions, canAdmin]
  );
  const canPublish = useMemo(
    () => userPermissions.includes('workflow:publish') || canAdmin,
    [userPermissions, canAdmin]
  );
  const canEditMetadata = useMemo(
    () => canManage && (!activeWorkflowRecord?.is_system || canAdmin),
    [canManage, canAdmin, activeWorkflowRecord]
  );

  const loadDefinitions = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await listWorkflowDefinitionsAction();
      const nextDefinitions = data ?? [];
      setDefinitions(nextDefinitions);
      if (nextDefinitions.length > 0) {
        const record = nextDefinitions[0] as WorkflowDefinitionRecord;
        setActiveDefinition((current) => current ?? record.draft_definition);
        setActiveWorkflowId((current) => current ?? record.workflow_id);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load workflows');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadRegistries = useCallback(async () => {
    try {
      const overrides = getWorkflowPlaywrightOverrides();
      if (overrides?.failRegistries) {
        throw new Error('Failed to load workflow registries');
      }
      if (overrides?.registryNodes || overrides?.registryActions) {
        setNodeRegistry((overrides.registryNodes ?? []) as NodeRegistryItem[]);
        setActionRegistry((overrides.registryActions ?? []) as ActionRegistryItem[]);
        setRegistryError(false);
        return;
      }
      const [nodes, actions] = await Promise.all([
        listWorkflowRegistryNodesAction(),
        listWorkflowRegistryActionsAction()
      ]);
      setNodeRegistry((nodes ?? []) as unknown as NodeRegistryItem[]);
      setActionRegistry((actions ?? []) as unknown as ActionRegistryItem[]);
      setRegistryError(false);
    } catch (error) {
      setNodeRegistry([]);
      setActionRegistry([]);
      setRegistryError(true);
      toast.error('Failed to load workflow registries');
    }
  }, []);

  const loadPayloadSchema = useCallback(async (schemaRef: string | undefined) => {
    if (!schemaRef) {
      setPayloadSchema(null);
      return;
    }
    try {
      const result = await getWorkflowSchemaAction({ schemaRef });
      setPayloadSchema(result.schema ?? null);
    } catch (error) {
      setPayloadSchema(null);
    }
  }, []);

  useEffect(() => {
    loadDefinitions();
    loadRegistries();
  }, [loadDefinitions, loadRegistries]);

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
    if (activeDefinition?.payloadSchemaRef) {
      loadPayloadSchema(activeDefinition.payloadSchemaRef);
    }
  }, [activeDefinition?.payloadSchemaRef, loadPayloadSchema]);

  const handleSelectDefinition = (record: WorkflowDefinitionRecord) => {
    setActiveDefinition(record.draft_definition);
    setActiveWorkflowId(record.workflow_id);
    setPublishErrors([]);
    setPublishWarnings([]);
    setSelectedStepId(null);
    setSelectedPipePath('root');
  };

  const handleCreateDefinition = () => {
    const draft = createDefaultDefinition();
    setActiveDefinition(draft);
    setActiveWorkflowId(null);
    setSelectedStepId(null);
    setSelectedPipePath('root');
    setPublishErrors([]);
    setPublishWarnings([]);
  };

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
        const data = await createWorkflowDefinitionAction({ definition: activeDefinition });
        setActiveWorkflowId(data.workflowId);
        setActiveDefinition({ ...activeDefinition, id: data.workflowId });
        toast.success('Workflow created');
      } else {
        await updateWorkflowDefinitionDraftAction({
          workflowId: activeWorkflowId,
          definition: activeDefinition
        });
        toast.success('Workflow saved');
      }
      await loadDefinitions();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save workflow');
    } finally {
      setIsSaving(false);
    }
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
      await loadDefinitions();
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
      setPublishErrors(data.errors ?? []);
      setPublishWarnings(data.warnings ?? []);
      if (data.ok === false) {
        toast.error('Publish failed - fix validation errors');
        return;
      }
      toast.success('Workflow published');
      await loadDefinitions();
    } catch (error) {
      toast.error('Failed to publish workflow');
    } finally {
      setIsPublishing(false);
    }
  };

  // §16.6 - Enhanced handleAddStep to accept initial config (for pre-configured action items)
  const handleAddStep = (type: Step['type'], initialConfig?: Record<string, unknown>) => {
    if (!activeDefinition) return;
    let newStep = createStepFromPalette(type, nodeRegistryMap);
    // Apply initial config if provided (e.g., for action items with pre-selected actionId)
    if (initialConfig && 'config' in newStep) {
      const existingConfig = (newStep as NodeStep).config as Record<string, unknown> | undefined;
      newStep = {
        ...newStep,
        config: { ...existingConfig, ...initialConfig }
      };
    }
    const segments = parsePipePath(selectedPipePath);
    const steps = getStepsAtPath(activeDefinition.steps as Step[], segments);
    const nextSteps = [...steps, newStep];
    const updatedSteps = updateStepsAtPath(activeDefinition.steps as Step[], segments, nextSteps);
    setActiveDefinition({ ...activeDefinition, steps: updatedSteps });
    setSelectedStepId(newStep.id);
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

  const hoveredPipePathRef = useRef<string | null>(null);
  const isDraggingRef = useRef(false);

  const handleDragStart = () => {
    isDraggingRef.current = true;
    hoveredPipePathRef.current = null;
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
    if (!activeDefinition) return;

    isDraggingRef.current = false;
    const hoverTarget = hoveredPipePathRef.current;
    hoveredPipePathRef.current = null;

    const sourcePipe = result.source.droppableId.replace('pipe:', '');
    const destinationPipe = result.destination?.droppableId.replace('pipe:', '') ?? null;

    let resolvedDestPipe = destinationPipe;
    if (!resolvedDestPipe || resolvedDestPipe === sourcePipe) {
      if (hoverTarget && hoverTarget !== sourcePipe) {
        resolvedDestPipe = hoverTarget;
      }
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
    const insertIndex =
      destinationPipe && destinationPipe === resolvedDestPipe && result.destination
        ? result.destination.index
        : destSteps.length;
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
    return paletteItems.reduce<Record<string, typeof paletteItems>>((acc, item) => {
      acc[item.category] = acc[item.category] || [];
      acc[item.category].push(item);
      return acc;
    }, {});
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

  const designerContent = (
    <div className="flex flex-col h-full">
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-72 border-r bg-white flex flex-col">
          <div className="p-4 border-b">
            <Input
              id="workflow-designer-search"
              placeholder="Search nodes"
              value={search}
              disabled={registryError}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="px-4 py-3 border-b">
            <Label>Insert into</Label>
            <CustomSelect
              id="workflow-designer-pipe-select"
              options={pipeOptions.map((pipe) => ({ value: pipe.pipePath, label: pipe.label }))}
              value={selectedPipePath}
              disabled={registryError}
              onValueChange={setSelectedPipePath}
              placeholder="Select pipe"
            />
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {Object.entries(groupedPaletteItems).map(([category, items]) => (
              <div key={category}>
                <div className="text-xs font-semibold uppercase text-gray-500 mb-2">{category}</div>
                <div className="space-y-2">
                  {items.map((item) => (
                    <Card
                      key={item.id}
                      className="border border-gray-200 p-3 flex items-start justify-between"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900">{item.label}</div>
                        <div className="text-xs text-gray-500">{item.description}</div>
                        {/* §16.6 - Show output summary */}
                        {item.outputSummary && (
                          <div className="text-[10px] text-blue-600 mt-1 truncate" title={item.outputSummary}>
                            {item.outputSummary}
                          </div>
                        )}
                      </div>
                      <Button
                        id={`workflow-designer-add-${item.id}`}
                        variant="outline"
                        size="sm"
                        className="ml-2 flex-shrink-0"
                        disabled={registryError}
                        onClick={() => {
                          // §16.6 - Handle action items with pre-configured actionId
                          const itemWithAction = item as typeof item & { actionId?: string; actionVersion?: number };
                          if (itemWithAction.actionId) {
                            handleAddStep('action.call', {
                              actionId: itemWithAction.actionId,
                              version: itemWithAction.actionVersion
                            });
                          } else {
                            handleAddStep(item.type as Step['type']);
                          }
                        }}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <main className="flex-1 overflow-hidden bg-gray-50">
          <div className="flex h-full">
            <div className="flex-1 overflow-y-auto p-6">
              <div className="max-w-4xl mx-auto space-y-6">
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
                  <Input
                    id="workflow-designer-schema"
                    label="Payload schema ref"
                    value={activeDefinition?.payloadSchemaRef ?? ''}
                    onChange={(event) => handleDefinitionChange({ payloadSchemaRef: event.target.value })}
                  />
                  <Input
                    id="workflow-designer-trigger"
                    label="Trigger event name"
                    placeholder="Optional"
                    value={activeDefinition?.trigger?.eventName ?? ''}
                    onChange={(event) => {
                      const value = event.target.value.trim();
                      if (!value) {
                        handleDefinitionChange({ trigger: undefined });
                      } else {
                        handleDefinitionChange({ trigger: { type: 'event', eventName: value } });
                      }
                    }}
                  />
                </Card>

                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">Workflow Steps</h2>
                      <p className="text-sm text-gray-500">Drag steps to reorder or move between pipes.</p>
                    </div>
                    {publishWarnings.length > 0 && (
                      <Badge className="bg-yellow-100 text-yellow-800">{publishWarnings.length} warnings</Badge>
                    )}
                  </div>
                  <DragDropContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                    <Pipe
                      steps={activeDefinition?.steps ?? []}
                      pipePath="root"
                      stepPathPrefix="root"
                      selectedStepId={selectedStepId}
                      onSelectStep={setSelectedStepId}
                      onDeleteStep={handleDeleteStep}
                      onSelectPipe={handlePipeSelect}
                      onPipeHover={handlePipeHover}
                      nodeRegistry={nodeRegistryMap}
                      errorMap={errorsByStepId}
                    />
                  </DragDropContext>
                </div>
              </div>
            </div>

            <aside className="w-96 border-l bg-white overflow-y-auto p-4 space-y-4">
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

              {publishErrors.length > 0 && activeDefinition && (
                <div className="mt-6">
                  <h3 className="text-sm font-semibold text-red-700 flex items-center gap-2 mb-2">
                    <AlertTriangle className="h-4 w-4" /> Publish Errors
                  </h3>
                  <div className="space-y-3">
                    {publishErrors.map((error, index) => (
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
            </aside>
          </div>
        </main>
      </div>

      <div className="border-t bg-white px-6 py-3">
        <div className="flex items-center gap-4">
          <div className="text-sm text-gray-500">{isLoading ? 'Loading workflows...' : `${definitions.length} workflows`}</div>
          <div id="workflow-designer-list" className="flex items-center gap-2 overflow-x-auto">
            {definitions.map((definition) => (
              <Button
                key={definition.workflow_id}
                id={`workflow-designer-open-${definition.workflow_id}`}
                variant={definition.workflow_id === activeWorkflowId ? 'default' : 'outline'}
                onClick={() => handleSelectDefinition(definition)}
              >
                {definition.name}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  const runListContent = (
    <WorkflowRunList
      definitions={definitions.map((definition) => ({
        workflow_id: definition.workflow_id,
        name: definition.name,
        trigger: definition.trigger ?? null
      }))}
      isActive={activeTab === 'Runs'}
      canAdmin={canAdmin}
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

  return (
    <div className="h-full flex flex-col">
      <div className="border-b bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Workflow Designer</h1>
            <p className="text-sm text-gray-500">Build structured pipelines with published validation.</p>
          </div>
          {activeTab === 'Designer' && (
            <div className="flex items-center gap-2">
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
              {canPublish && (
                <Button
                  id="workflow-designer-publish"
                  onClick={handlePublish}
                  disabled={isPublishing || !activeDefinition}
                >
                  {isPublishing ? 'Publishing...' : 'Publish'}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        <CustomTabs
          idPrefix="workflow-designer-tabs"
          value={activeTab}
          onTabChange={setActiveTab}
          tabs={[
            { label: 'Designer', content: designerContent },
            { label: 'Runs', content: runListContent },
            { label: 'Events', content: eventListContent },
            ...(canAdmin ? [{ label: 'Dead Letter', content: deadLetterContent }] : []),
            ...(canAdmin ? [{ label: 'Audit', content: auditContent }] : [])
          ]}
          tabStyles={{
            root: 'h-full flex flex-col',
            content: 'flex-1 overflow-hidden',
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
  nodeRegistry: Record<string, NodeRegistryItem>;
  errorMap: Map<string, PublishError[]>;
}> = ({
  steps,
  pipePath,
  stepPathPrefix,
  selectedStepId,
  onSelectStep,
  onDeleteStep,
  onSelectPipe,
  onPipeHover,
  nodeRegistry,
  errorMap
}) => {
  const pipeId = `workflow-designer-pipe-${pipePath.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

  return (
    <Droppable droppableId={`pipe:${pipePath}`}>
      {(provided) => (
        <div
          id={pipeId}
          data-pipe-path={pipePath}
          ref={provided.innerRef}
          {...provided.droppableProps}
          onClick={(event) => {
            event.stopPropagation();
            onSelectPipe(pipePath);
          }}
          onMouseEnter={() => onPipeHover(pipePath)}
          onMouseMove={() => onPipeHover(pipePath)}
          className="space-y-3 rounded-lg border border-dashed border-gray-300 bg-white p-4"
        >
          {steps.map((step, index) => (
            <Draggable key={step.id} draggableId={step.id} index={index}>
              {(dragProvided) => (
                <div
                  ref={dragProvided.innerRef}
                  {...dragProvided.draggableProps}
                  data-step-id={step.id}
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
                    dragHandleProps={dragProvided.dragHandleProps}
                    nodeRegistry={nodeRegistry}
                    errorCount={errorMap.get(step.id)?.length ?? 0}
                    errorMap={errorMap}
                  />
                </div>
              )}
            </Draggable>
          ))}
          {provided.placeholder}
          {steps.length === 0 && (
            <div className="text-sm text-gray-400">Drop steps here</div>
          )}
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
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  nodeRegistry: Record<string, NodeRegistryItem>;
  errorCount: number;
  errorMap: Map<string, PublishError[]>;
}> = ({
  step,
  stepPath,
  selected,
  selectedStepId,
  onSelectStep,
  onDeleteStep,
  onSelectPipe,
  onPipeHover,
  dragHandleProps,
  nodeRegistry,
  errorCount,
  errorMap
}) => {
  const label = getStepLabel(step, nodeRegistry);
  const isBlock = step.type.startsWith('control.');

  return (
    <Card
      className={`p-4 border ${selected ? 'border-primary-400 ring-2 ring-primary-200' : 'border-gray-200'} ${
        errorCount > 0 ? 'border-red-400' : ''
      }`}
    >
      <div className="flex items-start justify-between">
        <button
          id={`workflow-step-select-${step.id}`}
          className="text-left flex-1"
          type="button"
          onClick={() => onSelectStep(step.id)}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-900">{label}</span>
            {isBlock && <Badge className="bg-blue-100 text-blue-800">Block</Badge>}
            {errorCount > 0 && <Badge className="bg-red-100 text-red-700">{errorCount} errors</Badge>}
          </div>
          <div className="text-xs text-gray-500">{step.id}</div>
        </button>
        <div className="flex items-center gap-2">
          <div
            id={`workflow-step-drag-${step.id}`}
            {...dragHandleProps}
            className="cursor-grab text-gray-400 hover:text-gray-600"
          >
            <GripVertical className="h-4 w-4" />
          </div>
          <Button
            id={`workflow-step-delete-${step.id}`}
            variant="ghost"
            size="sm"
            onClick={() => onDeleteStep(step.id)}
          >
            Delete
          </Button>
        </div>
      </div>

      {step.type === 'control.if' && (() => {
        const ifStep = step as IfBlock;
        return (
          <div className="mt-3 space-y-2">
            <BlockSection title="THEN" idPrefix={`${step.id}-then`}>
              <Pipe
                steps={ifStep.then}
                pipePath={`${stepPath}.then`}
                stepPathPrefix={`${stepPath}.then`}
                selectedStepId={selectedStepId}
                onSelectStep={onSelectStep}
                onDeleteStep={onDeleteStep}
                onSelectPipe={onSelectPipe}
                onPipeHover={onPipeHover}
                nodeRegistry={nodeRegistry}
                errorMap={errorMap}
              />
            </BlockSection>
            <BlockSection title="ELSE" idPrefix={`${step.id}-else`}>
              <Pipe
                steps={ifStep.else ?? []}
                pipePath={`${stepPath}.else`}
                stepPathPrefix={`${stepPath}.else`}
                selectedStepId={selectedStepId}
                onSelectStep={onSelectStep}
                onDeleteStep={onDeleteStep}
                onSelectPipe={onSelectPipe}
                onPipeHover={onPipeHover}
                nodeRegistry={nodeRegistry}
                errorMap={errorMap}
              />
            </BlockSection>
          </div>
        );
      })()}

      {step.type === 'control.tryCatch' && (() => {
        const tcStep = step as TryCatchBlock;
        return (
          <div className="mt-3 space-y-2">
            <BlockSection title="TRY" idPrefix={`${step.id}-try`}>
              <Pipe
                steps={tcStep.try}
                pipePath={`${stepPath}.try`}
                stepPathPrefix={`${stepPath}.try`}
                selectedStepId={selectedStepId}
                onSelectStep={onSelectStep}
                onDeleteStep={onDeleteStep}
                onSelectPipe={onSelectPipe}
                onPipeHover={onPipeHover}
                nodeRegistry={nodeRegistry}
                errorMap={errorMap}
              />
            </BlockSection>
            <BlockSection title="CATCH" idPrefix={`${step.id}-catch`}>
              <Pipe
                steps={tcStep.catch}
                pipePath={`${stepPath}.catch`}
                stepPathPrefix={`${stepPath}.catch`}
                selectedStepId={selectedStepId}
                onSelectStep={onSelectStep}
                onDeleteStep={onDeleteStep}
                onSelectPipe={onSelectPipe}
                onPipeHover={onPipeHover}
                nodeRegistry={nodeRegistry}
                errorMap={errorMap}
              />
            </BlockSection>
          </div>
        );
      })()}

      {step.type === 'control.forEach' && (() => {
        const feStep = step as ForEachBlock;
        return (
          <div className="mt-3">
            <div className="text-xs text-gray-500 mb-2">Item: {feStep.itemVar} | Concurrency: {feStep.concurrency ?? 1}</div>
            <BlockSection title="BODY" idPrefix={`${step.id}-body`}>
              <Pipe
                steps={feStep.body}
                pipePath={`${stepPath}.body`}
                stepPathPrefix={`${stepPath}.body`}
                selectedStepId={selectedStepId}
                onSelectStep={onSelectStep}
                onDeleteStep={onDeleteStep}
                onSelectPipe={onSelectPipe}
                onPipeHover={onPipeHover}
                nodeRegistry={nodeRegistry}
                errorMap={errorMap}
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
    const reservedNames = ['payload', 'vars', 'meta', 'error', 'env', 'secrets', '$item', '$index'];
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

      {!step.type.startsWith('control.') && (
        <div className="space-y-1">
          <Input
            id={`workflow-step-saveAs-${step.id}`}
            label="Save output as"
            placeholder="e.g., ticketDefaults"
            value={((step as NodeStep).config as { saveAs?: string } | undefined)?.saveAs ?? ''}
            onChange={(event) => {
              const nodeStep = step as NodeStep;
              const existingConfig = nodeStep.config as Record<string, unknown> | undefined;
              const value = event.target.value.trim();
              onChange({
                ...nodeStep,
                config: {
                  ...existingConfig,
                  saveAs: value || undefined
                }
              });
            }}
            className={saveAsValidation?.type === 'error' ? 'border-red-500' : saveAsValidation?.type === 'warning' ? 'border-yellow-500' : ''}
          />
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

      {step.type === 'control.if' && (() => {
        const ifStep = step as IfBlock;
        return (
          <ExpressionField
            idPrefix={`if-condition-${step.id}`}
            label="Condition"
            value={ensureExpr(ifStep.condition)}
            onChange={(expr) => onChange({ ...ifStep, condition: expr })}
            fieldOptions={enhancedFieldOptions}
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
            />
            <MappingExprEditor
              idPrefix={`call-workflow-output-${step.id}`}
              label="Output mapping"
              value={cwStep.outputMapping ?? {}}
              onChange={(mapping) => onChange({ ...cwStep, outputMapping: mapping })}
              fieldOptions={enhancedFieldOptions}
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
        />
      )}

      {/* §17 - Input Mapping Panel for action.call steps */}
      {step.type === 'action.call' && selectedAction && actionInputFields.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-200">
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

const SchemaForm: React.FC<{
  schema: JsonSchema;
  rootSchema: JsonSchema;
  value: Record<string, unknown> | undefined;
  onChange: (value: Record<string, unknown>) => void;
  fieldOptions: SelectOption[];
  actionRegistry: ActionRegistryItem[];
  stepId: string;
}> = ({ schema, rootSchema, value, onChange, fieldOptions, actionRegistry, stepId }) => {
  const resolved = resolveSchema(schema, rootSchema);
  const configValue = value ?? {};
  const properties = resolved.properties ?? {};
  const required = resolved.required ?? [];

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

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-semibold text-gray-800">Node Configuration</div>
        {missingRequired.length > 0 && (
          <div className="text-xs text-red-600">Missing required: {missingRequired.join(', ')}</div>
        )}
      </div>

      {Object.entries(properties).map(([key, propSchema]) => {
        const resolvedProp = resolveSchema(propSchema, rootSchema);
        if (isExprSchema(resolvedProp, rootSchema)) {
          return (
            <ExpressionField
              key={key}
              idPrefix={`config-${stepId}-${key}`}
              label={key}
              value={ensureExpr(configValue[key] as Expr | undefined)}
              onChange={(expr) => updateValue(key, expr)}
              fieldOptions={fieldOptions}
              description={resolvedProp.description}
            />
          );
        }

        if (resolvedProp.enum) {
          return (
            <CustomSelect
              key={key}
              id={`config-${stepId}-${key}`}
              label={key}
              options={resolvedProp.enum.map((item) => ({ value: String(item ?? ''), label: String(item ?? '') }))}
              value={configValue[key] === undefined || configValue[key] === null ? '' : String(configValue[key])}
              onValueChange={(val) => updateValue(key, val)}
            />
          );
        }

        const propType = normalizeSchemaType(resolvedProp);
        if (propType === 'string') {
          return (
            <Input
              key={key}
              id={`config-${stepId}-${key}`}
              label={key}
              value={(configValue[key] as string) ?? ''}
              onChange={(event) => updateValue(key, event.target.value)}
            />
          );
        }

        if (propType === 'number' || propType === 'integer') {
          return (
            <Input
              key={key}
              id={`config-${stepId}-${key}`}
              label={key}
              type="number"
              value={(configValue[key] as number) ?? 0}
              onChange={(event) => updateValue(key, Number(event.target.value))}
            />
          );
        }

        if (propType === 'boolean') {
          return (
            <div key={key} className="flex items-center justify-between">
              <Label htmlFor={`config-${stepId}-${key}`}>{key}</Label>
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
                label={key}
                value={(configValue[key] as Record<string, Expr>) ?? {}}
                onChange={(mapping) => updateValue(key, mapping)}
                fieldOptions={fieldOptions}
              />
            );
          }

          if (resolvedProp.additionalProperties) {
            return (
              <JsonField
                key={key}
                idPrefix={`config-${stepId}-${key}`}
                label={key}
                value={configValue[key]}
                onChange={(nextValue) => updateValue(key, nextValue)}
              />
            );
          }

          return (
            <div key={key} className="border border-gray-200 rounded-md p-3 space-y-2">
              <div className="text-xs font-semibold text-gray-500 uppercase">{key}</div>
              <SchemaForm
                schema={resolvedProp}
                rootSchema={rootSchema}
                value={(configValue[key] as Record<string, unknown>) ?? {}}
                onChange={(next) => updateValue(key, next)}
                fieldOptions={fieldOptions}
                actionRegistry={actionRegistry}
                stepId={`${stepId}-${key}`}
              />
            </div>
          );
        }

        if (propType === 'array') {
          return (
            <JsonField
              key={key}
              idPrefix={`config-${stepId}-${key}`}
              label={key}
              value={configValue[key]}
              onChange={(nextValue) => updateValue(key, nextValue)}
            />
          );
        }

        return (
          <JsonField
            key={key}
            idPrefix={`config-${stepId}-${key}`}
            label={key}
            value={configValue[key]}
            onChange={(nextValue) => updateValue(key, nextValue)}
          />
        );
      })}

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
}> = ({ idPrefix, label, value, onChange, fieldOptions, description }) => {
  const [error, setError] = useState<string | null>(null);

  const handleChange = (nextValue: string) => {
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
  };

  const handleInsert = (path: string) => {
    if (!path) return;
    const current = value.$expr ?? '';
    const next = current ? `${current} ${path}` : path;
    handleChange(next);
  };

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
      <TextArea
        id={`${idPrefix}-expr`}
        value={value.$expr ?? ''}
        onChange={(event) => handleChange(event.target.value)}
        rows={2}
        className={error ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : ''}
      />
      {error && <div className="text-xs text-red-600">{error}</div>}
      {description && <div className="text-xs text-gray-500">{description}</div>}
    </div>
  );
};

const MappingExprEditor: React.FC<{
  idPrefix: string;
  label: string;
  value: Record<string, Expr>;
  onChange: (value: Record<string, Expr>) => void;
  fieldOptions: SelectOption[];
}> = ({ idPrefix, label, value, onChange, fieldOptions }) => {
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
