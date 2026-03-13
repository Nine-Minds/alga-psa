import type { SelectOption } from '@alga-psa/ui/components/CustomSelect';

import type { DataContext, JsonSchema } from './workflowDataContext';

const resolveSchema = (schema: JsonSchema, root?: JsonSchema): JsonSchema => {
  if (schema.$ref && root?.definitions) {
    const refKey = schema.$ref.replace('#/definitions/', '');
    const resolved = root.definitions?.[refKey];
    if (resolved) {
      return resolveSchema(resolved, root);
    }
  }

  if (schema.anyOf?.length) {
    const nonNullVariant = schema.anyOf.find(
      (variant) =>
        variant.type !== 'null' &&
        !(Array.isArray(variant.type) && variant.type.length === 1 && variant.type[0] === 'null')
    );
    if (nonNullVariant) {
      const resolved = resolveSchema(nonNullVariant, root);
      return {
        ...resolved,
        type: Array.isArray(resolved.type)
          ? resolved.type
          : resolved.type
            ? [resolved.type, 'null']
            : ['null'],
      };
    }
  }

  return schema;
};

const normalizeSchemaType = (schema?: JsonSchema): string | undefined => {
  if (!schema?.type) return undefined;
  if (Array.isArray(schema.type)) {
    return schema.type.find((type) => type !== 'null') ?? schema.type[0];
  }
  return schema.type;
};

const collectSchemaPaths = (schema: JsonSchema, root: JsonSchema, prefix: string): string[] => {
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
      return;
    }

    if (childType === 'array' && childSchema.items) {
      const arrayPrefix = `${nextPrefix}[]`;
      paths.push(arrayPrefix);
      paths.push(...collectSchemaPaths(childSchema.items, root, arrayPrefix));
      return;
    }

    paths.push(nextPrefix);
  });

  return paths;
};

const pushUniqueOption = (options: SelectOption[], value: string, label: string) => {
  if (options.some((option) => option.value === value)) {
    return;
  }

  options.push({ value, label });
};

export const buildWorkflowReferenceFieldOptions = (
  payloadSchema: JsonSchema | null,
  dataContext: DataContext | null
): SelectOption[] => {
  const options: SelectOption[] = [];

  pushUniqueOption(options, 'payload', '📦 payload');
  pushUniqueOption(options, 'vars', '📝 vars');
  pushUniqueOption(options, 'meta', '🏷️ meta');
  pushUniqueOption(options, 'meta.state', 'meta.state');
  pushUniqueOption(options, 'meta.traceId', 'meta.traceId');
  pushUniqueOption(options, 'meta.tags', 'meta.tags');

  if (dataContext?.inCatchBlock) {
    pushUniqueOption(options, 'error', '⚠️ error');
    pushUniqueOption(options, 'error.message', 'error.message');
    pushUniqueOption(options, 'error.code', 'error.code');
    pushUniqueOption(options, 'error.stack', 'error.stack');
  }

  if (payloadSchema) {
    collectSchemaPaths(payloadSchema, payloadSchema, 'payload').forEach((path) => {
      pushUniqueOption(options, path, path);
    });
  } else {
    [
      'payload.id',
      'payload.type',
      'payload.data',
      'payload.timestamp',
      'payload.tenant',
    ].forEach((path) => {
      pushUniqueOption(options, path, `${path} (placeholder)`);
    });
  }

  dataContext?.steps.forEach((stepOutput) => {
    const basePath = `vars.${stepOutput.saveAs}`;
    pushUniqueOption(options, basePath, `🔗 ${basePath} (${stepOutput.stepName})`);
    collectSchemaPaths(stepOutput.outputSchema, stepOutput.outputSchema, basePath).forEach((path) => {
      pushUniqueOption(options, path, path);
    });
  });

  if (dataContext?.forEach) {
    pushUniqueOption(
      options,
      dataContext.forEach.itemVar,
      `🔄 ${dataContext.forEach.itemVar} (current item)`
    );
    pushUniqueOption(
      options,
      dataContext.forEach.indexVar,
      `🔢 ${dataContext.forEach.indexVar} (loop index)`
    );
  }

  return options;
};
