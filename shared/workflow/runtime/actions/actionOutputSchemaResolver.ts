import { zodToJsonSchema } from 'zod-to-json-schema';

import { isWorkflowAiInferAction, resolveWorkflowAiSchemaFromConfig } from '../ai/aiSchema';
import {
  isWorkflowComposeTextAction,
  resolveComposeTextOutputSchemaFromConfig,
} from './composeText';
import type { ActionRegistry } from '../registries/actionRegistry';

export const resolveActionCallOutputSchema = (
  registry: ActionRegistry,
  config: {
    actionId?: string | null;
    version?: number | null;
    [key: string]: unknown;
  } | null | undefined
): Record<string, unknown> | null => {
  const actionId = typeof config?.actionId === 'string' ? config.actionId : null;
  if (!actionId) return null;

  if (isWorkflowAiInferAction(actionId)) {
    return (resolveWorkflowAiSchemaFromConfig(config).schema as Record<string, unknown> | null) ?? null;
  }

  if (isWorkflowComposeTextAction(actionId)) {
    const resolved = resolveComposeTextOutputSchemaFromConfig(config);
    if (resolved) return resolved;
  }

  const version = typeof config?.version === 'number' ? config.version : 1;
  const defn = registry.get(actionId, version);
  return defn?.outputSchema
    ? (zodToJsonSchema(defn.outputSchema, { name: `${actionId}@${version}.output` }) as Record<string, unknown>)
    : null;
};
