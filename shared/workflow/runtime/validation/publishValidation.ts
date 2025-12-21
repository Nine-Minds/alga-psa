import { z } from 'zod';
import type { WorkflowDefinition, PublishError, Step, NodeStep } from '../types';
import { workflowDefinitionSchema } from '../types';
import { getNodeTypeRegistry } from '../registries/nodeTypeRegistry';
import { getActionRegistryV2 } from '../registries/actionRegistry';
import { validateExpressionSource } from '../expressionEngine';

export type PublishValidationResult = {
  ok: boolean;
  errors: PublishError[];
  warnings: PublishError[];
};

export function validateWorkflowDefinition(definition: WorkflowDefinition, payloadSchemaJson?: Record<string, unknown>): PublishValidationResult {
  const errors: PublishError[] = [];
  const warnings: PublishError[] = [];

  try {
    workflowDefinitionSchema.parse(definition);
  } catch (error) {
    if (error instanceof z.ZodError) {
      for (const issue of error.issues) {
        errors.push({
          severity: 'error',
          stepPath: 'root',
          code: 'INVALID_WORKFLOW_DEFINITION',
          message: issue.message
        });
      }
    } else {
      errors.push({
        severity: 'error',
        stepPath: 'root',
        code: 'INVALID_WORKFLOW_DEFINITION',
        message: 'Workflow definition failed schema validation'
      });
    }
  }

  try {
    JSON.stringify(definition);
  } catch (error) {
    errors.push({
      severity: 'error',
      stepPath: 'root',
      code: 'NON_SERIALIZABLE',
      message: 'Workflow definition is not JSON-serializable'
    });
  }

  const stepIds = new Set<string>();
  const nodeRegistry = getNodeTypeRegistry();
  const actionRegistry = getActionRegistryV2();

  if (!Array.isArray(definition.steps)) {
    return {
      ok: errors.length === 0,
      errors,
      warnings
    };
  }

  const visitSteps = (steps: Step[], prefix: string) => {
    steps.forEach((step, index) => {
      const stepPath = `${prefix}.steps[${index}]`;

      if (stepIds.has(step.id)) {
        errors.push({
          severity: 'error',
          stepPath,
          stepId: step.id,
          code: 'DUPLICATE_STEP_ID',
          message: `Duplicate step id ${step.id}`
        });
      } else {
        stepIds.add(step.id);
      }

      if (step.type === 'control.if') {
        const ifStep = step as Step & { type: 'control.if'; condition: { $expr: string }; then: Step[]; else?: Step[] };
        validateExpr(ifStep.condition, stepPath, step.id, errors);
        visitSteps(ifStep.then, `${stepPath}.then`);
        if (ifStep.else) {
          visitSteps(ifStep.else, `${stepPath}.else`);
        }
        return;
      }

      if (step.type === 'control.forEach') {
        const forEachStep = step as Step & { type: 'control.forEach'; items: { $expr: string }; body: Step[] };
        validateExpr(forEachStep.items, stepPath, step.id, errors);
        visitSteps(forEachStep.body, `${stepPath}.body`);
        return;
      }

      if (step.type === 'control.tryCatch') {
        const tryCatchStep = step as Step & { type: 'control.tryCatch'; try: Step[]; catch: Step[] };
        visitSteps(tryCatchStep.try, `${stepPath}.try`);
        visitSteps(tryCatchStep.catch, `${stepPath}.catch`);
        return;
      }

      if (step.type === 'control.callWorkflow') {
        const callStep = step as Step & { type: 'control.callWorkflow'; inputMapping?: Record<string, { $expr: string }>; outputMapping?: Record<string, { $expr: string }> };
        if (callStep.inputMapping) {
          Object.values(callStep.inputMapping).forEach((expr) => validateExpr(expr, stepPath, step.id, errors));
        }
        if (callStep.outputMapping) {
          Object.values(callStep.outputMapping).forEach((expr) => validateExpr(expr, stepPath, step.id, errors));
        }
        return;
      }

      if (step.type === 'control.return') {
        return;
      }

      validateNodeStep(step, stepPath, errors, warnings, payloadSchemaJson, nodeRegistry, actionRegistry);
    });
  };

  visitSteps(definition.steps, 'root');

  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}

function validateExpr(expr: { $expr: string }, stepPath: string, stepId: string, errors: PublishError[]) {
  try {
    validateExpressionSource(expr.$expr);
  } catch (error) {
    errors.push({
      severity: 'error',
      stepPath,
      stepId,
      code: 'INVALID_EXPR',
      message: error instanceof Error ? error.message : 'Invalid expression'
    });
  }
}

