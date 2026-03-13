import type { ExpressionContext } from './expression-editor';
import { inferTypeFromJsonSchema } from './mapping/typeCompatibility';
import type { WorkflowDataContext } from './mapping/MappingPanel';
import type { JsonSchema } from './workflowDataContext';

export const buildWorkflowReferenceSourceTypeLookup = (
  ctx: WorkflowDataContext,
  payloadRootPath: string
): Map<string, string> => {
  const map = new Map<string, string>();

  const addField = (
    field: WorkflowDataContext['payload'][number],
    basePath: string
  ) => {
    const path = basePath ? `${basePath}.${field.name}` : field.name;
    if (field.type) {
      map.set(path, field.type);
    }
    field.children?.forEach((child) => addField(child, path));
  };

  ctx.payload.forEach((field) => addField(field, payloadRootPath));
  ctx.steps.forEach((stepOutput) => {
    const basePath = `vars.${stepOutput.saveAs}`;
    const outputType = inferTypeFromJsonSchema(stepOutput.outputSchema as JsonSchema);
    if (outputType) {
      map.set(basePath, outputType);
    } else {
      const isAssignedVar = stepOutput.stepId.includes(':');
      if (!isAssignedVar) {
        map.set(basePath, 'object');
      }
    }

    stepOutput.fields.forEach((field) => addField(field, basePath));
  });

  ctx.globals.meta.forEach((field) => addField(field, 'meta'));

  if (ctx.inCatchBlock) {
    ctx.globals.error.forEach((field) => addField(field, 'error'));
  }

  if (ctx.forEach?.itemVar) {
    map.set(ctx.forEach.itemVar, ctx.forEach.itemType ?? 'any');
  }
  if (ctx.forEach?.indexVar) {
    map.set(ctx.forEach.indexVar, 'number');
  }

  return map;
};

export const buildWorkflowReferenceExpressionContext = (
  ctx: WorkflowDataContext
): ExpressionContext => {
  const varsProperties: Record<string, JsonSchema> = {};
  for (const stepOutput of ctx.steps) {
    varsProperties[stepOutput.saveAs] = stepOutput.outputSchema as JsonSchema;
  }

  const varsSchema: JsonSchema | undefined =
    Object.keys(varsProperties).length > 0
      ? { type: 'object', properties: varsProperties }
      : undefined;

  const metaSchema: JsonSchema = {
    type: 'object',
    properties: {
      state: { type: 'string', description: 'Workflow state' },
      traceId: { type: 'string', description: 'Trace ID' },
      tags: { type: 'object', description: 'Workflow tags' },
    },
  };

  const errorSchema: JsonSchema | undefined = ctx.inCatchBlock
    ? {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Error name' },
          message: { type: 'string', description: 'Error message' },
          stack: { type: 'string', description: 'Stack trace' },
          nodePath: { type: 'string', description: 'Error location in workflow' },
        },
      }
    : undefined;

  return {
    payloadSchema: ctx.payloadSchema as JsonSchema | undefined,
    varsSchema,
    metaSchema,
    errorSchema,
    inCatchBlock: ctx.inCatchBlock,
    forEachItemVar: ctx.forEach?.itemVar,
    forEachIndexVar: ctx.forEach?.indexVar,
  };
};
