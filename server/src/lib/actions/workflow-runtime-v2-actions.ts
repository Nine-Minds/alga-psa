'use server';

import { zodToJsonSchema } from 'zod-to-json-schema';
import { z } from 'zod';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { createTenantKnex } from 'server/src/lib/db';
import { withAuth, hasPermission, getCurrentUser } from '@alga-psa/auth';
import {
  WorkflowRuntimeV2,
  getActionRegistryV2,
  getNodeTypeRegistry,
  getSchemaRegistry,
  initializeWorkflowRuntimeV2,
  applyRedactions,
  validateWorkflowDefinition,
  validateInputMapping,
  resolveInputMapping,
  createSecretResolverFromProvider,
  type PublishError
} from '@shared/workflow/runtime';
import { verifySecretsExist } from '@shared/workflow/runtime/validation/publishValidation';
import { createTenantSecretProvider } from '@alga-psa/shared/workflow/secrets';
import WorkflowDefinitionModelV2 from '@shared/workflow/persistence/workflowDefinitionModelV2';
import WorkflowDefinitionVersionModelV2, { type WorkflowDefinitionVersionRecord } from '@shared/workflow/persistence/workflowDefinitionVersionModelV2';
import WorkflowRunModelV2 from '@shared/workflow/persistence/workflowRunModelV2';
import WorkflowRunStepModelV2 from '@shared/workflow/persistence/workflowRunStepModelV2';
import WorkflowRunSnapshotModelV2 from '@shared/workflow/persistence/workflowRunSnapshotModelV2';
import WorkflowRunWaitModelV2 from '@shared/workflow/persistence/workflowRunWaitModelV2';
import WorkflowActionInvocationModelV2 from '@shared/workflow/persistence/workflowActionInvocationModelV2';
import WorkflowRuntimeEventModelV2 from '@shared/workflow/persistence/workflowRuntimeEventModelV2';
import WorkflowRunLogModelV2 from '@shared/workflow/persistence/workflowRunLogModelV2';
import { auditLog } from 'server/src/lib/logging/auditLog';
import { analytics } from 'server/src/lib/analytics/server';
import { EventCatalogModel } from 'server/src/models/eventCatalog';
import { buildWorkflowPayload } from '@shared/workflow/streams/workflowEventPublishHelpers';
import { exportWorkflowBundleV1ForWorkflowId } from 'server/src/lib/workflow/bundle/exportWorkflowBundleV1';
import { importWorkflowBundleV1 } from 'server/src/lib/workflow/bundle/importWorkflowBundleV1';
import {
  CreateWorkflowDefinitionInput,
  DeleteWorkflowDefinitionInput,
  GetWorkflowDefinitionVersionInput,
  ListWorkflowDefinitionsPagedInput,
  PublishWorkflowDefinitionInput,
  RunIdInput,
  RunActionInput,
  ReplayWorkflowRunInput,
  EventIdInput,
  GetLatestWorkflowRunInput,
  SchemaRefInput,
  ListWorkflowRunsInput,
  ListWorkflowRunSummaryInput,
  ListWorkflowRunLogsInput,
  ListWorkflowAuditLogsInput,
  ListWorkflowEventsInput,
  ListWorkflowEventsPagedInput,
  ListWorkflowDeadLetterInput,
  StartWorkflowRunInput,
  SubmitWorkflowEventInput,
  UpdateWorkflowDefinitionInput,
  UpdateWorkflowDefinitionMetadataInput,
  WorkflowIdInput
} from './workflow-runtime-v2-schemas';

const throwHttpError = (status: number, message: string, details?: unknown): never => {
  const error = new Error(message) as Error & { status?: number; details?: unknown };
  error.status = status;
  if (details) {
    error.details = details;
  }
  throw error;
};

const EXPORT_RUNS_LIMIT = 1000;
const EXPORT_EVENTS_LIMIT = 1000;
const EXPORT_AUDIT_LIMIT = 5000;
const EXPORT_LOGS_LIMIT = 5000;

const csvEscape = (value: unknown) => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const buildCsv = (headers: string[], rows: Array<Array<unknown>>) =>
  [headers.join(','), ...rows.map((row) => row.map(csvEscape).join(','))].join('\n');

const hashDefinition = (definition: Record<string, unknown>) => {
  try {
    return createHash('sha256').update(JSON.stringify(definition)).digest('hex');
  } catch {
    return null;
  }
};

type ValidationStatus = 'valid' | 'warning' | 'error';

const deriveValidationStatus = (errors: PublishError[], warnings: PublishError[]): ValidationStatus => {
  if (errors.length > 0) return 'error';
  if (warnings.length > 0) return 'warning';
  return 'valid';
};

const buildUnknownPayloadSchemaRefError = (schemaRef: string, suggestions: string[]): PublishError => ({
  severity: 'error',
  stepPath: 'root',
  code: 'UNKNOWN_PAYLOAD_SCHEMA_REF',
  message: suggestions.length
    ? `Unknown payload schema ref "${schemaRef}". Did you mean: ${suggestions.join(', ')}?`
    : `Unknown payload schema ref "${schemaRef}".`
});

const buildUnknownTriggerSourceSchemaRefError = (eventName: string): PublishError => ({
  severity: 'error',
  stepPath: 'root.trigger',
  code: 'UNKNOWN_TRIGGER_SOURCE_SCHEMA_REF',
  message: `Unknown trigger source schema ref for event "${eventName}". Set trigger.sourcePayloadSchemaRef or register payload_schema_ref in the event catalog.`
});

const buildTriggerMappingRequiredError = (eventName: string, sourceRef: string, payloadRef: string): PublishError => ({
  severity: 'error',
  stepPath: 'root.trigger.payloadMapping',
  code: 'TRIGGER_MAPPING_REQUIRED',
  message: `Trigger mapping is required for "${eventName}" because source schema "${sourceRef}" differs from workflow payload schema "${payloadRef}".`
});

const buildTriggerMappingPayloadRootError = (expr: string, path: string): PublishError => ({
  severity: 'error',
  stepPath: `root.trigger.payloadMapping${path}`,
  code: 'TRIGGER_MAPPING_INVALID_ROOT',
  message: `Trigger mapping expressions must use "event.payload" (not "payload"): ${expr}`
});

const resolveJsonSchemaRef = (schema: any, root: any): any => {
  if (!schema || typeof schema !== 'object') return schema;
  if (schema.$ref && typeof schema.$ref === 'string' && schema.$ref.startsWith('#/')) {
    const parts = schema.$ref.slice(2).split('/');
    let cursor: any = root;
    for (const part of parts) {
      if (!cursor || typeof cursor !== 'object') return schema;
      cursor = cursor[part];
    }
    return cursor ?? schema;
  }
  return schema;
};

const collectRequiredPathsFromJsonSchema = (schema: any, root: any, prefix = ''): string[] => {
  const resolved = resolveJsonSchemaRef(schema, root);
  if (!resolved || typeof resolved !== 'object') return [];

  const list: string[] = [];

  const maybeAllOf = Array.isArray(resolved.allOf) ? resolved.allOf : null;
  if (maybeAllOf) {
    for (const entry of maybeAllOf) {
      list.push(...collectRequiredPathsFromJsonSchema(entry, root, prefix));
    }
    return Array.from(new Set(list));
  }

  const type = Array.isArray(resolved.type)
    ? (resolved.type.includes('object') ? 'object' : resolved.type[0])
    : resolved.type;

  if (type !== 'object' || !resolved.properties || typeof resolved.properties !== 'object') {
    return [];
  }

  const required = Array.isArray(resolved.required) ? resolved.required.filter((v: any) => typeof v === 'string') : [];
  for (const prop of required) {
    const nextPrefix = prefix ? `${prefix}.${prop}` : prop;
    list.push(nextPrefix);
    const propSchema = resolved.properties[prop];
    list.push(...collectRequiredPathsFromJsonSchema(propSchema, root, nextPrefix));
  }

  return Array.from(new Set(list));
};

const collectTriggerMappingExprPaths = (value: any, jsonPointerPath = ''): Array<{ expr: string; path: string }> => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, idx) => collectTriggerMappingExprPaths(item, `${jsonPointerPath}/${idx}`));
  }
  if (typeof value !== 'object') return [];

  if ('$expr' in value && typeof (value as any).$expr === 'string') {
    return [{ expr: String((value as any).$expr), path: jsonPointerPath }];
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    collectTriggerMappingExprPaths(child, `${jsonPointerPath}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`)
  );
};

const mappingSatisfiesRequiredPaths = (mapping: any, requiredPaths: string[]): boolean => {
  if (!mapping || typeof mapping !== 'object') return false;

  const mappedPaths = new Set<string>();

  const addPathWithPrefixes = (path: string) => {
    if (!path) return;
    const parts = path.split('.').filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      const prefix = parts.slice(0, i + 1).join('.');
      mappedPaths.add(prefix);
    }
  };

  const visit = (node: any, prefix = '') => {
    if (node === null || node === undefined) return;
    if (typeof node !== 'object' || Array.isArray(node)) {
      if (prefix) addPathWithPrefixes(prefix);
      return;
    }

    if ('$expr' in node || '$secret' in node) {
      if (prefix) addPathWithPrefixes(prefix);
      return;
    }

    const entries = Object.entries(node as Record<string, unknown>);
    if (entries.length === 0) {
      if (prefix) addPathWithPrefixes(prefix);
      return;
    }

    for (const [key, child] of entries) {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      visit(child, nextPrefix);
    }
  };

  visit(mapping, '');

  const mapped = Array.from(mappedPaths);
  return requiredPaths.every((req) => {
    return mapped.some((path) => path === req || (req.startsWith(path) && req.charAt(path.length) === '.'));
  });
};

const listSecretNames = async (knex: Awaited<ReturnType<typeof createTenantKnex>>['knex'], tenant?: string | null): Promise<Set<string> | null> => {
  if (!tenant) return null;
  const provider = createTenantSecretProvider(knex, tenant);
  const secrets = await provider.list();
  return new Set(secrets.map((secret: { name: string }) => secret.name));
};

const stableJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!value || typeof value !== 'object') return value;
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = stableJson(obj[key]);
  }
  return out;
};

const stableStringify = (value: unknown): string => JSON.stringify(stableJson(value));

