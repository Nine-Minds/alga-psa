import { z } from 'zod';
import { getNodeTypeRegistry } from '../registries/nodeTypeRegistry';
import { exprSchema, inputMappingSchema } from '../types';
import { resolveExpressions } from '../utils/expressionResolver';
import { resolveInputMapping, noOpSecretResolver } from '../utils/mappingResolver';
import { applyAssignments } from '../utils/assignmentUtils';
import type { Envelope, InputMapping } from '../types';
import { safeSerialize } from '../utils/redactionUtils';
import { parseEmailBodyWithFallback, renderCommentBlocksWithFallback } from './utils/emailNodes';
import { getFormValidationService } from '../../core/formValidationService';

function normalizeAssignmentPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return trimmed;

  const scoped = trimmed.startsWith('payload.')
    || trimmed.startsWith('vars.')
    || trimmed.startsWith('meta.')
    || trimmed.startsWith('error.')
    || trimmed.startsWith('/');

  // For backwards compatibility with the Workflow Designer, treat unscoped values
  // as a variable name under `vars.*`.
  return scoped ? trimmed : `vars.${trimmed}`;
}

const stateSetSchema = z.object({
  state: z.string().min(1)
}).strict();

const eventWaitSchema = z.object({
  eventName: z.string().min(1),
  correlationKey: exprSchema,
  timeoutMs: z.number().int().positive().optional(),
  assign: z.record(exprSchema).optional()
}).strict();

const transformAssignSchema = z.object({
  assign: z.record(exprSchema)
}).strict();

const actionCallSchema = z.object({
  actionId: z.string().min(1),
  version: z.number().int().positive(),
  inputMapping: inputMappingSchema.optional().default({}),
  saveAs: z.string().optional(),
  onError: z.object({
    policy: z.enum(['fail', 'continue'])
  }).optional(),
  idempotencyKey: exprSchema.optional()
}).strict();

const emailParseBodySchema = z.object({
  text: exprSchema.optional(),
  html: exprSchema.optional(),
  saveAs: z.string().optional().default('payload.parsedEmail')
}).strict();

const emailRenderCommentBlocksSchema = z.object({
  html: exprSchema.optional(),
  text: exprSchema.optional(),
  saveAs: z.string().optional().default('payload.commentBlocks')
}).strict();

const humanTaskSchema = z.object({
  taskType: z.string().min(1),
  title: exprSchema,
  description: exprSchema.optional(),
  contextData: z.record(exprSchema).optional(),
  assign: z.record(exprSchema).optional()
}).strict();

