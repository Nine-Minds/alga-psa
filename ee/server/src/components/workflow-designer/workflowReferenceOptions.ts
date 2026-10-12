import { formatWorkflowFieldLabel } from './workflowFieldNames';
import type { SelectOption } from '@alga-psa/ui/components/CustomSelect';

import { WORKFLOW_CAUGHT_ERROR_FIELDS } from '@alga-psa/workflows/authoring';
import { resolveLocalJsonSchemaRef } from './jsonSchemaRefs';
import type { DataContext, JsonSchema } from './workflowDataContext';

const resolveSchema = (schema: JsonSchema, root?: JsonSchema, seenRefs = new Set<string>()): JsonSchema => {
  const rootSchema = root ?? schema;

  if (schema.$ref) {
    const refKey = schema.$ref;
    if (!seenRefs.has(refKey)) {
      seenRefs.add(refKey);
      const resolved = resolveLocalJsonSchemaRef(refKey, rootSchema);
      if (resolved) {
        return resolveSchema(resolved, rootSchema, seenRefs);
      }
    }
  }

  if (schema.anyOf?.length) {
    const nonNullVariant = schema.anyOf.find(
      (variant) =>
        variant.type !== 'null' &&
        !(Array.isArray(variant.type) && variant.type.length === 1 && variant.type[0] === 'null')
    );
    if (nonNullVariant) {
      const resolved = resolveSchema(nonNullVariant, rootSchema, seenRefs);
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

type ReferenceOption = {
  value: string;
  label: string;
};

const buildReferenceOptionLabel = (
  path: string,
  description: string | undefined,
  fallbackLabel: string
): string => {
  // Lead with the field's plain-language name (its schema description, or its humanized name),
  // keeping the path for people who know it.
  if (!fallbackLabel) return description?.trim() || path;
  return formatWorkflowFieldLabel(description, fallbackLabel);
};

const collectSchemaPaths = (
  schema: JsonSchema,
  root: JsonSchema,
  prefix: string,
  fallbackLabelPrefix: string
): ReferenceOption[] => {
  const resolved = resolveSchema(schema, root);
  const type = normalizeSchemaType(resolved);
  if (type !== 'object' || !resolved.properties) {
    return [{
      value: prefix,
      label: buildReferenceOptionLabel(prefix, resolved.description, fallbackLabelPrefix),
    }];
  }

  const paths: ReferenceOption[] = [{
    value: prefix,
    label: buildReferenceOptionLabel(prefix, resolved.description, fallbackLabelPrefix),
  }];
  Object.entries(resolved.properties).forEach(([key, child]) => {
    const childSchema = resolveSchema(child, root);
    const childType = normalizeSchemaType(childSchema);
    const nextPrefix = `${prefix}.${key}`;
    const nextFallbackLabel = nextPrefix.startsWith(`${prefix}.`)
      ? nextPrefix.slice(prefix.length + 1)
      : nextPrefix;

    if (childType === 'object' && childSchema.properties) {
      paths.push(...collectSchemaPaths(childSchema, root, nextPrefix, nextFallbackLabel));
      return;
    }

    if (childType === 'array' && childSchema.items) {
      const arrayPrefix = `${nextPrefix}[]`;
      paths.push({
        value: arrayPrefix,
        label: buildReferenceOptionLabel(arrayPrefix, childSchema.description, `${nextFallbackLabel}[]`),
      });
      paths.push(...collectSchemaPaths(childSchema.items, root, arrayPrefix, `${nextFallbackLabel}[]`));
      return;
    }

    paths.push({
      value: nextPrefix,
      label: buildReferenceOptionLabel(nextPrefix, childSchema.description, nextFallbackLabel),
    });
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
    pushUniqueOption(options, 'error', '⚠️ error (caught by this Try/Catch)');
    for (const field of WORKFLOW_CAUGHT_ERROR_FIELDS) {
      pushUniqueOption(options, `error.${field.name}`, `error.${field.name} (${field.description})`);
    }
  }

  if (payloadSchema) {
    collectSchemaPaths(payloadSchema, payloadSchema, 'payload', 'payload').forEach((option) => {
      pushUniqueOption(options, option.value, option.label);
    });
  }

  dataContext?.steps.forEach((stepOutput) => {
    const basePath = `vars.${stepOutput.saveAs}`;
    pushUniqueOption(options, basePath, `🔗 ${basePath} (${stepOutput.stepName})`);
    collectSchemaPaths(stepOutput.outputSchema, stepOutput.outputSchema, basePath, stepOutput.saveAs).forEach((option) => {
      if (option.value === basePath) {
        return;
      }
      pushUniqueOption(options, option.value, option.label);
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

  // Several steps can have a field with the same name (e.g. three "url"s); name the source path so
  // the entries can be told apart.
  const labelCounts = new Map<string, number>();
  for (const option of options) {
    const label = String(option.label);
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }
  return options.map((option) =>
    (labelCounts.get(String(option.label)) ?? 0) > 1 && option.label !== option.value
      ? {
          ...option,
          // "URL (url)" → "URL (vars.firstTicket.url)": the full path replaces the short one.
          label: /\([^()]*\)$/.test(String(option.label))
            ? String(option.label).replace(/\([^()]*\)$/, `(${option.value})`)
            : `${String(option.label)} (${option.value})`,
        }
      : option
  );
};