const computeValidation = async (params: {
  definition: Record<string, unknown>;
  payloadSchemaRef?: string | null;
  payloadSchemaJson?: Record<string, unknown> | null;
  knex: Awaited<ReturnType<typeof createTenantKnex>>['knex'];
  tenant?: string | null;
}) => {
  const { definition, payloadSchemaRef, payloadSchemaJson, knex, tenant } = params;
  const validation = validateWorkflowDefinition(
    definition as any,
    payloadSchemaJson ?? undefined
  );

  const errors = [...validation.errors];
  const warnings = [...validation.warnings];

  if (!payloadSchemaRef || !String(payloadSchemaRef).trim()) {
    errors.push({
      severity: 'error',
      stepPath: 'root.payloadSchemaRef',
      code: 'PAYLOAD_SCHEMA_REF_MISSING',
      message: 'Workflow payload schema ref is required before publishing or running.'
    });
  } else if (!payloadSchemaJson) {
    errors.push({
      severity: 'error',
      stepPath: 'root.payloadSchemaRef',
      code: 'PAYLOAD_SCHEMA_REF_UNKNOWN',
      message: `Workflow payload schema ref "${String(payloadSchemaRef)}" is not present in the schema registry.`
    });
  }

  const payloadSchemaHash =
    payloadSchemaJson
      ? createHash('sha256').update(stableStringify(payloadSchemaJson)).digest('hex')
      : null;
  let triggerSourceSchemaRef: string | null = null;
  let triggerSchemaRefStatus: 'known' | 'missing' | 'unknown' = 'missing';

  const normalizeTypes = (schema: any): Set<string> => {
    if (!schema || typeof schema !== 'object') return new Set(['unknown']);
    const typeVal = schema.type;
    const base = new Set<string>();
    const add = (t: unknown) => {
      if (typeof t !== 'string') return;
      if (t === 'integer') base.add('number');
      else base.add(t);
    };
    if (Array.isArray(typeVal)) typeVal.forEach(add);
    else add(typeVal);
    if (schema.anyOf && Array.isArray(schema.anyOf)) {
      // Prefer the non-null option, but keep null if present.
      schema.anyOf.forEach((s: any) => {
        const t = normalizeTypes(s);
        t.forEach((x) => base.add(x));
      });
    }
    if (base.size === 0) base.add('unknown');
    return base;
  };

  const resolveSchemaAtPath = (schema: any, path: string[]): any | null => {
    if (!schema || typeof schema !== 'object') return null;
    let current: any = schema;
    for (const seg of path) {
      if (!current) return null;
      // Handle anyOf (nullable)
      if (current.anyOf && Array.isArray(current.anyOf)) {
        const nonNull = current.anyOf.find((s: any) => s && s.type !== 'null') ?? current.anyOf[0];
        current = nonNull;
      }
      if (current.$ref && schema.definitions && typeof current.$ref === 'string') {
        const key = current.$ref.replace('#/definitions/', '');
        current = schema.definitions[key] ?? current;
      }
      if (current.type === 'object' && current.properties && typeof current.properties === 'object') {
        current = (current.properties as any)[seg] ?? null;
        continue;
      }
      if (current.type === 'array' && current.items) {
        // Only support `.items.<prop>` lookup if seg is 'items'
        if (seg === 'items') {
          current = current.items;
          continue;
        }
        // Unknown array access
        return null;
      }
      return null;
    }
    return current;
  };

  const literalTypes = (value: unknown): Set<string> => {
    if (value === null) return new Set(['null']);
    if (Array.isArray(value)) return new Set(['array']);
    switch (typeof value) {
      case 'string':
        return new Set(['string']);
      case 'number':
        return new Set(['number']);
      case 'boolean':
        return new Set(['boolean']);
      case 'object':
        return new Set(['object']);
      default:
        return new Set(['unknown']);
    }
  };

  const exprPathToSchemaTypes = (expr: string, ctx: { payload?: any | null; eventPayload?: any | null; vars?: Map<string, any> }): Set<string> => {
    const trimmed = String(expr ?? '').trim();
    if (!trimmed) return new Set(['unknown']);

    const pathFor = (prefix: string) => trimmed.startsWith(prefix) ? trimmed.slice(prefix.length).split('.').filter(Boolean) : null;

    // event.payload.<...>
    const eventPath = pathFor('event.payload.');
    if (eventPath && ctx.eventPayload) {
      const schema = resolveSchemaAtPath(ctx.eventPayload, eventPath);
      return schema ? normalizeTypes(schema) : new Set(['unknown']);
    }

    // payload.<...>
    const payloadPath = pathFor('payload.');
    if (payloadPath && ctx.payload) {
      const schema = resolveSchemaAtPath(ctx.payload, payloadPath);
      return schema ? normalizeTypes(schema) : new Set(['unknown']);
    }

    // vars.<saveAs>.<...>
    if (trimmed.startsWith('vars.')) {
      const rest = trimmed.slice('vars.'.length);
      const [saveAs, ...sub] = rest.split('.').filter(Boolean);
      if (!saveAs) return new Set(['unknown']);
      const baseSchema = ctx.vars?.get(saveAs) ?? null;
      if (!baseSchema) return new Set(['unknown']);
      if (sub.length === 0) return normalizeTypes(baseSchema);
      const schema = resolveSchemaAtPath(baseSchema, sub);
      return schema ? normalizeTypes(schema) : new Set(['unknown']);
    }

    // meta.* and secrets/env are treated as unknown for now.
    return new Set(['unknown']);
  };

  const isCompatible = (expected: Set<string>, actual: Set<string>): { ok: boolean; known: boolean } => {
    const expectedKnown = !(expected.size === 1 && expected.has('unknown'));
    const actualKnown = !(actual.size === 1 && actual.has('unknown'));
    const known = expectedKnown && actualKnown;
    if (!known) return { ok: true, known: false };
    // Nullability: if expected includes null, allow actual null; otherwise normal check.
    for (const a of actual) {
      if (expected.has(a)) return { ok: true, known: true };
      // allow number into integer already normalized
    }
    // expected "object" should accept "array"? no.
    return { ok: false, known: true };
  };

  const validateMappingTypesAgainstSchema = (params: {
    mapping: any;
    targetSchema: any;
    options: { stepPath: string; stepId: string; fieldName: string };
    ctx: { payload?: any | null; eventPayload?: any | null; vars?: Map<string, any> };
  }): void => {
    const { mapping, targetSchema, options, ctx } = params;
    if (!mapping || typeof mapping !== 'object') return;
    if (!targetSchema || typeof targetSchema !== 'object') return;

    for (const [field, value] of Object.entries(mapping as Record<string, unknown>)) {
      const targetFieldSchema = resolveSchemaAtPath(targetSchema, [field]);
      if (!targetFieldSchema) continue;
      const expected = normalizeTypes(targetFieldSchema);

      let actual: Set<string>;
      if (value && typeof value === 'object' && '$expr' in (value as any)) {
        actual = exprPathToSchemaTypes(String((value as any).$expr ?? ''), ctx);
      } else if (value && typeof value === 'object' && '$secret' in (value as any)) {
        actual = new Set(['string']);
      } else {
        actual = literalTypes(value);
      }

      const compat = isCompatible(expected, actual);
      if (!compat.ok && compat.known) {
        errors.push({
          severity: 'error',
          stepPath: options.stepPath,
          stepId: options.stepId,
          code: 'MAPPING_TYPE_INCOMPATIBLE',
          message: `Type "${Array.from(actual).join('|')}" is incompatible with expected "${Array.from(expected).join('|')}" for "${options.fieldName}.${field}".`
        });
      } else if (!compat.known && (expected.size === 1 && !expected.has('unknown'))) {
        warnings.push({
          severity: 'warning',
          stepPath: options.stepPath,
          stepId: options.stepId,
          code: 'MAPPING_TYPE_UNKNOWN',
          message: `Could not determine a type for "${options.fieldName}.${field}" to validate against expected "${Array.from(expected).join('|')}".`
        });
      }
    }
  };

  const trigger = (definition as any)?.trigger;
  const isEventTrigger = trigger?.type === 'event' && typeof trigger?.eventName === 'string' && trigger.eventName.length > 0;
  if (isEventTrigger) {
    const eventName = String(trigger.eventName);
    const schemaRegistry = getSchemaRegistry();
    const overrideSource = typeof trigger?.sourcePayloadSchemaRef === 'string' && trigger.sourcePayloadSchemaRef.trim()
      ? String(trigger.sourcePayloadSchemaRef).trim()
      : null;
    const catalog = tenant ? await EventCatalogModel.getByEventType(knex, eventName, tenant) : null;
    const catalogRef = typeof (catalog as any)?.payload_schema_ref === 'string' ? String((catalog as any).payload_schema_ref) : null;
    const sourceRef = overrideSource ?? catalogRef;
    const sourceSchemaJson = sourceRef && schemaRegistry.has(sourceRef) ? (schemaRegistry.toJsonSchema(sourceRef) as any) : null;
    triggerSourceSchemaRef = sourceRef ?? null;
    if (!sourceRef) triggerSchemaRefStatus = 'missing';
    else triggerSchemaRefStatus = schemaRegistry.has(sourceRef) ? 'known' : 'unknown';

    if (!sourceRef || !schemaRegistry.has(sourceRef)) {
      errors.push(buildUnknownTriggerSourceSchemaRefError(eventName));
    }

    const mapping = trigger?.payloadMapping;
    const mappingProvided = mapping && typeof mapping === 'object' && Object.keys(mapping).length > 0;
    const refsMatch = !!payloadSchemaRef && !!sourceRef && sourceRef === payloadSchemaRef;

    if (!refsMatch && !mappingProvided && sourceRef) {
      errors.push(buildTriggerMappingRequiredError(eventName, sourceRef, String(payloadSchemaRef ?? '')));
    }

    if (mappingProvided) {
      // Validate mapping expressions + secret refs using existing mapping validator.
      const mappingValidation = validateInputMapping(mapping as any, {
        stepPath: 'root.trigger.payloadMapping',
        stepId: 'trigger',
        fieldName: 'payloadMapping'
      });
      errors.push(...mappingValidation.errors);
      warnings.push(...mappingValidation.warnings);
      mappingValidation.secretRefs.forEach((ref) => validation.secretRefs.add(ref));

      // Enforce trigger mapping root: event.payload only (no payload alias).
      for (const item of collectTriggerMappingExprPaths(mapping)) {
        const expr = item.expr ?? '';
        if (/(^|[^A-Za-z0-9_$.])payload\./.test(expr)) {
          errors.push(buildTriggerMappingPayloadRootError(expr, item.path));
        }
      }

      // Deep nested required field validation against workflow payload schema.
      if (payloadSchemaJson) {
        const requiredPaths = collectRequiredPathsFromJsonSchema(payloadSchemaJson, payloadSchemaJson);
        if (requiredPaths.length > 0) {
          const ok = mappingSatisfiesRequiredPaths(mapping, requiredPaths);
          if (!ok) {
            errors.push({
              severity: 'error',
              stepPath: 'root.trigger.payloadMapping',
              code: 'TRIGGER_MAPPING_MISSING_REQUIRED_FIELDS',
              message: 'Trigger mapping does not provide values for all required fields in the workflow payload schema.'
            });
          }
        }
      }

      // Type compatibility (best-effort): compare mapping value types to workflow payload schema types.
      if (payloadSchemaJson && sourceSchemaJson) {
        validateMappingTypesAgainstSchema({
          mapping,
          targetSchema: payloadSchemaJson,
          options: { stepPath: 'root.trigger.payloadMapping', stepId: 'trigger', fieldName: 'payloadMapping' },
          ctx: { eventPayload: sourceSchemaJson, payload: payloadSchemaJson, vars: new Map() }
        });
      }
    }
  }

  // Type compatibility for action.call input mappings (best-effort)
  try {
    const registry = getActionRegistryV2();
    const steps = (definition as any)?.steps;
    if (Array.isArray(steps)) {
      const varsSchemas = new Map<string, any>();

      const walk = (list: any[]): void => {
        for (const step of list) {
          if (!step || typeof step !== 'object') continue;
          if (step.type === 'control.if') {
            walk(Array.isArray(step.then) ? step.then : []);
            if (Array.isArray(step.else)) walk(step.else);
            continue;
          }
          if (step.type === 'control.tryCatch') {
            walk(Array.isArray(step.try) ? step.try : []);
            walk(Array.isArray(step.catch) ? step.catch : []);
            continue;
          }
          if (step.type === 'control.forEach') {
            walk(Array.isArray(step.body) ? step.body : []);
            continue;
          }

          const cfg = (step as any).config ?? null;
          const saveAs = typeof cfg?.saveAs === 'string' ? cfg.saveAs : null;
          const actionId = step.type === 'action.call' ? (typeof cfg?.actionId === 'string' ? cfg.actionId : null) : null;
          const actionVersion = typeof cfg?.version === 'number' ? cfg.version : undefined;

          // Validate action.call inputMapping
          if (step.type === 'action.call' && actionId) {
            const defn = registry.get(actionId, actionVersion ?? 1);
            const inputSchemaJson = defn?.inputSchema ? (zodToJsonSchema(defn.inputSchema, { name: `${actionId}@${actionVersion ?? 1}.input` }) as any) : null;
            const inputMapping = cfg?.inputMapping ?? null;
            if (inputSchemaJson && inputMapping && typeof inputMapping === 'object') {
              validateMappingTypesAgainstSchema({
                mapping: inputMapping,
                targetSchema: inputSchemaJson,
                options: { stepPath: `root.steps.${String(step.id)}.config.inputMapping`, stepId: String(step.id), fieldName: 'inputMapping' },
                ctx: { payload: payloadSchemaJson, vars: varsSchemas, eventPayload: null }
              });
            }
          }

          // Track outputs for vars.* typing
          if (saveAs) {
            if (step.type === 'action.call' && actionId) {
              const defn = registry.get(actionId, actionVersion ?? 1);
              const out = defn?.outputSchema ? (zodToJsonSchema(defn.outputSchema, { name: `${actionId}@${actionVersion ?? 1}.output` }) as any) : null;
              if (out) varsSchemas.set(saveAs, out);
            }
          }
        }
      };

      walk(steps);
    }
  } catch {
    // best-effort; do not break validation
  }

  if (!payloadSchemaJson && payloadSchemaRef) {
    const registry = getSchemaRegistry();
    const refs = registry.listRefs();
    const queryLower = payloadSchemaRef.toLowerCase();
    const suggestions = refs
      .filter((ref) => ref.toLowerCase().includes(queryLower) || ref.toLowerCase().endsWith(queryLower))
      .slice(0, 5);
    errors.push(buildUnknownPayloadSchemaRefError(payloadSchemaRef, suggestions));
  }

  if (validation.secretRefs.size > 0) {
    const knownSecrets = await listSecretNames(knex, tenant);
    if (knownSecrets) {
      const secretErrors = verifySecretsExist(validation.secretRefs, knownSecrets);
      errors.push(...secretErrors);
    }
  }

  const status = deriveValidationStatus(errors, warnings);
  return {
    ...validation,
    errors,
    warnings,
    status,
    payloadSchemaHash,
    contextJson: {
      payloadSchemaRef: payloadSchemaRef ?? null,
      payloadSchemaHash,
      triggerSourceSchemaRef,
      triggerSchemaRefStatus
    } as Record<string, unknown>
  };
};

const SENSITIVE_KEY_PATTERN = /(secret|token|password|api[_-]?key|authorization)/i;

const WORKFLOW_RUN_RATE_LIMIT_POINTS = Number(process.env.WORKFLOW_RUN_RATE_LIMIT_POINTS ?? 60);
const WORKFLOW_RUN_RATE_LIMIT_DURATION = Number(process.env.WORKFLOW_RUN_RATE_LIMIT_DURATION ?? 60);
const DEFAULT_WORKFLOW_RUN_PAYLOAD_BYTES = 512 * 1024;
const WORKFLOW_RUN_PAYLOAD_MAX_BYTES = Number(process.env.WORKFLOW_RUN_PAYLOAD_MAX_BYTES ?? DEFAULT_WORKFLOW_RUN_PAYLOAD_BYTES);
const WORKFLOW_RUN_PAYLOAD_LIMIT = Number.isFinite(WORKFLOW_RUN_PAYLOAD_MAX_BYTES)
  ? WORKFLOW_RUN_PAYLOAD_MAX_BYTES
  : DEFAULT_WORKFLOW_RUN_PAYLOAD_BYTES;

const workflowRunStartLimiter = new RateLimiterMemory({
  points: Number.isFinite(WORKFLOW_RUN_RATE_LIMIT_POINTS) ? WORKFLOW_RUN_RATE_LIMIT_POINTS : 60,
  duration: Number.isFinite(WORKFLOW_RUN_RATE_LIMIT_DURATION) ? WORKFLOW_RUN_RATE_LIMIT_DURATION : 60
});

const measurePayloadBytes = (payload: unknown) => {
  try {
    const serialized = JSON.stringify(payload ?? {});
    return Buffer.byteLength(serialized, 'utf8');
  } catch {
    return null;
  }
};

const expandDottedKeys = (input: Record<string, unknown>): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!key.includes('.')) {
      result[key] = value;
      continue;
    }
    const parts = key.split('.').filter(Boolean);
    if (parts.length === 0) continue;
    let cursor: Record<string, unknown> = result;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const isLeaf = i === parts.length - 1;
      if (isLeaf) {
        cursor[part] = value;
        continue;
      }
      const existing = cursor[part];
      if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
        cursor = existing as Record<string, unknown>;
        continue;
      }
      const next: Record<string, unknown> = {};
      cursor[part] = next;
      cursor = next;
    }
  }
  return result;
};

