'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DragDropContext, Draggable, Droppable, DropResult } from '@hello-pangea/dnd';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'react-hot-toast';
import { Plus, GripVertical, ChevronRight, ChevronDown, AlertTriangle } from 'lucide-react';

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
  PublishError
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
  saveDraftDelayMs?: number;
  saveSettingsDelayMs?: number;
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
      setDefinitions(data ?? []);
      if (!activeDefinition && data?.length) {
        const record = data[0] as WorkflowDefinitionRecord;
        setActiveDefinition(record.draft_definition);
        setActiveWorkflowId(record.workflow_id);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load workflows');
    } finally {
      setIsLoading(false);
    }
  }, [activeDefinition]);

  const loadRegistries = useCallback(async () => {
    try {
      const overrides = getWorkflowPlaywrightOverrides();
      if (overrides?.failRegistries) {
        throw new Error('Failed to load workflow registries');
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
    } catch (error) {
      toast.error('Failed to publish workflow');
    } finally {
      setIsPublishing(false);
    }
  };

  const handleAddStep = (type: Step['type']) => {
    if (!activeDefinition) return;
    const newStep = createStepFromPalette(type, nodeRegistryMap);
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
    const registryItems = nodeRegistry.map((node) => ({
      id: node.id,
      label: node.ui?.label || node.id,
      description: node.ui?.description || node.id,
      category: node.ui?.category || 'Nodes',
      type: node.id
    }));

    const controlItems = CONTROL_BLOCKS.map((block) => ({
      id: block.id,
      label: block.label,
      description: block.description,
      category: block.category,
      type: block.id
    }));

    const items = [...controlItems, ...registryItems];
    if (!searchTerm) return items;
    return items.filter((item) => item.label.toLowerCase().includes(searchTerm) || item.id.toLowerCase().includes(searchTerm));
  }, [nodeRegistry, search]);

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
                      <div>
                        <div className="text-sm font-medium text-gray-900">{item.label}</div>
                        <div className="text-xs text-gray-500">{item.description}</div>
                      </div>
                      <Button
                        id={`workflow-designer-add-${item.id}`}
                        variant="outline"
                        size="sm"
                        disabled={registryError}
                        onClick={() => handleAddStep(item.type as Step['type'])}
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
  onChange: (step: Step) => void;
}> = ({
  step,
  stepPath,
  errors,
  nodeRegistry,
  actionRegistry,
  fieldOptions,
  payloadSchema,
  onChange
}) => {
  const nodeSchema = step.type.startsWith('control.') ? null : nodeRegistry[step.type]?.configSchema;

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

      {!step.type.startsWith('control.') && (
        <Input
          id={`workflow-step-name-${step.id}`}
          label="Step name"
          value={(step as NodeStep).name ?? ''}
          onChange={(event) => onChange({ ...(step as NodeStep), name: event.target.value })}
        />
      )}

      {step.type === 'control.if' && (() => {
        const ifStep = step as IfBlock;
        return (
          <ExpressionField
            idPrefix={`if-condition-${step.id}`}
            label="Condition"
            value={ensureExpr(ifStep.condition)}
            onChange={(expr) => onChange({ ...ifStep, condition: expr })}
            fieldOptions={fieldOptions}
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
              fieldOptions={fieldOptions}
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
              fieldOptions={fieldOptions}
            />
            <MappingExprEditor
              idPrefix={`call-workflow-output-${step.id}`}
              label="Output mapping"
              value={cwStep.outputMapping ?? {}}
              onChange={(mapping) => onChange({ ...cwStep, outputMapping: mapping })}
              fieldOptions={fieldOptions}
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
          fieldOptions={fieldOptions}
          actionRegistry={actionRegistry}
          stepId={step.id}
        />
      )}

      {payloadSchema && (
        <div className="text-xs text-gray-400">Payload schema: {payloadSchema.title ?? 'payload'}</div>
      )}
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

      {schema.title === 'action.call' && (
        <div className="text-xs text-gray-500">Available actions: {actionRegistry.length}</div>
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

export default WorkflowDesigner;
