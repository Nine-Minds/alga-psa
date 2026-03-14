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
  'x-workflow-editor'?: {
    kind?: string;
    inline?: {
      mode?: string;
    };
    dialog?: {
      mode?: 'large-text';
    };
  };
};

type ActionRegistryLike = {
  id: string;
  version: number;
  inputSchema: JsonSchema;
};

const applyAiInferPromptPresentationHint = (schema: JsonSchema): JsonSchema => {
  const applyToPromptProperty = (target: JsonSchema): JsonSchema => {
    const properties = target.properties;
    if (!properties || !properties.prompt) {
      return target;
    }

    const currentEditor = properties.prompt['x-workflow-editor'];
    if (currentEditor?.kind === 'text') {
      return target;
    }

    return {
      ...target,
      properties: {
        ...properties,
        prompt: {
          ...properties.prompt,
          'x-workflow-editor': {
            kind: 'text',
            inline: { mode: 'textarea' },
            dialog: { mode: 'large-text' },
          },
        },
      },
    };
  };

  if (schema.properties?.prompt) {
    return applyToPromptProperty(schema);
  }

  if (schema.$ref?.startsWith('#/definitions/') && schema.definitions) {
    const refKey = schema.$ref.replace('#/definitions/', '');
    const referenced = schema.definitions[refKey];
    if (!referenced) {
      return schema;
    }

    return {
      ...schema,
      definitions: {
        ...schema.definitions,
        [refKey]: applyToPromptProperty(referenced),
      },
    };
  }

  return schema;
};

export const applyWorkflowActionPresentationHints = <T extends ActionRegistryLike>(action: T): T => {
  if (action.id !== 'ai.infer' || action.version !== 1) {
    return action;
  }

  return {
    ...action,
    inputSchema: applyAiInferPromptPresentationHint(action.inputSchema),
  };
};

export const applyWorkflowActionPresentationHintsToList = <T extends ActionRegistryLike>(
  actions: T[]
): T[] => actions.map((action) => applyWorkflowActionPresentationHints(action));