const redactSensitiveValues = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitiveValues(entry));
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, val]) => {
      if (key === 'secretRef' || SENSITIVE_KEY_PATTERN.test(key)) {
        return [key, '***'];
      }
      return [key, redactSensitiveValues(val)];
    });
    return Object.fromEntries(entries);
  }
  return value;
};

type AuthUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

const requireUser = async () => {
  const user = await getCurrentUser();
  if (!user) {
    throwHttpError(401, 'Unauthorized');
  }
  return user!;
};

type TenantRedactionConfig = {
  pointerRedactions: string[];
  keyPatterns: RegExp[];
};

const REDACTED_VALUE = '[REDACTED]';

const compileKeyPatterns = (patterns: string[]): RegExp[] => {
  const compiled: RegExp[] = [];
  patterns.forEach((pattern) => {
    if (!pattern) return;
    try {
      if (pattern.startsWith('/') && pattern.endsWith('/') && pattern.length > 2) {
        compiled.push(new RegExp(pattern.slice(1, -1), 'i'));
      } else {
        compiled.push(new RegExp(pattern, 'i'));
      }
    } catch {
      // ignore invalid patterns
    }
  });
  return compiled;
};

const loadTenantRedactionConfig = async (
  knex: Awaited<ReturnType<typeof createTenantKnex>>['knex'],
  tenant?: string | null
): Promise<TenantRedactionConfig> => {
  if (!tenant) {
    return { pointerRedactions: [], keyPatterns: [] };
  }
  try {
    const row = await knex('tenant_settings').select('settings').where({ tenant }).first();
    const settings = (row?.settings ?? {}) as any;
    const cfg = settings?.workflowRunStudio ?? {};
    const pointerRedactions = Array.isArray(cfg?.redactionPointers) ? cfg.redactionPointers.filter((v: any) => typeof v === 'string') : [];
    const keyPatternStrings = Array.isArray(cfg?.redactionKeyPatterns) ? cfg.redactionKeyPatterns.filter((v: any) => typeof v === 'string') : [];
    return {
      pointerRedactions,
      keyPatterns: compileKeyPatterns(keyPatternStrings)
    };
  } catch {
    return { pointerRedactions: [], keyPatterns: [] };
  }
};

const maskSensitiveKeysByPattern = (value: unknown, patterns: RegExp[]): unknown => {
  if (!value) return value;
  if (Array.isArray(value)) {
    return value.map((entry) => maskSensitiveKeysByPattern(entry, patterns));
  }
  if (typeof value !== 'object') return value;
  const obj = value as Record<string, unknown>;
  if ('$secret' in obj && typeof (obj as any).$secret === 'string') {
    return value;
  }
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (key === 'secretRef') {
      result[key] = val;
      continue;
    }
    if (SENSITIVE_KEY_PATTERN.test(key) || patterns.some((pattern) => pattern.test(key))) {
      result[key] = REDACTED_VALUE;
      continue;
    }
    result[key] = maskSensitiveKeysByPattern(val, patterns);
  }
  return result;
};

const applyRunStudioRedactions = (value: unknown, cfg: TenantRedactionConfig): unknown => {
  const withKeyMask = maskSensitiveKeysByPattern(value, cfg.keyPatterns);
  if (!cfg.pointerRedactions.length) return withKeyMask;
  return applyRedactions(withKeyMask, cfg.pointerRedactions);
};

const requireRunTenantAccess = async (
  knex: Awaited<ReturnType<typeof createTenantKnex>>['knex'],
  runId: string,
  tenant?: string | null
) => {
  const run = await WorkflowRunModelV2.getById(knex, runId);
  if (!run) {
    return throwHttpError(404, 'Not found');
  }
  if (tenant) {
    if (!run.tenant_id || run.tenant_id !== tenant) {
      return throwHttpError(404, 'Not found');
    }
  }
  return run;
};

const requireWorkflowPermission = async (
  user: AuthUser,
  action: 'read' | 'manage' | 'publish' | 'admin',
  knex?: Awaited<ReturnType<typeof createTenantKnex>>['knex']
) => {
  const allowed = await hasPermission(user, 'workflow', action, knex);
  if (allowed) return;
  if (action === 'read') {
    const viewAllowed = await hasPermission(user, 'workflow', 'view', knex);
    if (viewAllowed) return;
    const manageAllowed = await hasPermission(user, 'workflow', 'manage', knex);
    if (manageAllowed) return;
    const adminAllowed = await hasPermission(user, 'workflow', 'admin', knex);
    if (adminAllowed) return;
  }
  if (action === 'manage') {
    const adminAllowed = await hasPermission(user, 'workflow', 'admin', knex);
    if (adminAllowed) return;
  }
  if (action === 'publish') {
    const adminAllowed = await hasPermission(user, 'workflow', 'admin', knex);
    if (adminAllowed) return;
  }
  throwHttpError(403, 'Forbidden');
};

const auditWorkflowEvent = async (
  knex: Awaited<ReturnType<typeof createTenantKnex>>['knex'],
  user: AuthUser,
  params: {
    operation: string;
    tableName: 'workflow_definitions' | 'workflow_runs';
    recordId: string;
    changedData?: Record<string, unknown>;
    details?: Record<string, unknown>;
    source?: string | null;
  }
) => {
  const roleNames = user.roles?.map((role) => role.role_name) ?? [];
  await auditLog(knex, {
    userId: user.user_id,
    operation: params.operation,
    tableName: params.tableName,
    recordId: params.recordId,
    changedData: params.changedData ?? {},
    details: {
      ...params.details,
      actorRoles: roleNames,
      source: params.source ?? 'api'
    }
  });
};

export const listWorkflowDefinitionsAction = withAuth(async (user, { tenant }) => {
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);
  const records = await WorkflowDefinitionModelV2.list(knex);
  const workflowIds = records.map((record) => record.workflow_id);
  const publishedVersionMap = new Map<string, number | null>();
  if (workflowIds.length) {
    const rows = await knex('workflow_definition_versions')
      .select('workflow_id')
      .max('version as published_version')
      .whereIn('workflow_id', workflowIds)
      .groupBy('workflow_id') as Array<{ workflow_id: string; published_version: number | string | null }>;
    rows.forEach((row) => {
      const value = row.published_version == null ? null : Number(row.published_version);
      publishedVersionMap.set(row.workflow_id, Number.isNaN(value as number) ? null : value);
    });
  }

  const enrichedRecords = records.map((record) => ({
    ...record,
    published_version: publishedVersionMap.get(record.workflow_id) ?? null
  }));
  const canAdmin = await hasPermission(user, 'workflow', 'admin', knex);
  if (canAdmin) {
    return enrichedRecords;
  }
  return enrichedRecords.filter((record) => record.is_visible !== false);
});

export const listWorkflowDefinitionsPagedAction = withAuth(async (user, { tenant }, input: unknown) => {
  const parsed = ListWorkflowDefinitionsPagedInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);

  const canAdmin = await hasPermission(user, 'workflow', 'admin', knex);

  const pageSize = parsed.pageSize;
  const page = parsed.page;
  const offset = (page - 1) * pageSize;

  const search = typeof parsed.search === 'string' ? parsed.search.trim() : '';
  const status = parsed.status ?? 'all';
  const trigger = parsed.trigger ?? 'all';
  const sortBy = parsed.sortBy ?? 'updated_at';
  const sortDirection = parsed.sortDirection ?? 'desc';

  const applyVisibilityFilter = (qb: any) => {
    if (!canAdmin) {
      qb.whereRaw('coalesce(wd.is_visible, true) = true');
    }
  };

  const applyFilters = (qb: any) => {
    applyVisibilityFilter(qb);

    if (search) {
      qb.andWhere(function whereSearch(this: any) {
        this.whereRaw('wd.name ilike ?', [`%${search}%`]).orWhereRaw('wd.description ilike ?', [`%${search}%`]);
      });
    }

    if (status !== 'all') {
      if (status === 'paused') {
        qb.andWhereRaw('coalesce(wd.is_paused, false) = true');
      } else if (status === 'active') {
        qb.andWhereIn('wd.status', ['active', 'published']).andWhereRaw('coalesce(wd.is_paused, false) = false');
      } else if (status === 'draft') {
        qb.andWhere('wd.status', 'draft').andWhereRaw('coalesce(wd.is_paused, false) = false');
      }
    }

    if (trigger !== 'all') {
      const eventNameExpr = "coalesce(wd.trigger->>'eventName', '')";
      const scheduledExpr = `lower(${eventNameExpr}) like '%schedule%' or lower(${eventNameExpr}) like '%cron%'`;
      if (trigger === 'manual') {
        qb.andWhereRaw(`${eventNameExpr} = ''`);
      } else if (trigger === 'scheduled') {
        qb.andWhereRaw(`${eventNameExpr} <> '' and (${scheduledExpr})`);
      } else if (trigger === 'event') {
        qb.andWhereRaw(`${eventNameExpr} <> '' and not (${scheduledExpr})`);
      }
    }
  };

  const countQuery = knex('workflow_definitions as wd');
  applyFilters(countQuery);
  const countRow = await countQuery.count<{ count: number | string }[]>({ count: '*' }).first();
  const totalItems = countRow?.count == null ? 0 : Number(countRow.count);

  const versionsSubquery = knex('workflow_definition_versions')
    .select('workflow_id')
    .max('version as published_version')
    .groupBy('workflow_id')
    .as('pv');

  const itemsQuery = knex('workflow_definitions as wd')
    .select('wd.*')
    .select(knex.raw('pv.published_version as published_version'))
    .leftJoin(versionsSubquery, 'pv.workflow_id', 'wd.workflow_id');

  applyFilters(itemsQuery);

  if (sortBy === 'name') {
    itemsQuery.orderByRaw(`lower(wd.name) ${sortDirection}`);
  } else if (sortBy === 'created_at') {
    itemsQuery.orderBy('wd.created_at', sortDirection);
  } else if (sortBy === 'status') {
    itemsQuery.orderByRaw(
      `case
        when coalesce(wd.is_paused, false) then 'paused'
        when wd.status in ('active', 'published') then 'active'
        else coalesce(wd.status, '')
      end ${sortDirection}`
    );
  } else {
    itemsQuery.orderBy('wd.updated_at', sortDirection);
  }
  itemsQuery.orderBy('wd.workflow_id', 'asc');

  const rows = await itemsQuery.limit(pageSize).offset(offset);
  const items = (rows as any[]).map((row) => ({
    ...row,
    published_version: row.published_version == null ? null : Number(row.published_version)
  }));

  // Aggregate counts (unfiltered, but respecting visibility rules).
  const countBase = knex('workflow_definitions as wd');
  applyVisibilityFilter(countBase);

  const totalRow = await countBase.clone().count<{ count: number | string }[]>({ count: '*' }).first();
  const activeRow = await countBase.clone()
    .whereIn('wd.status', ['active', 'published'])
    .andWhereRaw('coalesce(wd.is_paused, false) = false')
    .count<{ count: number | string }[]>({ count: '*' })
    .first();
  const draftRow = await countBase.clone()
    .where('wd.status', 'draft')
    .andWhereRaw('coalesce(wd.is_paused, false) = false')
    .count<{ count: number | string }[]>({ count: '*' })
    .first();
  const pausedRow = await countBase.clone()
    .whereRaw('coalesce(wd.is_paused, false) = true')
    .count<{ count: number | string }[]>({ count: '*' })
    .first();

  return {
    items,
    totalItems,
    counts: {
      total: totalRow?.count == null ? 0 : Number(totalRow.count),
      active: activeRow?.count == null ? 0 : Number(activeRow.count),
      draft: draftRow?.count == null ? 0 : Number(draftRow.count),
      paused: pausedRow?.count == null ? 0 : Number(pausedRow.count)
    }
  };
});

export const listWorkflowDefinitionVersionsAction = withAuth(async (user, { tenant }, input: unknown) => {
  const parsed = WorkflowIdInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);

  const rows = await knex('workflow_definition_versions')
    .select('version', 'published_at', 'created_at')
    .where({ workflow_id: parsed.workflowId })
    .orderBy('version', 'desc');

  return { versions: rows };
});

export const exportWorkflowBundleV1Action = withAuth(async (user, { tenant }, input: unknown) => {
  const parsed = WorkflowIdInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'admin', knex);
  return exportWorkflowBundleV1ForWorkflowId(knex, parsed.workflowId);
});

export const importWorkflowBundleV1Action = withAuth(async (user, { tenant }, input: unknown) => {
  const parsed = z.object({ bundle: z.unknown(), force: z.boolean().optional() }).parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'admin', knex);
  return importWorkflowBundleV1(knex, parsed.bundle, { force: parsed.force, actorUserId: user.user_id });
});