export function registerDefaultNodes(): void {
  const registry = getNodeTypeRegistry();

  registry.register({
    id: 'state.set',
    configSchema: stateSetSchema,
    handler: async (env: Envelope, config: { state: string }) => {
      return {
        ...env,
        meta: {
          ...env.meta,
          state: config.state
        }
      };
    },
    ui: {
      label: 'Set State',
      category: 'Core',
      description: 'Update the workflow state'
    }
  });

  registry.register({
    id: 'event.wait',
    configSchema: eventWaitSchema,
    handler: async (env, config, ctx) => {
      if (ctx.resumeError) {
        throw { category: 'TimeoutError', message: ctx.resumeError.message || 'Timeout waiting for event' };
      }
      if (!ctx.resumeEvent) {
        const correlation = await resolveExpressions(config.correlationKey, {
          payload: env.payload,
          vars: env.vars,
          meta: env.meta,
          error: env.error
        });
        const timeoutAt = config.timeoutMs ? new Date(Date.now() + config.timeoutMs).toISOString() : undefined;
        await ctx.publishWait({
          type: 'event',
          key: String(correlation ?? ''),
          eventName: config.eventName,
          timeoutAt
        });
        return { type: 'wait' } as const;
      }

      env.vars.event = ctx.resumeEvent.payload;
      env.vars.eventName = ctx.resumeEvent.name;

      if (config.assign) {
        const resolvedAssign: Record<string, unknown> = {};
        for (const [path, expr] of Object.entries(config.assign)) {
          resolvedAssign[path] = await resolveExpressions(expr, {
            payload: env.payload,
            vars: env.vars,
            meta: env.meta,
            error: env.error
          });
        }
        env = applyAssignments(env, resolvedAssign);
      }
      return env;
    },
    ui: {
      label: 'Wait for Event',
      category: 'Core',
      description: 'Wait for an external event'
    }
  });

  registry.register({
    id: 'transform.assign',
    configSchema: transformAssignSchema,
    handler: async (env, config) => {
      const resolvedAssign: Record<string, unknown> = {};
      for (const [path, expr] of Object.entries(config.assign)) {
        resolvedAssign[path] = await resolveExpressions(expr, {
          payload: env.payload,
          vars: env.vars,
          meta: env.meta,
          error: env.error
        });
      }
      return applyAssignments(env, resolvedAssign);
    },
    ui: {
      label: 'Assign',
      category: 'Transform',
      description: 'Assign values into payload or vars'
    }
  });

  registry.register({
    id: 'action.call',
    configSchema: actionCallSchema,
    handler: async (env, config, ctx) => {
      try {
        const exprContext = ctxToExpr(env);
        let resolvedArgs: unknown;

        // Resolve inputMapping to action arguments
        const redactionPaths: string[] = [];
        resolvedArgs = await resolveInputMapping(config.inputMapping ?? {}, {
          expressionContext: exprContext,
          secretResolver: ctx.secretResolver ?? noOpSecretResolver,
          workflowRunId: ctx.runId,
          redactionPaths
        });

        // Add resolved secret paths to envelope meta for redaction
        if (redactionPaths.length > 0 && env.meta.redactions) {
          env.meta.redactions.push(...redactionPaths.map(p => `args${p}`));
        } else if (redactionPaths.length > 0) {
          env.meta.redactions = redactionPaths.map(p => `args${p}`);
        }

        const idempotencyKey = config.idempotencyKey
          ? String(await resolveExpressions(config.idempotencyKey, exprContext))
          : undefined;

        const output = await ctx.actions.call(config.actionId, config.version, resolvedArgs, { idempotencyKey });
        if (config.saveAs) {
          return applyAssignments(env, {
            [normalizeAssignmentPath(config.saveAs)]: output
          });
        }
        return env;
      } catch (error: any) {
        // Preserve structured runtime errors if they already match our shape.
        if (typeof error === 'object' && error !== null && 'category' in error) {
          throw error;
        }
        let raw: unknown;
        try {
          raw = safeSerialize(error);
        } catch {
          raw = String(error);
        }
        throw {
          category: 'ActionError',
          code: 'INTERNAL_ERROR',
          message: 'action.call failed',
          details: error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : { raw },
          nodePath: ctx.stepPath,
          at: new Date().toISOString()
        };
      }
    },
    ui: {
      label: 'Call Action',
      category: 'Action',
      description: 'Invoke a registered action'
    }
  });

  registry.register({
    id: 'email.parseBody',
    configSchema: emailParseBodySchema,
    handler: async (env, config, ctx) => {
      const textValue = config.text ? await resolveExpressions(config.text, ctxToExpr(env)) : undefined;
      const htmlValue = config.html ? await resolveExpressions(config.html, ctxToExpr(env)) : undefined;
      const text = textValue === null || textValue === undefined ? undefined : String(textValue);
      const html = htmlValue === null || htmlValue === undefined ? undefined : String(htmlValue);
      const parsed = await parseEmailBodyWithFallback(ctx.actions.call, { text, html });
      return applyAssignments(env, {
        [config.saveAs ? normalizeAssignmentPath(config.saveAs) : 'payload.parsedEmail']: parsed
      });
    },
    ui: {
      label: 'Parse Email Body',
      category: 'Email',
      description: 'Parse and sanitize email reply body'
    }
  });

  registry.register({
    id: 'email.renderCommentBlocks',
    configSchema: emailRenderCommentBlocksSchema,
    handler: async (env, config, ctx) => {
      const textValue = config.text ? await resolveExpressions(config.text, ctxToExpr(env)) : undefined;
      const htmlValue = config.html ? await resolveExpressions(config.html, ctxToExpr(env)) : undefined;
      const text = textValue === null || textValue === undefined ? undefined : String(textValue);
      const html = htmlValue === null || htmlValue === undefined ? undefined : String(htmlValue);
      const blocks = await renderCommentBlocksWithFallback(ctx.actions.call, { html, text });
      return applyAssignments(env, {
        [config.saveAs ? normalizeAssignmentPath(config.saveAs) : 'payload.commentBlocks']: blocks
      });
    },
    ui: {
      label: 'Render Comment Blocks',
      category: 'Email',
      description: 'Render comment blocks from email content'
    }
  });

  registry.register({
    id: 'human.task',
    configSchema: humanTaskSchema,
    handler: async (env, config, ctx) => {
      if (!ctx.resumeEvent) {
        const title = await resolveExpressions(config.title, ctxToExpr(env));
        const description = config.description ? await resolveExpressions(config.description, ctxToExpr(env)) : undefined;
        const contextData: Record<string, unknown> = {};
        if (config.contextData) {
          for (const [key, expr] of Object.entries(config.contextData)) {
            contextData[key] = await resolveExpressions(expr, ctxToExpr(env));
          }
        }
        const { default: WorkflowTaskModel, WorkflowTaskStatus } = await import('../../persistence/workflowTaskModel');
        const { getAdminConnection } = await import('@alga-psa/shared/db/admin');
        const knex = ctx.knex ?? await getAdminConnection();
        const taskId = await WorkflowTaskModel.createTask(knex, ctx.tenantId ?? '', {
          execution_id: ctx.runId,
          task_definition_type: 'system',
          system_task_definition_task_type: config.taskType,
          title: String(title),
          description: description ? String(description) : '',
          status: WorkflowTaskStatus.PENDING,
          priority: 'medium',
          context_data: contextData
        } as any);

        const formSchema = await resolveTaskFormSchema(knex, ctx.tenantId ?? null, config.taskType);
        await ctx.publishWait({
          type: 'human',
          key: taskId,
          eventName: 'HUMAN_TASK_COMPLETED',
          payload: {
            taskId,
            contextData,
            formSchema
          }
        });
        return { type: 'wait' } as const;
      }

      if (ctx.resumeEvent) {
        const responsePayload = ctx.resumeEvent.payload ?? {};
        const isAdminOverride = ctx.resumeEvent.name === 'ADMIN_RESUME'
          || (typeof responsePayload === 'object'
            && responsePayload !== null
            && '__admin_override' in responsePayload);
        if (!isAdminOverride) {
          const { getAdminConnection } = await import('@alga-psa/shared/db/admin');
          const knex = ctx.knex ?? await getAdminConnection();
          const formSchema = await resolveTaskFormSchema(knex, ctx.tenantId ?? null, config.taskType);
          if (!formSchema?.schema) {
            throw {
              category: 'ValidationError',
              message: `Missing form schema for task type ${config.taskType}`,
              nodePath: ctx.stepPath,
              at: new Date().toISOString()
            };
          }
          const validation = getFormValidationService().validate(formSchema.schema as Record<string, any>, responsePayload as Record<string, any>);
          if (!validation.valid) {
            throw {
              category: 'ValidationError',
              message: `Human task response validation failed: ${JSON.stringify(validation.errors ?? [])}`,
              nodePath: ctx.stepPath,
              at: new Date().toISOString()
            };
          }
        }

        env.vars.event = responsePayload;
        env.vars.eventName = ctx.resumeEvent.name;
      }

      if (config.assign && ctx.resumeEvent) {
        const resolvedAssign: Record<string, unknown> = {};
        for (const [path, expr] of Object.entries(config.assign)) {
          resolvedAssign[path] = await resolveExpressions(expr, ctxToExpr(env));
        }
        env = applyAssignments(env, resolvedAssign);
      }
      return env;
    },
    ui: {
      label: 'Human Task',
      category: 'Core',
      description: 'Pause for human task completion'
    }
  });
}