function validateNodeStep(
  step: NodeStep,
  stepPath: string,
  errors: PublishError[],
  warnings: PublishError[],
  payloadSchemaJson: Record<string, unknown> | undefined,
  nodeRegistry: ReturnType<typeof getNodeTypeRegistry>,
  actionRegistry: ReturnType<typeof getActionRegistryV2>
) {
  const nodeType = nodeRegistry.get(step.type);
  if (!nodeType) {
    errors.push({
      severity: 'error',
      stepPath,
      stepId: step.id,
      code: 'UNKNOWN_NODE_TYPE',
      message: `Unknown node type: ${step.type}`
    });
    return;
  }

  if (step.config) {
    const result = nodeType.configSchema.safeParse(step.config);
    if (!result.success) {
      errors.push({
        severity: 'error',
        stepPath,
        stepId: step.id,
        code: 'INVALID_CONFIG',
        message: result.error.issues.map((issue) => issue.message).join('; ')
      });
    }

    collectExprs(step.config).forEach((expr) => validateExpr(expr, stepPath, step.id, errors));

    if (step.type === 'action.call') {
      const config = step.config as { actionId?: string; version?: number };
      if (!config || !config.actionId || !config.version) {
        errors.push({
          severity: 'error',
          stepPath,
          stepId: step.id,
          code: 'INVALID_ACTION_CONFIG',
          message: 'action.call requires actionId and version'
        });
      } else if (!actionRegistry.get(config.actionId, config.version)) {
        errors.push({
          severity: 'error',
          stepPath,
          stepId: step.id,
          code: 'UNKNOWN_ACTION',
          message: `Unknown action ${config.actionId}@${config.version}`
        });
      }
    }

    if (step.type === 'transform.assign') {
      const config = step.config as { assign?: Record<string, { $expr: string }> };
      if (config?.assign) {
        for (const path of Object.keys(config.assign)) {
          validateAssignmentPath(path, stepPath, step.id, errors);
        }
      }
      if (config?.assign && payloadSchemaJson) {
        for (const path of Object.keys(config.assign)) {
          if (!isAllowedAssignPath(path, payloadSchemaJson)) {
            warnings.push({
              severity: 'warning',
              stepPath,
              stepId: step.id,
              code: 'ASSIGN_PATH_UNKNOWN',
              message: `Assign path may be invalid: ${path}`
            });
          }
        }
      }
    }

    if (step.type === 'event.wait') {
      const config = step.config as { assign?: Record<string, { $expr: string }> };
      if (config?.assign) {
        for (const path of Object.keys(config.assign)) {
          validateAssignmentPath(path, stepPath, step.id, errors);
        }
      }
    }
  }
}

function collectExprs(value: unknown): Array<{ $expr: string }> {
  const exprs: Array<{ $expr: string }> = [];
  if (!value) return exprs;

  if (Array.isArray(value)) {
    value.forEach((item) => exprs.push(...collectExprs(item)));
    return exprs;
  }

  if (typeof value === 'object') {
    if ('$expr' in (value as Record<string, unknown>)) {
      exprs.push(value as { $expr: string });
      return exprs;
    }
    Object.values(value as Record<string, unknown>).forEach((val) => exprs.push(...collectExprs(val)));
  }

  return exprs;
}

function isAllowedAssignPath(path: string, payloadSchemaJson: Record<string, unknown>): boolean {
  if (!path) return false;
  if (path.startsWith('vars.') || path.startsWith('meta.') || path.startsWith('error.')) {
    return true;
  }
  if (path.startsWith('payload.')) {
    return pathExistsInSchema(path.replace(/^payload\./, ''), payloadSchemaJson);
  }
  if (path.startsWith('/')) {
    return pathExistsInSchema(path.replace(/^\//, ''), payloadSchemaJson);
  }
  return true;
}

function validateAssignmentPath(path: string, stepPath: string, stepId: string, errors: PublishError[]): void {
  if (!path || typeof path !== 'string') {
    errors.push({
      severity: 'error',
      stepPath,
      stepId,
      code: 'INVALID_ASSIGN_PATH',
      message: 'Assignment path must be a non-empty string'
    });
    return;
  }
  const allowed = path.startsWith('payload.')
    || path.startsWith('vars.')
    || path.startsWith('meta.')
    || path.startsWith('error.')
    || path.startsWith('/');
  if (!allowed) {
    errors.push({
      severity: 'error',
      stepPath,
      stepId,
      code: 'INVALID_ASSIGN_PATH',
      message: `Assignment path must be scoped (payload/vars/meta/error or JSON pointer): ${path}`
    });
    return;
  }

  const segments = path.replace(/^\/?/, '').split(/[./]/).filter(Boolean);
  const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
  for (const segment of segments) {
    if (forbidden.has(segment)) {
      errors.push({
        severity: 'error',
        stepPath,
        stepId,
        code: 'INVALID_ASSIGN_PATH',
        message: `Assignment path contains forbidden segment: ${segment}`
      });
      return;
    }
  }
}

function pathExistsInSchema(path: string, payloadSchemaJson: Record<string, unknown>): boolean {
  if (!path) return true;
  const parts = path.split('.').filter(Boolean);
  let cursor: any = payloadSchemaJson;
  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object') return false;
    const properties = (cursor as any).properties;
    if (!properties || typeof properties !== 'object' || !(part in properties)) {
      return false;
    }
    cursor = properties[part];
  }
  return true;
}