export const createWorkflowDefinitionAction = withAuth(async (user, { tenant }, input: unknown) => {
  initializeWorkflowRuntimeV2();
  const parsed = CreateWorkflowDefinitionInput.parse(input);

  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'manage', knex);
  const workflowId = uuidv4();
  const definition = { ...parsed.definition, id: workflowId };
  const payloadSchemaMode = parsed.payloadSchemaMode ?? 'pinned';
  const pinnedPayloadSchemaRef = parsed.pinnedPayloadSchemaRef ?? null;
  const payloadSchemaProvenance = payloadSchemaMode === 'pinned' ? 'pinned' : 'inferred';

  const schemaRegistry = getSchemaRegistry();
  const payloadSchemaJson = definition.payloadSchemaRef && schemaRegistry.has(definition.payloadSchemaRef)
    ? schemaRegistry.toJsonSchema(definition.payloadSchemaRef)
    : null;
  const validation = await computeValidation({
    definition,
    payloadSchemaRef: definition.payloadSchemaRef,
    payloadSchemaJson,
    knex,
    tenant
  });

  const record = await WorkflowDefinitionModelV2.create(knex, {
    workflow_id: workflowId,
    key: parsed.key?.trim() ?? null,
    name: definition.name,
    description: definition.description ?? null,
    payload_schema_ref: definition.payloadSchemaRef,
    payload_schema_mode: payloadSchemaMode,
    pinned_payload_schema_ref: pinnedPayloadSchemaRef,
    payload_schema_provenance: payloadSchemaProvenance,
    trigger: definition.trigger ?? null,
    draft_definition: definition,
    draft_version: definition.version,
    status: 'draft',
    validation_status: validation.status,
    validation_errors: validation.errors,
    validation_warnings: validation.warnings,
    validation_context_json: (validation as any).contextJson ?? null,
    validation_payload_schema_hash: (validation as any).payloadSchemaHash ?? null,
    validated_at: new Date().toISOString(),
    created_by: user.user_id,
    updated_by: user.user_id
  });

  await auditWorkflowEvent(knex, user, {
    operation: 'workflow_definition_create',
    tableName: 'workflow_definitions',
    recordId: record.workflow_id,
    changedData: {
      name: definition.name,
      payloadSchemaRef: definition.payloadSchemaRef,
      status: 'draft'
    },
    details: {
      draftVersion: definition.version,
      trigger: definition.trigger ?? null,
      definitionHash: hashDefinition(definition as Record<string, unknown>)
    },
    source: 'api'
  });

  return { workflowId: record.workflow_id };
});

export const getWorkflowDefinitionVersionAction = withAuth(async (user, { tenant }, input: unknown) => {
  const parsed = GetWorkflowDefinitionVersionInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);
  const record = await WorkflowDefinitionVersionModelV2.getByWorkflowAndVersion(
    knex,
    parsed.workflowId,
    parsed.version
  );
  if (!record) {
    return throwHttpError(404, 'Not found');
  }
  return record;
});

export const updateWorkflowDefinitionDraftAction = withAuth(async (user, { tenant }, input: unknown) => {
  initializeWorkflowRuntimeV2();
  const parsed = UpdateWorkflowDefinitionInput.parse(input);

  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'manage', knex);
  const current = await WorkflowDefinitionModelV2.getById(knex, parsed.workflowId);
  if (current?.is_system) {
    await requireWorkflowPermission(user, 'admin', knex);
  }
  const definition = { ...parsed.definition, id: parsed.workflowId };
  const payloadSchemaMode = parsed.payloadSchemaMode ?? (typeof (current as any)?.payload_schema_mode === 'string' ? (current as any).payload_schema_mode : 'pinned');
  const pinnedPayloadSchemaRef = parsed.pinnedPayloadSchemaRef ?? (typeof (current as any)?.pinned_payload_schema_ref === 'string' ? (current as any).pinned_payload_schema_ref : null);
  const payloadSchemaProvenance = payloadSchemaMode === 'pinned' ? 'pinned' : 'inferred';

  const schemaRegistry = getSchemaRegistry();
  const payloadSchemaJson = definition.payloadSchemaRef && schemaRegistry.has(definition.payloadSchemaRef)
    ? schemaRegistry.toJsonSchema(definition.payloadSchemaRef)
    : null;
  const validation = await computeValidation({
    definition,
    payloadSchemaRef: definition.payloadSchemaRef,
    payloadSchemaJson,
    knex,
    tenant
  });

  const updated = await WorkflowDefinitionModelV2.update(knex, parsed.workflowId, {
    draft_definition: definition,
    draft_version: definition.version,
    updated_by: user.user_id,
    name: definition.name,
    description: definition.description ?? null,
    payload_schema_ref: definition.payloadSchemaRef,
    payload_schema_mode: payloadSchemaMode,
    pinned_payload_schema_ref: pinnedPayloadSchemaRef,
    payload_schema_provenance: payloadSchemaProvenance,
    trigger: definition.trigger ?? null,
    validation_status: validation.status,
    validation_errors: validation.errors,
    validation_warnings: validation.warnings,
    validation_context_json: (validation as any).contextJson ?? null,
    validation_payload_schema_hash: (validation as any).payloadSchemaHash ?? null,
    validated_at: new Date().toISOString()
  });

  if (!updated) {
    return throwHttpError(404, 'Not found');
  }

  await auditWorkflowEvent(knex, user, {
    operation: 'workflow_definition_update',
    tableName: 'workflow_definitions',
    recordId: parsed.workflowId,
    changedData: {
      name: definition.name,
      payloadSchemaRef: definition.payloadSchemaRef,
      draftVersion: definition.version
    },
    details: {
      definitionHash: hashDefinition(definition as Record<string, unknown>)
    },
    source: 'api'
  });

  return updated;
});

export const updateWorkflowDefinitionMetadataAction = withAuth(async (user, { tenant }, input: unknown) => {
  const parsed = UpdateWorkflowDefinitionMetadataInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'manage', knex);

  const current = await WorkflowDefinitionModelV2.getById(knex, parsed.workflowId);
  if (!current) {
    return throwHttpError(404, 'Not found');
  }
  if (current.is_system) {
    await requireWorkflowPermission(user, 'admin', knex);
  }

  const updated = await WorkflowDefinitionModelV2.update(knex, parsed.workflowId, {
    ...(parsed.key ? { key: parsed.key.trim() } : {}),
    is_visible: parsed.isVisible ?? current.is_visible ?? true,
    is_paused: parsed.isPaused ?? current.is_paused ?? false,
    concurrency_limit: parsed.concurrencyLimit ?? current.concurrency_limit ?? null,
    auto_pause_on_failure: parsed.autoPauseOnFailure ?? current.auto_pause_on_failure ?? false,
    failure_rate_threshold: parsed.failureRateThreshold ?? current.failure_rate_threshold ?? null,
    failure_rate_min_runs: parsed.failureRateMinRuns ?? current.failure_rate_min_runs ?? null,
    retention_policy_override: parsed.retentionPolicyOverride ?? current.retention_policy_override ?? null,
    updated_by: user.user_id
  });

  await auditWorkflowEvent(knex, user, {
    operation: 'workflow_definition_metadata_update',
    tableName: 'workflow_definitions',
    recordId: parsed.workflowId,
    changedData: {
      key: parsed.key,
      isVisible: parsed.isVisible,
      isPaused: parsed.isPaused,
      concurrencyLimit: parsed.concurrencyLimit,
      autoPauseOnFailure: parsed.autoPauseOnFailure,
      failureRateThreshold: parsed.failureRateThreshold,
      failureRateMinRuns: parsed.failureRateMinRuns
    },
    details: {
      retentionPolicyOverride: parsed.retentionPolicyOverride ?? null
    },
    source: 'api'
  });

  return updated;
});

export const deleteWorkflowDefinitionAction = withAuth(async (user, { tenant }, input: unknown) => {
  const parsed = DeleteWorkflowDefinitionInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'manage', knex);

  const current = await WorkflowDefinitionModelV2.getById(knex, parsed.workflowId);
  if (!current) {
    return throwHttpError(404, 'Not found');
  }
  if (current.is_system) {
    return throwHttpError(403, 'System workflows cannot be deleted');
  }

  // Check for active runs
  const activeRuns = await knex('workflow_runs')
    .where({ workflow_id: parsed.workflowId })
    .whereIn('status', ['RUNNING', 'WAITING'])
    .count('* as count')
    .first();

  if (activeRuns && Number(activeRuns.count) > 0) {
    return throwHttpError(409, 'Cannot delete workflow with active runs. Cancel all runs first.');
  }

  // Delete related records in order (respecting foreign key constraints)
  await knex.transaction(async (trx) => {
    // Delete run-related data
    const runIds = await trx('workflow_runs')
      .where({ workflow_id: parsed.workflowId })
      .pluck('run_id');

    if (runIds.length > 0) {
      await trx('workflow_run_logs').whereIn('run_id', runIds).del();
      await trx('workflow_action_invocations').whereIn('run_id', runIds).del();
      await trx('workflow_run_snapshots').whereIn('run_id', runIds).del();
      await trx('workflow_run_waits').whereIn('run_id', runIds).del();
      await trx('workflow_run_steps').whereIn('run_id', runIds).del();
      await trx('workflow_runs').whereIn('run_id', runIds).del();
    }

    // Delete versions
    await trx('workflow_definition_versions')
      .where({ workflow_id: parsed.workflowId })
      .del();

    // Delete the definition
    await trx('workflow_definitions')
      .where({ workflow_id: parsed.workflowId })
      .del();
  });

  await auditWorkflowEvent(knex, user, {
    operation: 'workflow_definition_delete',
    tableName: 'workflow_definitions',
    recordId: parsed.workflowId,
    changedData: {
      name: current.name,
      status: current.status
    },
    details: {
      deletedAt: new Date().toISOString()
    },
    source: 'api'
  });

  return { deleted: true, workflowId: parsed.workflowId };
});

export const publishWorkflowDefinitionAction = withAuth(async (user, { tenant }, input: unknown) => {
  initializeWorkflowRuntimeV2();
  const parsed = PublishWorkflowDefinitionInput.parse(input);

  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'publish', knex);
  const workflow = await WorkflowDefinitionModelV2.getById(knex, parsed.workflowId);
  if (!workflow) {
    return throwHttpError(404, 'Not found');
  }
  if (workflow.is_system) {
    await requireWorkflowPermission(user, 'admin', knex);
  }

  const maxVersionRow = await knex('workflow_definition_versions')
    .where({ workflow_id: parsed.workflowId })
    .max('version as max_version')
    .first() as { max_version: number | string | null } | undefined;
  const maxPublishedVersion = maxVersionRow?.max_version == null ? null : Number(maxVersionRow.max_version);
  const expectedNextVersion = (maxPublishedVersion ?? 0) + 1;
  const requestedVersion = parsed.version;
  const versionToPublish = requestedVersion < expectedNextVersion ? expectedNextVersion : requestedVersion;

  const definition = { ...(parsed.definition as any ?? workflow.draft_definition), id: parsed.workflowId, version: versionToPublish };
  if (!definition) {
    return throwHttpError(400, 'No definition to publish');
  }

  // Publish-time inference: for inferred mode, prefer the trigger event's schemaRef as the workflow payload contract.
  const schemaRegistry = getSchemaRegistry();
  const payloadSchemaMode = typeof (workflow as any)?.payload_schema_mode === 'string' ? String((workflow as any).payload_schema_mode) : 'pinned';
  const payloadSchemaProvenance = payloadSchemaMode === 'pinned' ? 'pinned' : 'inferred';
  if (payloadSchemaMode === 'inferred') {
    const trigger = (definition as any)?.trigger;
    const isEventTrigger = trigger?.type === 'event' && typeof trigger?.eventName === 'string' && trigger.eventName.length > 0;
    if (!isEventTrigger) {
      return {
        ok: false,
        errors: [{
          severity: 'error',
          stepPath: 'root.payloadSchemaRef',
          code: 'PAYLOAD_SCHEMA_INFERENCE_UNSUPPORTED_TRIGGER',
          message: 'Workflow payload schema inference is only supported for event-triggered workflows. Pin a payload schema to publish.'
        }],
        warnings: []
      };
    }
    if (isEventTrigger) {
      const eventName = String(trigger.eventName);
      const overrideSource = typeof trigger?.sourcePayloadSchemaRef === 'string' && trigger.sourcePayloadSchemaRef.trim()
        ? String(trigger.sourcePayloadSchemaRef).trim()
        : null;
      const catalog = tenant ? await EventCatalogModel.getByEventType(knex, eventName, tenant) : null;
      const catalogRef = typeof (catalog as any)?.payload_schema_ref === 'string' ? String((catalog as any).payload_schema_ref) : null;
      const sourceRef = overrideSource ?? catalogRef;
      if (sourceRef && typeof sourceRef === 'string' && sourceRef.trim()) {
        (definition as any).payloadSchemaRef = sourceRef.trim();
      }
    }
  }

  const payloadSchemaJsonRaw = schemaRegistry.has(definition.payloadSchemaRef)
    ? schemaRegistry.toJsonSchema(definition.payloadSchemaRef)
    : null;
  const payloadSchemaJson = payloadSchemaJsonRaw ? (stableJson(payloadSchemaJsonRaw) as Record<string, unknown>) : null;
  const validation = await computeValidation({
    definition,
    payloadSchemaRef: definition.payloadSchemaRef,
    payloadSchemaJson,
    knex,
    tenant
  });
  if (validation.errors.length > 0) {
    return { ok: false, errors: validation.errors, warnings: validation.warnings };
  }

  let record: WorkflowDefinitionVersionRecord;
  try {
    record = await WorkflowDefinitionVersionModelV2.create(knex, {
      workflow_id: parsed.workflowId,
      version: versionToPublish,
      definition_json: definition,
      payload_schema_json: payloadSchemaJson as Record<string, unknown> | null,
      validation_status: validation.status,
      validation_errors: validation.errors,
      validation_warnings: validation.warnings,
      validated_at: new Date().toISOString(),
      published_by: user.user_id,
      published_at: new Date().toISOString()
    });
  } catch (err: any) {
    if (err?.code === '23505' && err?.constraint === 'workflow_definition_versions_workflow_version_unique') {
      return throwHttpError(409, `Workflow version ${versionToPublish} already exists. Refresh and retry.`);
    }
    throw err;
  }

  const nextDraftVersion = versionToPublish + 1;
  const nextDraftDefinition = { ...definition, version: nextDraftVersion };
  await WorkflowDefinitionModelV2.update(knex, parsed.workflowId, {
    status: 'published',
    draft_definition: nextDraftDefinition,
    draft_version: nextDraftVersion,
    name: definition.name,
    description: definition.description ?? null,
    trigger: definition.trigger ?? null,
    payload_schema_ref: definition.payloadSchemaRef,
    payload_schema_provenance: payloadSchemaProvenance,
    validation_status: validation.status,
    validation_errors: validation.errors,
    validation_warnings: validation.warnings,
    validation_context_json: (validation as any).contextJson ?? null,
    validation_payload_schema_hash: (validation as any).payloadSchemaHash ?? null,
    validated_at: new Date().toISOString(),
    updated_by: user.user_id
  });

  await auditWorkflowEvent(knex, user, {
    operation: 'workflow_definition_publish',
    tableName: 'workflow_definitions',
    recordId: parsed.workflowId,
    changedData: {
      publishedVersion: record.version,
      status: 'published'
    },
    details: {
      definitionHash: hashDefinition(definition as Record<string, unknown>),
      payloadSchemaRef: definition.payloadSchemaRef,
      payloadSchemaMode: payloadSchemaMode,
      payloadSchemaProvenance,
      warnings: validation.warnings?.length ?? 0
    },
    source: 'api'
  });

  return { ok: true, publishedVersion: record.version, errors: [], warnings: validation.warnings };
});