function ctxToExpr(env: Envelope) {
  return {
    payload: env.payload,
    vars: env.vars,
    meta: env.meta,
    error: env.error
  };
}

async function resolveTaskFormSchema(
  knex: any,
  tenantId: string | null,
  taskType: string
): Promise<{ formId: string; formType: string; schema: Record<string, unknown> | null } | null> {
  if (!taskType) return null;
  const systemTask = await knex('system_workflow_task_definitions')
    .where({ task_type: taskType })
    .first();
  if (systemTask) {
    const formId = systemTask.form_id as string;
    const formType = systemTask.form_type ?? 'system';
    if (formType === 'system') {
      const form = await knex('system_workflow_form_definitions')
        .where({ name: formId })
        .first();
      return {
        formId,
        formType,
        schema: form?.json_schema ?? null
      };
    }
  }

  if (tenantId) {
    const tenantTask = await knex('workflow_task_definitions')
      .where({ tenant: tenantId, name: taskType })
      .first();
    if (tenantTask) {
      const formId = tenantTask.form_id as string;
      const formType = tenantTask.form_type ?? 'tenant';
      if (formType === 'tenant') {
        const formSchema = await knex('workflow_form_schemas')
          .where({ tenant: tenantId, form_id: formId })
          .first();
        return {
          formId,
          formType,
          schema: formSchema?.json_schema ?? null
        };
      }
    }
  }

  return null;
}