export const startWorkflowRunAction = withAuth(async (user, { tenant }, input: unknown) => {
  initializeWorkflowRuntimeV2();
  const parsed = StartWorkflowRunInput.parse(input);

  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'manage', knex);
  if (tenant) {
    try {
      await workflowRunStartLimiter.consume(tenant);
    } catch {
      throwHttpError(429, 'Workflow run rate limit exceeded');
    }
  }

  const payloadSize = measurePayloadBytes(parsed.payload);
  if (payloadSize === null) {
    return throwHttpError(400, 'Payload must be JSON serializable');
  }
  if (payloadSize > WORKFLOW_RUN_PAYLOAD_LIMIT) {
    return throwHttpError(413, 'Payload exceeds maximum size');
  }
  const runtime = new WorkflowRuntimeV2();

  const workflow = await WorkflowDefinitionModelV2.getById(knex, parsed.workflowId);
  if (!workflow) {
    return throwHttpError(404, 'Workflow not found');
  }
  if (workflow.is_system) {
    const canAdmin = await hasPermission(user, 'workflow', 'admin', knex);
    if (!canAdmin) {
      return throwHttpError(403, 'Forbidden');
    }
  }
  if (workflow.is_paused) {
    return throwHttpError(409, 'Workflow is paused');
  }
  if (workflow.concurrency_limit) {
    const activeCount = await knex('workflow_runs')
      .where({ workflow_id: parsed.workflowId })
      .whereIn('status', ['RUNNING', 'WAITING'])
      .count('* as count')
      .first();
    const current = Number((activeCount as any)?.count ?? 0);
    if (current >= workflow.concurrency_limit) {
      return throwHttpError(429, 'Workflow concurrency limit reached');
    }
  }

  let versionRecord: WorkflowDefinitionVersionRecord | null = null;
  if (parsed.workflowVersion) {
    versionRecord = await WorkflowDefinitionVersionModelV2.getByWorkflowAndVersion(
      knex,
      parsed.workflowId,
      parsed.workflowVersion
    );
    if (!versionRecord) {
      return throwHttpError(404, 'Workflow version not found');
    }
  } else {
    const versions = await WorkflowDefinitionVersionModelV2.listByWorkflow(knex, parsed.workflowId);
    versionRecord = versions[0] ?? null;
    if (!versionRecord) {
      return throwHttpError(409, 'Workflow has no published versions');
    }
  }

  const schemaRegistry = getSchemaRegistry();
  const definition = versionRecord.definition_json as Record<string, unknown> | null;
  const schemaRefFromDefinition = (definition as Record<string, unknown> | null)?.payloadSchemaRef;
  const schemaRef =
    typeof schemaRefFromDefinition === 'string'
      ? schemaRefFromDefinition
      : (typeof workflow.payload_schema_ref === 'string' ? workflow.payload_schema_ref : null);

  const trigger = (definition as any)?.trigger ?? workflow.trigger ?? null;
  const triggerMapping = trigger?.payloadMapping as any | undefined;
  const triggerMappingProvided = triggerMapping && typeof triggerMapping === 'object' && Object.keys(triggerMapping).length > 0;
  const inputIsSourcePayload = typeof (parsed as any).sourcePayloadSchemaRef === 'string' && String((parsed as any).sourcePayloadSchemaRef).trim().length > 0;

  let effectiveSourceSchemaRef: string | null = null;
  if (inputIsSourcePayload) {
    effectiveSourceSchemaRef = String((parsed as any).sourcePayloadSchemaRef).trim();
  } else if (typeof trigger?.sourcePayloadSchemaRef === 'string' && trigger.sourcePayloadSchemaRef.trim()) {
    effectiveSourceSchemaRef = String(trigger.sourcePayloadSchemaRef).trim();
  } else if (tenant && parsed.eventType) {
    try {
      const entry = await EventCatalogModel.getByEventType(knex, parsed.eventType, tenant);
      const ref = (entry as any)?.payload_schema_ref;
      effectiveSourceSchemaRef = typeof ref === 'string' && ref ? ref : null;
    } catch {
      effectiveSourceSchemaRef = null;
    }
  }

  let finalPayload: Record<string, unknown> = parsed.payload ?? {};
  let triggerMappingApplied = false;
  if (inputIsSourcePayload) {
    if (!schemaRef) {
      return throwHttpError(409, 'Workflow has no payload schema ref');
    }
    if (!effectiveSourceSchemaRef) {
      return throwHttpError(400, 'Missing sourcePayloadSchemaRef for event payload');
    }
    const refsMatch = effectiveSourceSchemaRef === schemaRef;
    if (!refsMatch && !triggerMappingProvided) {
      return throwHttpError(409, 'Trigger mapping is required for this run', {
        sourcePayloadSchemaRef: effectiveSourceSchemaRef,
        payloadSchemaRef: schemaRef
      });
    }
    if (triggerMappingProvided) {
      const provider = tenant ? createTenantSecretProvider(knex, tenant) : null;
      const secretResolver = provider
        ? createSecretResolverFromProvider((name, workflowRunId) => provider.getValue(name, workflowRunId))
        : undefined;
      const resolved = await resolveInputMapping(triggerMapping, {
        expressionContext: {
          event: {
            name: parsed.eventType ?? trigger?.eventName ?? null,
            correlationKey: 'manual',
            payload: parsed.payload ?? {},
            payloadSchemaRef: effectiveSourceSchemaRef
          }
        },
        secretResolver
      });
      finalPayload = expandDottedKeys((resolved ?? {}) as Record<string, unknown>);
      triggerMappingApplied = true;
    } else {
      finalPayload = parsed.payload ?? {};
    }
  }

  if (!versionRecord.validation_status || versionRecord.validation_status === 'error') {
    const payloadSchemaJson = versionRecord.payload_schema_json
      ?? (schemaRef && schemaRegistry.has(schemaRef) ? schemaRegistry.toJsonSchema(schemaRef) : null);
    const validation = await computeValidation({
      definition: definition ?? {},
      payloadSchemaRef: schemaRef ?? undefined,
      payloadSchemaJson,
      knex,
      tenant
    });
    await WorkflowDefinitionVersionModelV2.update(knex, parsed.workflowId, versionRecord.version, {
      validation_status: validation.status,
      validation_errors: validation.errors,
      validation_warnings: validation.warnings,
      validated_at: new Date().toISOString()
    });
    if (validation.errors.length > 0) {
      return throwHttpError(409, 'Workflow validation failed', { errors: validation.errors, warnings: validation.warnings });
    }
  }

  if (schemaRef && schemaRegistry.has(schemaRef)) {
    const validation = schemaRegistry.get(schemaRef).safeParse(finalPayload);
    if (!validation.success) {
      return throwHttpError(400, 'Payload failed validation', { issues: validation.error.issues });
    }
  }

  const runId = await runtime.startRun(knex, {
    workflowId: parsed.workflowId,
    version: versionRecord.version,
    payload: finalPayload,
    tenantId: tenant,
    eventType: parsed.eventType ?? null,
    sourcePayloadSchemaRef: inputIsSourcePayload ? effectiveSourceSchemaRef : null,
    triggerMappingApplied: triggerMappingApplied
  });

  try {
    void analytics.capture('workflow.trigger.mapping_applied', {
      workflowId: parsed.workflowId,
      workflowVersion: versionRecord.version,
      eventType: parsed.eventType ?? null,
      workflowPayloadSchemaRef: schemaRef ?? null,
      sourcePayloadSchemaRef: inputIsSourcePayload ? effectiveSourceSchemaRef : null,
      triggerMappingApplied,
      triggerMappingProvided: triggerMappingProvided,
      schemaRefsMatch: Boolean(inputIsSourcePayload && effectiveSourceSchemaRef && schemaRef && effectiveSourceSchemaRef === schemaRef),
      startedFrom: inputIsSourcePayload ? 'run_dialog_event_payload' : 'run_dialog_payload'
    }, user.user_id);
  } catch {
    // best-effort telemetry
  }

  await runtime.executeRun(knex, runId, `action-${user.user_id}`);

  const run = await WorkflowRunModelV2.getById(knex, runId);
  await auditWorkflowEvent(knex, user, {
    operation: 'workflow_run_start',
    tableName: 'workflow_runs',
    recordId: runId,
    changedData: { status: run?.status ?? 'RUNNING' },
    details: {
      workflowId: parsed.workflowId,
      workflowVersion: versionRecord.version,
      eventType: parsed.eventType ?? null
    },
    source: 'ui'
  });
  return { runId, status: run?.status };
});

export const getWorkflowRunAction = withAuth(async (user, { tenant }, input: unknown) => {
  const parsed = RunIdInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);
  const run = await requireRunTenantAccess(knex, parsed.runId, tenant);
  const cfg = await loadTenantRedactionConfig(knex, tenant);
  return {
    ...run,
    input_json: applyRunStudioRedactions(run.input_json ?? null, cfg) as any,
    resume_event_payload: applyRunStudioRedactions(run.resume_event_payload ?? null, cfg) as any,
    resume_error: applyRunStudioRedactions(run.resume_error ?? null, cfg) as any,
    error_json: applyRunStudioRedactions(run.error_json ?? null, cfg) as any
  };
});

export const listWorkflowRunsAction = withAuth(async (user, { tenant }, input: unknown) => {
  const parsed = ListWorkflowRunsInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);

  const [sortField, sortDir] = parsed.sort.split(':') as ['started_at' | 'updated_at', 'asc' | 'desc'];

  const query = knex('workflow_runs')
    .leftJoin('workflow_definitions', 'workflow_runs.workflow_id', 'workflow_definitions.workflow_id')
    .select(
      'workflow_runs.run_id',
      'workflow_runs.workflow_id',
      'workflow_runs.workflow_version',
      'workflow_runs.tenant_id',
      'workflow_runs.status',
      'workflow_runs.node_path',
      'workflow_runs.source_payload_schema_ref',
      'workflow_runs.trigger_mapping_applied',
      'workflow_runs.started_at',
      'workflow_runs.completed_at',
      'workflow_runs.updated_at',
      'workflow_definitions.name as workflow_name'
    );

  if (tenant) {
    query.where('workflow_runs.tenant_id', tenant);
  }
  if (parsed.status?.length) {
    query.whereIn('workflow_runs.status', parsed.status);
  }
  if (parsed.workflowId) {
    query.where('workflow_runs.workflow_id', parsed.workflowId);
  }
  if (parsed.version) {
    query.where('workflow_runs.workflow_version', parsed.version);
  }
  if (parsed.runId) {
    query.where('workflow_runs.run_id', parsed.runId);
  }
  if (parsed.search) {
    const searchValue = `%${parsed.search}%`;
    query.where((builder) => {
      builder
        .whereRaw('workflow_runs.run_id::text ilike ?', [searchValue])
        .orWhereExists(
          knex('workflow_run_waits')
            .select(1)
            .whereRaw('workflow_run_waits.run_id = workflow_runs.run_id')
            .where('workflow_run_waits.key', 'ilike', searchValue)
        );
    });
  }
  if (parsed.from) {
    query.where('workflow_runs.started_at', '>=', parsed.from);
  }
  if (parsed.to) {
    query.where('workflow_runs.started_at', '<=', parsed.to);
  }

  const rows = await query
    .orderBy(`workflow_runs.${sortField}`, sortDir)
    .orderBy('workflow_runs.run_id', 'desc')
    .limit(parsed.limit + 1)
    .offset(parsed.cursor);

  const hasMore = rows.length > parsed.limit;
  const runs = hasMore ? rows.slice(0, parsed.limit) : rows;
  const nextCursor = hasMore ? parsed.cursor + parsed.limit : null;

  return { runs, nextCursor };
});

export async function exportWorkflowRunsAction(input: unknown) {
  const rawInput = (input ?? {}) as Record<string, unknown>;
  const result = await listWorkflowRunsAction({
    ...rawInput,
    limit: rawInput.limit ?? EXPORT_RUNS_LIMIT,
    cursor: 0
  });

  const headers = [
    'run_id',
    'workflow_name',
    'workflow_id',
    'workflow_version',
    'status',
    'tenant_id',
    'started_at',
    'updated_at',
    'completed_at'
  ];

  const rows = result.runs.map((run: any) => [
    run.run_id,
    run.workflow_name ?? '',
    run.workflow_id,
    run.workflow_version,
    run.status,
    run.tenant_id ?? '',
    run.started_at,
    run.updated_at,
    run.completed_at ?? ''
  ]);

  const csv = buildCsv(headers, rows);
  return { body: csv, contentType: 'text/csv', filename: 'workflow-runs.csv' };
}

export const listWorkflowDeadLetterRunsAction = withAuth(async (user, { tenant }, input: unknown) => {
  const parsed = ListWorkflowDeadLetterInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'admin', knex);

  const query = knex('workflow_runs as runs')
    .leftJoin('workflow_definitions as defs', 'runs.workflow_id', 'defs.workflow_id')
    .leftJoin('workflow_run_steps as steps', 'runs.run_id', 'steps.run_id')
    .where('runs.status', 'FAILED')
    .select(
      'runs.run_id',
      'runs.workflow_id',
      'runs.workflow_version',
      'runs.tenant_id',
      'runs.status',
      'runs.started_at',
      'runs.updated_at',
      'runs.completed_at',
      'defs.name as workflow_name',
      knex.raw('max(steps.attempt) as max_attempt'),
      knex.raw("count(case when steps.status = 'FAILED' then 1 end) as failed_steps")
    )
    .groupBy(
      'runs.run_id',
      'runs.workflow_id',
      'runs.workflow_version',
      'runs.tenant_id',
      'runs.status',
      'runs.started_at',
      'runs.updated_at',
      'runs.completed_at',
      'defs.name'
    )
    .havingRaw('max(steps.attempt) >= ?', [parsed.minRetries]);

  if (tenant) {
    query.where('runs.tenant_id', tenant);
  }

  const rows = await query
    .orderBy('runs.updated_at', 'desc')
    .orderBy('runs.run_id', 'desc')
    .limit(parsed.limit + 1)
    .offset(parsed.cursor);

  const hasMore = rows.length > parsed.limit;
  const runs = hasMore ? rows.slice(0, parsed.limit) : rows;
  const nextCursor = hasMore ? parsed.cursor + parsed.limit : null;

  return { runs, nextCursor };
});

export const listWorkflowRunSummaryAction = withAuth(async (user, { tenant }, input: unknown) => {
  const parsed = ListWorkflowRunSummaryInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);

  const query = knex('workflow_runs').select('status').count('* as count');

  if (tenant) {
    query.where('tenant_id', tenant);
  }
  if (parsed.workflowId) {
    query.where('workflow_id', parsed.workflowId);
  }
  if (parsed.version) {
    query.where('workflow_version', parsed.version);
  }
  if (parsed.from) {
    query.where('started_at', '>=', parsed.from);
  }
  if (parsed.to) {
    query.where('started_at', '<=', parsed.to);
  }

  const rows = await query.groupBy('status');
  const summary: Record<string, number> = {};
  let total = 0;
  rows.forEach((row: any) => {
    const count = Number(row.count ?? 0);
    summary[row.status] = count;
    total += count;
  });

  return { total, byStatus: summary };
});

export const getWorkflowRunSummaryMetadataAction = withAuth(async (user, { tenant }, input: unknown) => {
  const parsed = RunIdInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);

  const run = await requireRunTenantAccess(knex, parsed.runId, tenant);

  const [stepsCount, logsCount, waitsCount] = await Promise.all([
    knex('workflow_run_steps').where({ run_id: parsed.runId }).count<{ count: string }>('step_id as count').first(),
    knex('workflow_run_logs').where({ run_id: parsed.runId }).count<{ count: string }>('log_id as count').first(),
    knex('workflow_run_waits').where({ run_id: parsed.runId }).count<{ count: string }>('wait_id as count').first()
  ]);

  const durationMs = run.completed_at
    ? new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()
    : null;

  return {
    runId: run.run_id,
    status: run.status,
    workflowId: run.workflow_id,
    workflowVersion: run.workflow_version,
    eventType: run.event_type ?? null,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    durationMs: durationMs != null && durationMs >= 0 ? durationMs : null,
    stepsCount: Number(stepsCount?.count ?? 0),
    logsCount: Number(logsCount?.count ?? 0),
    waitsCount: Number(waitsCount?.count ?? 0)
  };
});

export const getLatestWorkflowRunAction = withAuth(async (user, { tenant }, input: unknown) => {
  const parsed = GetLatestWorkflowRunInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);

  const query = knex('workflow_runs')
    .where({ workflow_id: parsed.workflowId })
    .orderBy('started_at', 'desc')
    .limit(1);

  if (tenant) {
    query.where('tenant_id', tenant);
  }
  if (parsed.eventType) {
    query.where('event_type', parsed.eventType);
  }

  const latest = await query.first();
  if (!latest) {
    return { run: null };
  }

  return { run: latest };
});

export const listWorkflowRunLogsAction = withAuth(async (user, { tenant }, input: unknown) => {
  const parsed = ListWorkflowRunLogsInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);
  await requireRunTenantAccess(knex, parsed.runId, tenant);

  const cfg = await loadTenantRedactionConfig(knex, tenant);
  const result = await WorkflowRunLogModelV2.listByRun(knex, parsed.runId, {
    level: parsed.level,
    search: parsed.search,
    limit: parsed.limit,
    cursor: parsed.cursor
  });
  return {
    ...result,
    logs: result.logs.map((log) => ({
      ...log,
      context_json: log.context_json ? (applyRunStudioRedactions(log.context_json, cfg) as any) : null
    }))
  };
});

export const listWorkflowRunTimelineEventsAction = withAuth(async (user, { tenant }, input: unknown) => {
  const parsed = RunIdInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);
  await requireRunTenantAccess(knex, parsed.runId, tenant);

  const steps = await WorkflowRunStepModelV2.listByRun(knex, parsed.runId);
  const waits = await WorkflowRunWaitModelV2.listByRun(knex, parsed.runId);

  const stepEvents = steps.map((step) => ({
    type: 'step',
    step_id: step.step_id,
    step_path: step.step_path,
    definition_step_id: step.definition_step_id,
    status: step.status,
    attempt: step.attempt,
    duration_ms: step.duration_ms ?? null,
    started_at: step.started_at,
    completed_at: step.completed_at ?? null,
    timestamp: step.started_at
  }));

  const waitEvents = waits.map((wait) => ({
    type: 'wait',
    wait_id: wait.wait_id,
    step_path: wait.step_path,
    wait_type: wait.wait_type,
    status: wait.status,
    event_name: wait.event_name ?? null,
    key: wait.key ?? null,
    timeout_at: wait.timeout_at ?? null,
    created_at: wait.created_at,
    resolved_at: wait.resolved_at ?? null,
    timestamp: wait.created_at
  }));

  const events = [...stepEvents, ...waitEvents].sort((a, b) => (
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  ));

  return { events };
});

export async function exportWorkflowRunLogsAction(input: unknown) {
  const rawInput = (input ?? {}) as Record<string, unknown>;
  const parsed = ListWorkflowRunLogsInput.parse({
    ...rawInput,
    limit: rawInput.limit ?? EXPORT_LOGS_LIMIT,
    cursor: 0
  });
  const result = await listWorkflowRunLogsAction(parsed);

  const headers = ['created_at', 'level', 'message', 'step_path', 'event_name', 'correlation_key', 'source'];
  const rows = result.logs.map((log: any) => [
    log.created_at,
    log.level,
    log.message,
    log.step_path ?? '',
    log.event_name ?? '',
    log.correlation_key ?? '',
    log.source ?? ''
  ]);

  return {
    body: buildCsv(headers, rows),
    contentType: 'text/csv',
    filename: `workflow-run-${parsed.runId}-logs.csv`
  };
}

export const listWorkflowAuditLogsAction = withAuth(async (user, { tenant }, input: unknown) => {
  const parsed = ListWorkflowAuditLogsInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'admin', knex);

  const rows = await knex('audit_logs')
    .where({ table_name: parsed.tableName, record_id: parsed.recordId })
    .orderBy('timestamp', 'desc')
    .orderBy('audit_id', 'desc')
    .limit(parsed.limit + 1)
    .offset(parsed.cursor);

  const hasMore = rows.length > parsed.limit;
  const logs = hasMore ? rows.slice(0, parsed.limit) : rows;
  const nextCursor = hasMore ? parsed.cursor + parsed.limit : null;

  const sanitized = logs.map((log: any) => ({
    ...log,
    changed_data: redactSensitiveValues(log.changed_data),
    details: redactSensitiveValues(log.details)
  }));

  return { logs: sanitized, nextCursor };
});

export async function exportWorkflowAuditLogsAction(input: unknown) {
  const rawInput = (input ?? {}) as Record<string, unknown>;
  const format = String(rawInput.format ?? 'csv').toLowerCase() === 'json' ? 'json' : 'csv';
  const parsed = ListWorkflowAuditLogsInput.parse({
    ...rawInput,
    limit: rawInput.limit ?? EXPORT_AUDIT_LIMIT,
    cursor: 0
  });

  const result = await listWorkflowAuditLogsAction(parsed);
  const filenamePrefix = parsed.tableName === 'workflow_definitions' ? 'workflow-definition' : 'workflow-run';
  const filename = `${filenamePrefix}-${parsed.recordId}-audit.${format === 'json' ? 'json' : 'csv'}`;

  if (format === 'json') {
    return {
      body: JSON.stringify(result.logs, null, 2),
      contentType: 'application/json',
      filename
    };
  }

  const headers = ['timestamp', 'operation', 'user_id', 'table_name', 'record_id'];
  const rows = result.logs.map((log: any) => [
    log.timestamp,
    log.operation,
    log.user_id ?? '',
    log.table_name,
    log.record_id
  ]);
  return {
    body: buildCsv(headers, rows),
    contentType: 'text/csv',
    filename
  };
}

export const listWorkflowRunStepsAction = withAuth(async (user, { tenant }, input: unknown) => {
  const parsed = RunIdInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);
  await requireRunTenantAccess(knex, parsed.runId, tenant);
  const steps = await WorkflowRunStepModelV2.listByRun(knex, parsed.runId);
  const snapshots = await WorkflowRunSnapshotModelV2.listByRun(knex, parsed.runId);
  const invocations = await WorkflowActionInvocationModelV2.listByRun(knex, parsed.runId);
  const waits = await WorkflowRunWaitModelV2.listByRun(knex, parsed.runId);
  const canManage = await hasPermission(user, 'workflow', 'manage', knex);
  const canAdmin = await hasPermission(user, 'workflow', 'admin', knex);
  const canViewSensitive = canManage || canAdmin;
  const cfg = await loadTenantRedactionConfig(knex, tenant);

  const redactedInvocations = canViewSensitive
    ? invocations.map((invocation) => ({
        ...invocation,
        input_json: invocation.input_json ? (applyRunStudioRedactions(invocation.input_json, cfg) as any) : null,
        output_json: invocation.output_json ? (applyRunStudioRedactions(invocation.output_json, cfg) as any) : null
      }))
    : invocations.map((invocation) => ({
        ...invocation,
        input_json: invocation.input_json ? { redacted: true } : null,
        output_json: invocation.output_json ? { redacted: true } : null
      }));

  const sanitizedSnapshots = snapshots.map((snapshot) => ({
    ...snapshot,
    envelope_json: applyRunStudioRedactions(snapshot.envelope_json, cfg) as any
  }));

  return { steps, snapshots: sanitizedSnapshots, invocations: redactedInvocations, waits };
});

export const exportWorkflowRunDetailAction = withAuth(async (user, { tenant }, input: unknown) => {
  const parsed = RunIdInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);

  const run = await WorkflowRunModelV2.getById(knex, parsed.runId);
  if (!run) {
    return throwHttpError(404, 'Not found');
  }
  if (tenant && run.tenant_id && run.tenant_id !== tenant) {
    return throwHttpError(404, 'Not found');
  }

  const steps = await WorkflowRunStepModelV2.listByRun(knex, parsed.runId);
  const snapshots = await WorkflowRunSnapshotModelV2.listByRun(knex, parsed.runId);
  const invocations = await WorkflowActionInvocationModelV2.listByRun(knex, parsed.runId);
  const waits = await WorkflowRunWaitModelV2.listByRun(knex, parsed.runId);
  const canManage = await hasPermission(user, 'workflow', 'manage', knex);
  const canAdmin = await hasPermission(user, 'workflow', 'admin', knex);
  const canViewSensitive = canManage || canAdmin;

  const sanitizedInvocations = canViewSensitive
    ? invocations
    : invocations.map((invocation) => ({
        ...invocation,
        input_json: invocation.input_json ? { redacted: true } : null,
        output_json: invocation.output_json ? { redacted: true } : null
      }));

  const sanitizedSnapshots = snapshots.map((snapshot) => ({
    ...snapshot,
    envelope_json: redactSensitiveValues(snapshot.envelope_json)
  }));

  const sanitizedRun = {
    ...run,
    input_json: redactSensitiveValues(run.input_json),
    resume_event_payload: redactSensitiveValues(run.resume_event_payload),
    resume_error: redactSensitiveValues(run.resume_error),
    error_json: redactSensitiveValues(run.error_json)
  };

  return {
    run: sanitizedRun,
    steps,
    snapshots: sanitizedSnapshots,
    invocations: sanitizedInvocations,
    waits
  };
});

export const cancelWorkflowRunAction = withAuth(async (user, { tenant }, input: unknown) => {
  const parsed = RunActionInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'admin', knex);

  const runRecord = await requireRunTenantAccess(knex, parsed.runId, tenant);

  await WorkflowRunModelV2.update(knex, parsed.runId, {
    status: 'CANCELED',
    node_path: null,
    completed_at: new Date().toISOString()
  });

  const waits = await knex('workflow_run_waits').where({ run_id: parsed.runId, status: 'WAITING' });
  for (const wait of waits) {
    await WorkflowRunWaitModelV2.update(knex, wait.wait_id, {
      status: 'CANCELED',
      resolved_at: new Date().toISOString()
    });
  }

  await WorkflowRunLogModelV2.create(knex, {
    run_id: parsed.runId,
    tenant_id: runRecord?.tenant_id ?? null,
    level: 'WARN',
    message: 'Run canceled by operator',
    context_json: { reason: parsed.reason },
    source: parsed.source ?? 'api'
  });

  await auditWorkflowEvent(knex, user, {
    operation: 'workflow_run_cancel',
    tableName: 'workflow_runs',
    recordId: parsed.runId,
    changedData: { status: 'CANCELED' },
    details: { reason: parsed.reason },
    source: parsed.source ?? 'api'
  });

  return { ok: true };
});

export const resumeWorkflowRunAction = withAuth(async (user, { tenant }, input: unknown) => {
  initializeWorkflowRuntimeV2();
  const parsed = RunActionInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'admin', knex);
  const runRecord = await requireRunTenantAccess(knex, parsed.runId, tenant);

  const waits = await WorkflowRunWaitModelV2.listByRun(knex, parsed.runId);
  const waiting = waits.filter((wait) => wait.status === 'WAITING');
  const primaryWait = waiting[0] ?? null;
  if (waiting.length > 0) {
    const resolvedAt = new Date().toISOString();
    for (const wait of waiting) {
      await WorkflowRunWaitModelV2.update(knex, wait.wait_id, {
        status: 'RESOLVED',
        resolved_at: resolvedAt
      });
    }
  }

  const resumePayload = {
    __admin_override: true,
    reason: parsed.reason,
    waitId: primaryWait?.wait_id ?? null,
    waitType: primaryWait?.wait_type ?? null
  };

  await WorkflowRunModelV2.update(knex, parsed.runId, {
    status: 'RUNNING',
    resume_event_name: primaryWait?.event_name ?? 'ADMIN_RESUME',
    resume_event_payload: resumePayload,
    resume_error: null
  });

  const processedAt = new Date().toISOString();
  await WorkflowRuntimeEventModelV2.create(knex, {
    tenant_id: runRecord?.tenant_id ?? null,
    event_name: 'ADMIN_RESUME',
    correlation_key: parsed.runId,
    payload: resumePayload,
    processed_at: processedAt,
    matched_run_id: parsed.runId,
    matched_wait_id: primaryWait?.wait_id ?? null,
    matched_step_path: primaryWait?.step_path ?? null
  });

  const runtime = new WorkflowRuntimeV2();
  await runtime.executeRun(knex, parsed.runId, `admin-${user.user_id}`);

  await WorkflowRunModelV2.update(knex, parsed.runId, {
    resume_event_name: primaryWait?.event_name ?? 'ADMIN_RESUME',
    resume_event_payload: resumePayload
  });

  await WorkflowRunLogModelV2.create(knex, {
    run_id: parsed.runId,
    tenant_id: runRecord?.tenant_id ?? null,
    level: 'INFO',
    message: 'Run resumed by operator',
    context_json: {
      reason: parsed.reason,
      waitId: primaryWait?.wait_id ?? null,
      waitType: primaryWait?.wait_type ?? null
    },
    source: parsed.source ?? 'api'
  });

  await auditWorkflowEvent(knex, user, {
    operation: 'workflow_run_resume',
    tableName: 'workflow_runs',
    recordId: parsed.runId,
    changedData: { status: 'RUNNING' },
    details: { reason: parsed.reason },
    source: parsed.source ?? 'api'
  });

  return { ok: true };
});

export const retryWorkflowRunAction = withAuth(async (user, { tenant }, input: unknown) => {
  initializeWorkflowRuntimeV2();
  const parsed = RunActionInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'admin', knex);

  const run = await requireRunTenantAccess(knex, parsed.runId, tenant);
  if (run.status !== 'FAILED') {
    return throwHttpError(409, 'Run is not failed');
  }

  const failedStep = await knex('workflow_run_steps')
    .where({ run_id: parsed.runId, status: 'FAILED' })
    .orderBy('completed_at', 'desc')
    .first();
  const nodePath =
    failedStep?.step_path ?? (run.error_json as { nodePath?: string } | null)?.nodePath ?? null;
  if (!nodePath) {
    return throwHttpError(409, 'Failed step not found');
  }

  await WorkflowRunModelV2.update(knex, parsed.runId, {
    status: 'RUNNING',
    node_path: nodePath,
    completed_at: null,
    error_json: null,
    resume_error: null,
    resume_event_name: null,
    resume_event_payload: null
  });

  await WorkflowRunLogModelV2.create(knex, {
    run_id: parsed.runId,
    tenant_id: run.tenant_id ?? null,
    level: 'INFO',
    message: 'Run retry requested',
    context_json: { reason: parsed.reason, nodePath },
    source: parsed.source ?? 'api'
  });

  await auditWorkflowEvent(knex, user, {
    operation: 'workflow_run_retry',
    tableName: 'workflow_runs',
    recordId: parsed.runId,
    changedData: { status: 'RUNNING' },
    details: { reason: parsed.reason, nodePath },
    source: parsed.source ?? 'api'
  });

  const runtime = new WorkflowRuntimeV2();
  await runtime.executeRun(knex, parsed.runId, `admin-retry-${user.user_id}`);

  return { ok: true };
});

export const replayWorkflowRunAction = withAuth(async (user, { tenant }, input: unknown) => {
  initializeWorkflowRuntimeV2();
  const parsed = ReplayWorkflowRunInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'admin', knex);

  const run = await requireRunTenantAccess(knex, parsed.runId, tenant);

  const runtime = new WorkflowRuntimeV2();
  const newRunId = await runtime.startRun(knex, {
    workflowId: run.workflow_id,
    version: run.workflow_version,
    payload: parsed.payload,
    tenantId: run.tenant_id ?? tenant,
    eventType: run.event_type ?? null
  });

  await WorkflowRunLogModelV2.create(knex, {
    run_id: newRunId,
    tenant_id: run.tenant_id ?? tenant,
    level: 'INFO',
    message: 'Run replayed from previous run',
    context_json: { sourceRunId: run.run_id, reason: parsed.reason },
    source: parsed.source ?? 'api'
  });

  await WorkflowRunLogModelV2.create(knex, {
    run_id: run.run_id,
    tenant_id: run.tenant_id ?? null,
    level: 'INFO',
    message: 'Run replay created',
    context_json: { newRunId, reason: parsed.reason },
    source: parsed.source ?? 'api'
  });

  await auditWorkflowEvent(knex, user, {
    operation: 'workflow_run_replay',
    tableName: 'workflow_runs',
    recordId: run.run_id,
    changedData: { replayedRunId: newRunId },
    details: { reason: parsed.reason, newRunId },
    source: parsed.source ?? 'api'
  });

  await runtime.executeRun(knex, newRunId, `admin-replay-${user.user_id}`);

  return { ok: true, runId: newRunId };
});

export const requeueWorkflowRunEventWaitAction = withAuth(async (user, { tenant }, input: unknown) => {
  initializeWorkflowRuntimeV2();
  const parsed = RunActionInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'admin', knex);

  const run = await WorkflowRunModelV2.getById(knex, parsed.runId);
  if (!run) {
    return throwHttpError(404, 'Run not found');
  }

  const wait = await knex('workflow_run_waits')
    .where({ run_id: parsed.runId, wait_type: 'event' })
    .orderBy('created_at', 'desc')
    .first();
  if (!wait) {
    return throwHttpError(409, 'No event wait found for run');
  }

  await WorkflowRunWaitModelV2.update(knex, wait.wait_id, {
    status: 'WAITING',
    resolved_at: null
  });

  await WorkflowRunModelV2.update(knex, parsed.runId, {
    status: 'WAITING',
    node_path: wait.step_path ?? run.node_path ?? null,
    completed_at: null,
    error_json: null,
    resume_error: null,
    resume_event_name: null,
    resume_event_payload: null
  });

  await WorkflowRunLogModelV2.create(knex, {
    run_id: parsed.runId,
    tenant_id: run.tenant_id ?? null,
    level: 'INFO',
    message: 'Event wait requeued by operator',
    context_json: { reason: parsed.reason, waitId: wait.wait_id },
    source: parsed.source ?? 'api'
  });

  await auditWorkflowEvent(knex, user, {
    operation: 'workflow_run_requeue_event',
    tableName: 'workflow_runs',
    recordId: parsed.runId,
    changedData: { status: 'WAITING' },
    details: { reason: parsed.reason, waitId: wait.wait_id },
    source: parsed.source ?? 'api'
  });

  return { ok: true };
});

export const listWorkflowRegistryNodesAction = withAuth(async (user, { tenant }) => {
  initializeWorkflowRuntimeV2();
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);
  const registry = getNodeTypeRegistry();
  return registry.list().map((node) => ({
    id: node.id,
    ui: node.ui,
    configSchema: zodToJsonSchema(node.configSchema, { name: node.id }),
    examples: node.examples ?? null,
    defaultRetry: node.defaultRetry ?? null
  }));
});

export const listWorkflowRegistryActionsAction = withAuth(async (user, { tenant }) => {
  initializeWorkflowRuntimeV2();
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);
  const registry = getActionRegistryV2();
  return registry.list().map((action) => ({
    id: action.id,
    version: action.version,
    sideEffectful: action.sideEffectful,
    retryHint: action.retryHint ?? null,
    idempotency: action.idempotency,
    ui: action.ui,
    inputSchema: zodToJsonSchema(action.inputSchema, { name: `${action.id}@${action.version}.input` }),
    outputSchema: zodToJsonSchema(action.outputSchema, { name: `${action.id}@${action.version}.output` }),
    examples: action.examples ?? null
  }));
});

export const getWorkflowSchemaAction = withAuth(async (user, { tenant }, input: unknown) => {
  initializeWorkflowRuntimeV2();
  const parsed = SchemaRefInput.parse(input);
  const registry = getSchemaRegistry();
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);
  if (!registry.has(parsed.schemaRef)) {
    return throwHttpError(404, 'Not found');
  }
  return { ref: parsed.schemaRef, schema: registry.toJsonSchema(parsed.schemaRef) };
});

export const listWorkflowSchemaRefsAction = withAuth(async (user, { tenant }) => {
  initializeWorkflowRuntimeV2();
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);
  const registry = getSchemaRegistry();
  return { refs: registry.listRefs() };
});

export const searchWorkflowSchemaRefsAction = withAuth(async (user, { tenant }, input: unknown) => {
  initializeWorkflowRuntimeV2();
  const parsed = z
    .object({ query: z.string().trim().min(1), limit: z.number().int().min(1).max(500).optional() })
    .parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);
  const registry = getSchemaRegistry();
  const queryLower = parsed.query.toLowerCase();
  const matches = registry
    .listRefs()
    .filter((ref) => ref.toLowerCase().includes(queryLower))
    .slice(0, parsed.limit ?? 100);
  return { refs: matches };
});

export const listWorkflowSchemasMetaAction = withAuth(async (user, { tenant }) => {
  initializeWorkflowRuntimeV2();
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);
  const registry = getSchemaRegistry();
  const refs = registry.listRefs();
  const items = refs.map((ref) => {
    const schema = registry.toJsonSchema(ref) as any;
    return {
      ref,
      title: typeof schema?.title === 'string' ? schema.title : null,
      description: typeof schema?.description === 'string' ? schema.description : null
    };
  });
  return { schemas: items };
});

export const submitWorkflowEventAction = withAuth(async (user, { tenant }, input: unknown) => {
  initializeWorkflowRuntimeV2();
  const parsed = SubmitWorkflowEventInput.parse(input);

  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'manage', knex);
  let runId: string | null = null;
  let eventRecord: Awaited<ReturnType<typeof WorkflowRuntimeEventModelV2.create>> | null = null;
  let ingestionError: string | null = null;
  const processedAt = new Date().toISOString();
  const schemaRegistry = getSchemaRegistry();

  const catalogEntry = tenant ? await EventCatalogModel.getByEventType(knex, parsed.eventName, tenant) : null;
  const catalogSchemaRef = typeof (catalogEntry as any)?.payload_schema_ref === 'string'
    ? String((catalogEntry as any).payload_schema_ref)
    : null;
  const submissionSchemaRef = parsed.payloadSchemaRef ? String(parsed.payloadSchemaRef) : null;
  const sourcePayloadSchemaRef = submissionSchemaRef ?? catalogSchemaRef;
  const schemaRefConflict =
    submissionSchemaRef && catalogSchemaRef && submissionSchemaRef !== catalogSchemaRef
      ? { submission: submissionSchemaRef, catalog: catalogSchemaRef }
      : null;

  const resolvedPayload =
    sourcePayloadSchemaRef && tenant
      ? buildWorkflowPayload((parsed.payload ?? {}) as Record<string, unknown>, {
        tenantId: tenant,
        occurredAt: processedAt,
        actor: { actorType: 'USER', actorUserId: user.user_id },
      })
      : (parsed.payload ?? {});

  if (sourcePayloadSchemaRef && !schemaRegistry.has(sourcePayloadSchemaRef)) {
    await knex.transaction(async (trx) => {
      eventRecord = await WorkflowRuntimeEventModelV2.create(trx, {
        tenant_id: tenant,
        event_name: parsed.eventName,
        correlation_key: parsed.correlationKey,
        payload: resolvedPayload,
        payload_schema_ref: sourcePayloadSchemaRef,
        schema_ref_conflict: schemaRefConflict,
        processed_at: processedAt,
        error_message: `Unknown payload schema ref "${sourcePayloadSchemaRef}"`
      });
    });
    return throwHttpError(400, 'Unknown payload schema ref', { schemaRef: sourcePayloadSchemaRef });
  }

  if (sourcePayloadSchemaRef && !tenant) {
    await knex.transaction(async (trx) => {
      eventRecord = await WorkflowRuntimeEventModelV2.create(trx, {
        tenant_id: tenant,
        event_name: parsed.eventName,
        correlation_key: parsed.correlationKey,
        payload: resolvedPayload,
        payload_schema_ref: sourcePayloadSchemaRef,
        schema_ref_conflict: schemaRefConflict,
        processed_at: processedAt,
        error_message: 'Missing tenant context for schema-validated event ingestion'
      });
    });
    return throwHttpError(400, 'Missing tenant context', { schemaRef: sourcePayloadSchemaRef });
  }

  if (sourcePayloadSchemaRef) {
    const validation = schemaRegistry.get(sourcePayloadSchemaRef).safeParse(resolvedPayload);
    if (!validation.success) {
      const issues = validation.error.issues;
      const message = `Event payload failed schema validation (${sourcePayloadSchemaRef})`;
      await knex.transaction(async (trx) => {
        eventRecord = await WorkflowRuntimeEventModelV2.create(trx, {
          tenant_id: tenant,
          event_name: parsed.eventName,
          correlation_key: parsed.correlationKey,
          payload: resolvedPayload,
          payload_schema_ref: sourcePayloadSchemaRef,
          schema_ref_conflict: schemaRefConflict,
          processed_at: processedAt,
          error_message: message
        });
      });
      return throwHttpError(400, 'Invalid event payload', { schemaRef: sourcePayloadSchemaRef, issues });
    }
  }

  if (schemaRefConflict) {
    try {
      void analytics.capture('workflow.event.schema_ref_conflict', {
        eventType: parsed.eventName,
        submissionPayloadSchemaRef: schemaRefConflict.submission,
        catalogPayloadSchemaRef: schemaRefConflict.catalog
      }, user.user_id);
    } catch {
      // best-effort telemetry
    }
  }

  await knex.transaction(async (trx) => {
    eventRecord = await WorkflowRuntimeEventModelV2.create(trx, {
      tenant_id: tenant,
      event_name: parsed.eventName,
      correlation_key: parsed.correlationKey,
      payload: resolvedPayload,
      payload_schema_ref: sourcePayloadSchemaRef,
      schema_ref_conflict: schemaRefConflict,
      processed_at: processedAt
    });

    try {
      const wait = await WorkflowRunWaitModelV2.findEventWait(
        trx,
        parsed.eventName,
        parsed.correlationKey,
        tenant,
        ['event', 'human']
      );
      if (!wait) {
        return;
      }

      await WorkflowRunWaitModelV2.update(trx, wait.wait_id, {
        status: 'RESOLVED',
        resolved_at: new Date().toISOString()
      });

      await WorkflowRunModelV2.update(trx, wait.run_id, {
        status: 'RUNNING',
        resume_event_name: parsed.eventName,
        resume_event_payload: resolvedPayload
      });

      const stepRecord = await WorkflowRunStepModelV2.getLatestByRunAndPath(trx, wait.run_id, wait.step_path);
      await WorkflowRunLogModelV2.create(trx, {
        run_id: wait.run_id,
        tenant_id: tenant,
        step_id: stepRecord?.step_id ?? null,
        step_path: wait.step_path,
        level: 'INFO',
        message: 'Event wait resolved',
        correlation_key: parsed.correlationKey,
        event_name: parsed.eventName,
        context_json: {
          waitId: wait.wait_id
        },
        source: 'event'
      });

      await WorkflowRuntimeEventModelV2.update(trx, eventRecord.event_id, {
        matched_run_id: wait.run_id,
        matched_wait_id: wait.wait_id,
        matched_step_path: wait.step_path,
        processed_at: processedAt
      });

      runId = wait.run_id;
    } catch (error) {
      ingestionError = error instanceof Error ? error.message : String(error);
      if (eventRecord) {
        await WorkflowRuntimeEventModelV2.update(trx, eventRecord.event_id, {
          error_message: ingestionError,
          processed_at: processedAt
        });
      }
    }
  });

  if (ingestionError) {
    return throwHttpError(500, 'Failed to process workflow event', { error: ingestionError });
  }

  const runtime = new WorkflowRuntimeV2();
  if (runId) {
    await runtime.executeRun(knex, runId, `event-${Date.now()}`);
  }

  const triggered = await WorkflowDefinitionModelV2.list(knex);
  const matching = triggered.filter(
    (workflow) =>
      workflow.trigger?.eventName === parsed.eventName
      && workflow.status === 'published'
      && workflow.is_paused !== true
  );

  const startedRuns: string[] = [];
  for (const workflow of matching) {
    const versions = await WorkflowDefinitionVersionModelV2.listByWorkflow(knex, workflow.workflow_id);
    const latest = versions[0];
    if (!latest) continue;

    const latestDefinition = latest.definition_json as any;
    const workflowPayloadSchemaRef: string | null =
      (typeof latestDefinition?.payloadSchemaRef === 'string' ? latestDefinition.payloadSchemaRef : null)
      ?? (typeof workflow.payload_schema_ref === 'string' ? workflow.payload_schema_ref : null);

    const trigger = latestDefinition?.trigger ?? workflow.trigger ?? null;
    const overrideSourceSchemaRef = typeof trigger?.sourcePayloadSchemaRef === 'string' ? trigger.sourcePayloadSchemaRef : null;
    const effectiveSourceSchemaRef = overrideSourceSchemaRef ?? sourcePayloadSchemaRef;

    if (!effectiveSourceSchemaRef) {
      continue;
    }

    const payloadMapping = trigger?.payloadMapping as any | undefined;
    const mappingProvided = payloadMapping && typeof payloadMapping === 'object' && Object.keys(payloadMapping).length > 0;
    const refsMatch = !!workflowPayloadSchemaRef && effectiveSourceSchemaRef === workflowPayloadSchemaRef;
    if (!mappingProvided && !refsMatch) {
      continue;
    }

    let workflowPayload: Record<string, unknown> = (resolvedPayload ?? {}) as Record<string, unknown>;
    let mappingApplied = false;
    if (mappingProvided) {
      try {
        const provider = tenant ? createTenantSecretProvider(knex, tenant) : null;
        const secretResolver = provider
          ? createSecretResolverFromProvider((name, workflowRunId) => provider.getValue(name, workflowRunId))
          : undefined;
        const resolved = await resolveInputMapping(payloadMapping, {
          expressionContext: {
            event: {
              name: parsed.eventName,
              correlationKey: parsed.correlationKey,
              payload: resolvedPayload ?? {},
              payloadSchemaRef: effectiveSourceSchemaRef
            }
          },
          secretResolver
        });
        const flat = resolved ?? {};
        workflowPayload = expandDottedKeys(flat);
        mappingApplied = true;
      } catch (error) {
        continue;
      }
    }

    if (workflowPayloadSchemaRef && schemaRegistry.has(workflowPayloadSchemaRef)) {
      const validation = schemaRegistry.get(workflowPayloadSchemaRef).safeParse(workflowPayload);
      if (!validation.success) {
        continue;
      }
    }

    const newRunId = await runtime.startRun(knex, {
      workflowId: workflow.workflow_id,
      version: latest.version,
      payload: workflowPayload,
      tenantId: tenant,
      eventType: parsed.eventName,
      sourcePayloadSchemaRef: effectiveSourceSchemaRef,
      triggerMappingApplied: mappingApplied
    });
    startedRuns.push(newRunId);

    try {
      void analytics.capture('workflow.trigger.mapping_applied', {
        workflowId: workflow.workflow_id,
        workflowVersion: latest.version,
        eventType: parsed.eventName,
        workflowPayloadSchemaRef: workflowPayloadSchemaRef ?? null,
        sourcePayloadSchemaRef: effectiveSourceSchemaRef,
        triggerMappingApplied: mappingApplied,
        triggerMappingProvided: mappingProvided,
        schemaRefsMatch: refsMatch,
        startedFrom: 'event_ingestion'
      }, user.user_id);
    } catch {
      // best-effort telemetry
    }

    await runtime.executeRun(knex, newRunId, `event-${Date.now()}`);
  }

  return { status: runId ? 'resumed' : 'no_wait', runId, startedRuns, eventId: (eventRecord as any)?.event_id ?? null };
});

export const listWorkflowEventsAction = withAuth(async (user, { tenant }, input: unknown) => {
  const parsed = ListWorkflowEventsInput.parse(input ?? {});
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);

  const rows = await WorkflowRuntimeEventModelV2.list(knex, {
    tenantId: tenant ?? null,
    eventName: parsed.eventName,
    correlationKey: parsed.correlationKey,
    from: parsed.from,
    to: parsed.to,
    status: parsed.status,
    limit: parsed.limit,
    cursor: parsed.cursor
  });

  const hasMore = rows.length > parsed.limit;
  const events = hasMore ? rows.slice(0, parsed.limit) : rows;
  const nextCursor = hasMore ? parsed.cursor + parsed.limit : null;

  const sanitized = events.map((event) => ({
    ...event,
    payload: redactSensitiveValues(event.payload),
    status: event.error_message
      ? 'error'
      : event.matched_run_id
        ? 'matched'
        : 'unmatched'
  }));

  return { events: sanitized, nextCursor };
});

export const listWorkflowEventsPagedAction = withAuth(async (user, { tenant }, input: unknown) => {
  const parsed = ListWorkflowEventsPagedInput.parse(input ?? {});
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);

  const query = knex('workflow_runtime_events').select(
    'event_id',
    'tenant_id',
    'event_name',
    'correlation_key',
    'payload',
    'payload_schema_ref',
    'schema_ref_conflict',
    'created_at',
    'processed_at',
    'matched_run_id',
    'matched_wait_id',
    'matched_step_path',
    'error_message'
  );

  if (tenant) {
    query.where('tenant_id', tenant);
  }
  if (parsed.eventName) {
    query.where('event_name', parsed.eventName);
  }
  if (parsed.correlationKey) {
    query.where('correlation_key', parsed.correlationKey);
  }
  if (parsed.from) {
    query.where('created_at', '>=', parsed.from);
  }
  if (parsed.to) {
    query.where('created_at', '<=', parsed.to);
  }
  if (parsed.status && parsed.status !== 'all') {
    if (parsed.status === 'matched') {
      query.whereNotNull('matched_run_id');
    }
    if (parsed.status === 'unmatched') {
      query.whereNull('matched_run_id').whereNull('error_message');
    }
    if (parsed.status === 'error') {
      query.whereNotNull('error_message');
    }
  }

  const [{ count }] = await query
    .clone()
    .clearSelect()
    .clearOrder()
    .count('* as count') as unknown as Array<{ count: string | number }>;
  const totalItems = Number(count ?? 0);

  const sortBy = parsed.sortBy ?? 'created_at';
  const sortDirection = parsed.sortDirection ?? 'desc';

  if (sortBy === 'status') {
    query.orderByRaw(
      `case when error_message is not null then 2 when matched_run_id is not null then 1 else 0 end ${sortDirection}`
    );
  } else {
    query.orderBy(sortBy, sortDirection);
  }
  query.orderBy('event_id', 'desc');

  const offset = (parsed.page - 1) * parsed.pageSize;
  const rows = await query.limit(parsed.pageSize).offset(offset);

  const items = rows.map((event: any) => ({
    ...event,
    payload: redactSensitiveValues(event.payload),
    status: event.error_message
      ? 'error'
      : event.matched_run_id
        ? 'matched'
        : 'unmatched'
  }));

  return { items, totalItems };
});

export async function exportWorkflowEventsAction(input: unknown) {
  const rawInput = (input ?? {}) as Record<string, unknown>;
  const format = String(rawInput.format ?? 'csv').toLowerCase() === 'json' ? 'json' : 'csv';
  const result = await listWorkflowEventsAction({
    ...rawInput,
    limit: rawInput.limit ?? EXPORT_EVENTS_LIMIT,
    cursor: 0
  });

  if (format === 'json') {
    return {
      body: JSON.stringify(result.events, null, 2),
      contentType: 'application/json',
      filename: 'workflow-events.json'
    };
  }

  const headers = [
    'event_id',
    'event_name',
    'correlation_key',
    'payload_schema_ref',
    'schema_ref_conflict',
    'status',
    'matched_run_id',
    'matched_wait_id',
    'matched_step_path',
    'error_message',
    'created_at',
    'processed_at',
    'payload'
  ];

  const rows = result.events.map((event: any) => [
    event.event_id,
    event.event_name,
    event.correlation_key ?? '',
    event.payload_schema_ref ?? '',
    event.schema_ref_conflict ? JSON.stringify(event.schema_ref_conflict) : '',
    event.status,
    event.matched_run_id ?? '',
    event.matched_wait_id ?? '',
    event.matched_step_path ?? '',
    event.error_message ?? '',
    event.created_at,
    event.processed_at ?? '',
    event.payload ? JSON.stringify(event.payload) : ''
  ]);

  return {
    body: buildCsv(headers, rows),
    contentType: 'text/csv',
    filename: 'workflow-events.csv'
  };
}

export const listWorkflowEventSummaryAction = withAuth(async (user, { tenant }, input: unknown) => {
  const parsed = ListWorkflowEventsInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);

  const query = knex('workflow_runtime_events')
    .select(
      knex.raw('count(*) as total'),
      knex.raw('count(case when matched_run_id is not null then 1 end) as matched'),
      knex.raw("count(case when matched_run_id is null and error_message is null then 1 end) as unmatched"),
      knex.raw('count(case when error_message is not null then 1 end) as error')
    );

  if (tenant) {
    query.where('tenant_id', tenant);
  }
  if (parsed.eventName) {
    query.where('event_name', parsed.eventName);
  }
  if (parsed.correlationKey) {
    query.where('correlation_key', parsed.correlationKey);
  }
  if (parsed.from) {
    query.where('created_at', '>=', parsed.from);
  }
  if (parsed.to) {
    query.where('created_at', '<=', parsed.to);
  }

  const row = await query.first() as unknown as { total: string | number; matched: string | number; unmatched: string | number; error: string | number } | undefined;
  return {
    total: Number(row?.total ?? 0),
    matched: Number(row?.matched ?? 0),
    unmatched: Number(row?.unmatched ?? 0),
    error: Number(row?.error ?? 0)
  };
});

export const getWorkflowEventAction = withAuth(async (user, { tenant }, input: unknown) => {
  const parsed = EventIdInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);

  const event = await WorkflowRuntimeEventModelV2.getById(knex, parsed.eventId);
  if (!event) {
    return throwHttpError(404, 'Event not found');
  }
  if (tenant && event.tenant_id && event.tenant_id !== tenant) {
    return throwHttpError(404, 'Event not found');
  }

  const wait = event.matched_wait_id
    ? await knex('workflow_run_waits').where({ wait_id: event.matched_wait_id }).first()
    : null;
  const run = event.matched_run_id ? await WorkflowRunModelV2.getById(knex, event.matched_run_id) : null;

  return {
    event: {
      ...event,
      payload: redactSensitiveValues(event.payload),
      status: event.error_message
        ? 'error'
        : event.matched_run_id
          ? 'matched'
          : 'unmatched'
    },
    wait,
    run
  };
});
