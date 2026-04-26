import React, { useMemo } from 'react';

import CustomSelect, { type SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { useWorkflowReferenceSectionOptions } from '@alga-psa/workflows/hooks/useWorkflowEnumOptions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

import type { JsonSchema } from './expression-editor';
import { resolveLocalJsonSchemaRef } from './jsonSchemaRefs';
import type { DataTreeContext } from './mapping/SourceDataTree';
import {
  TypeCompatibility,
  getTypeCompatibility,
} from './mapping/typeCompatibility';

export type ReferenceSourceScope = 'payload' | 'vars' | 'meta' | 'error' | 'forEach';

type ReferenceFieldOption = {
  value: string;
  label: string;
  type?: string;
};

type ReferenceStepOption = {
  value: string;
  label: string;
  fields: ReferenceFieldOption[];
};

export type ReferenceSourceModel = {
  payload: ReferenceFieldOption[];
  vars: ReferenceStepOption[];
  meta: ReferenceFieldOption[];
  error: ReferenceFieldOption[];
  forEach: ReferenceFieldOption[];
};

const toRelativeLabel = (path: string, prefix: string, fallback: string): string => {
  if (path === prefix) return fallback;
  if (path.startsWith(`${prefix}.`)) return path.slice(prefix.length + 1);
  return path;
};

const pushUniqueReferenceField = (
  target: ReferenceFieldOption[],
  option: ReferenceFieldOption
) => {
  if (target.some((existing) => existing.value === option.value)) return;
  target.push(option);
};

const flattenReferenceFields = (
  fields: DataTreeContext['payload'],
  labelPrefix: string
): ReferenceFieldOption[] => {
  const flattened: ReferenceFieldOption[] = [];
  const visit = (field: DataTreeContext['payload'][number]) => {
    pushUniqueReferenceField(flattened, {
      value: field.path,
      label: toRelativeLabel(field.path, labelPrefix, field.name),
      type: field.type,
    });
    field.children?.forEach((child) => visit(child));
  };
  fields.forEach((field) => visit(field));
  return flattened;
};

const resolveReferenceSchema = (schema: JsonSchema, root?: JsonSchema, seenRefs = new Set<string>()): JsonSchema => {
  const rootSchema = root ?? schema;

  if (schema.$ref) {
    const refKey = schema.$ref;
    if (!seenRefs.has(refKey)) {
      seenRefs.add(refKey);
      const resolved = resolveLocalJsonSchemaRef(refKey, rootSchema);
      if (resolved) return resolveReferenceSchema(resolved, rootSchema, seenRefs);
    }
  }

  if (schema.anyOf?.length) {
    const nonNullVariant = schema.anyOf.find(
      (variant) =>
        variant.type !== 'null' &&
        !(Array.isArray(variant.type) && variant.type.length === 1 && variant.type[0] === 'null')
    );
    if (nonNullVariant) {
      const resolved = resolveReferenceSchema(nonNullVariant, rootSchema, seenRefs);
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

const normalizeReferenceSchemaType = (schema?: JsonSchema): string | undefined => {
  if (!schema?.type) return undefined;
  if (Array.isArray(schema.type)) {
    return schema.type.find((type) => type !== 'null') ?? schema.type[0];
  }
  return schema.type;
};

const collectReferenceSchemaFields = (
  schema: JsonSchema | undefined,
  prefix: string,
  labelPrefix: string,
  root?: JsonSchema
): ReferenceFieldOption[] => {
  if (!schema) return [];

  const resolved = resolveReferenceSchema(schema, root);
  const type = normalizeReferenceSchemaType(resolved);
  const options: ReferenceFieldOption[] = [
    {
      value: prefix,
      label: toRelativeLabel(prefix, labelPrefix, prefix),
      type,
    },
  ];

  if (type === 'object' && resolved.properties) {
    Object.entries(resolved.properties).forEach(([key, childSchema]) => {
      collectReferenceSchemaFields(childSchema, `${prefix}.${key}`, labelPrefix, root ?? resolved).forEach((option) =>
        pushUniqueReferenceField(options, option)
      );
    });
    return options;
  }

  if (type === 'array' && resolved.items) {
    const arrayPrefix = `${prefix}[]`;
    pushUniqueReferenceField(options, {
      value: arrayPrefix,
      label: toRelativeLabel(arrayPrefix, labelPrefix, arrayPrefix),
      type: normalizeReferenceSchemaType(resolveReferenceSchema(resolved.items, root ?? resolved)),
    });
    collectReferenceSchemaFields(resolved.items, arrayPrefix, labelPrefix, root ?? resolved).forEach((option) =>
      pushUniqueReferenceField(options, option)
    );
  }

  return options;
};

export function inferTypeFromPath(path: string): string | undefined {
  if (!path) return undefined;

  const parts = path.split('.');
  const fieldName = parts[parts.length - 1].toLowerCase();
  const cleanName = fieldName.replace(/\[\]$/, '').replace(/\[\d+\]$/, '');

  if (cleanName.endsWith('id') || cleanName.endsWith('_id') || cleanName === 'id') return 'string';
  if (cleanName.endsWith('email') || cleanName === 'email') return 'string';
  if (cleanName.endsWith('name') || cleanName === 'name') return 'string';
  if (cleanName.endsWith('title') || cleanName === 'title') return 'string';
  if (cleanName.endsWith('description') || cleanName === 'description') return 'string';
  if (cleanName.endsWith('message') || cleanName === 'message') return 'string';
  if (cleanName.endsWith('url') || cleanName === 'url') return 'string';
  if (cleanName.endsWith('path') || cleanName === 'path') return 'string';
  if (cleanName.endsWith('text') || cleanName === 'text') return 'string';
  if (cleanName.endsWith('content') || cleanName === 'content') return 'string';
  if (cleanName.endsWith('subject') || cleanName === 'subject') return 'string';

  if (cleanName.endsWith('count') || cleanName.endsWith('_count')) return 'number';
  if (cleanName.endsWith('amount') || cleanName.endsWith('_amount')) return 'number';
  if (cleanName.endsWith('total') || cleanName.endsWith('_total')) return 'number';
  if (cleanName.endsWith('number') && !cleanName.includes('phone')) return 'number';
  if (cleanName === 'index' || cleanName === '$index') return 'number';
  if (cleanName.endsWith('port')) return 'number';
  if (cleanName.endsWith('version')) return 'number';

  if (cleanName.startsWith('is_') || cleanName.startsWith('has_')) return 'boolean';
  if (cleanName.endsWith('enabled') || cleanName.endsWith('_enabled')) return 'boolean';
  if (cleanName.endsWith('active') || cleanName.endsWith('_active')) return 'boolean';
  if (cleanName.endsWith('flag') || cleanName.endsWith('_flag')) return 'boolean';
  if (cleanName === 'required' || cleanName === 'optional') return 'boolean';
  if (cleanName === 'success' || cleanName === 'valid') return 'boolean';

  if (cleanName.endsWith('date') || cleanName.endsWith('_at')) return 'date';
  if (cleanName.endsWith('time') || cleanName.endsWith('timestamp')) return 'date';
  if (cleanName === 'created' || cleanName === 'updated') return 'date';

  if (cleanName.endsWith('list') || cleanName.endsWith('items')) return 'array';
  if (cleanName.endsWith('[]')) return 'array';
  if (cleanName === 'attachments' || cleanName === 'files') return 'array';
  if (cleanName === 'tags' || cleanName === 'labels') return 'array';

  if (path === 'payload' || path === 'vars' || path === 'meta' || path === 'error') return 'object';
  if (path === 'meta.state') return 'string';
  if (path === 'meta.traceId') return 'string';
  if (path === 'error.message' || path === 'error.name' || path === 'error.stack') return 'string';

  return undefined;
}

export function extractPrimaryPath(expression: string | undefined): string | null {
  if (!expression) return null;
  const trimmed = expression.trim();
  if (!trimmed) return null;
  const token = trimmed.split(/[\s+\-*/%()[\]{},<>=!&|?:]+/)[0];
  return token || null;
}

export const buildReferenceSourceModel = (
  referenceBrowseContext: DataTreeContext | undefined,
  fieldOptions: SelectOption[],
  payloadSchema?: JsonSchema
): ReferenceSourceModel => {
  const model: ReferenceSourceModel = {
    payload: [],
    vars: [],
    meta: [],
    error: [],
    forEach: [],
  };

  collectReferenceSchemaFields(payloadSchema, 'payload', 'payload', payloadSchema).forEach((option) =>
    pushUniqueReferenceField(model.payload, option)
  );
  referenceBrowseContext?.payload.forEach((field) => {
    flattenReferenceFields([field], 'payload').forEach((option) =>
      pushUniqueReferenceField(model.payload, option)
    );
  });
  referenceBrowseContext?.meta.forEach((field) => {
    flattenReferenceFields([field], 'meta').forEach((option) =>
      pushUniqueReferenceField(model.meta, option)
    );
  });
  referenceBrowseContext?.error.forEach((field) => {
    flattenReferenceFields([field], 'error').forEach((option) =>
      pushUniqueReferenceField(model.error, option)
    );
  });
  referenceBrowseContext?.vars.forEach((step) => {
    const prefix = `vars.${step.saveAs}`;
    model.vars.push({
      value: step.saveAs,
      label: `${step.stepName} (${step.saveAs})`,
      fields: flattenReferenceFields(step.fields, prefix),
    });
  });
  if (referenceBrowseContext?.forEach) {
    const { itemVar, indexVar, itemType } = referenceBrowseContext.forEach;
    pushUniqueReferenceField(model.forEach, {
      value: itemVar,
      label: itemVar,
      type: itemType,
    });
    pushUniqueReferenceField(model.forEach, {
      value: indexVar,
      label: indexVar,
      type: 'number',
    });
  }

  fieldOptions.forEach((option) => {
    const path = option.value;
    const inferredType = inferTypeFromPath(path);

    if (path.startsWith('payload')) {
      pushUniqueReferenceField(model.payload, {
        value: path,
        label: toRelativeLabel(path, 'payload', 'payload'),
        type: inferredType,
      });
      return;
    }

    if (path.startsWith('vars.')) {
      const [, stepKey, ...rest] = path.split('.');
      if (!stepKey) return;
      let step = model.vars.find((entry) => entry.value === stepKey);
      if (!step) {
        step = {
          value: stepKey,
          label: stepKey,
          fields: [],
        };
        model.vars.push(step);
      }
      pushUniqueReferenceField(step.fields, {
        value: path,
        label: rest.length > 0 ? rest.join('.') : stepKey,
        type: inferredType,
      });
      return;
    }

    if (path.startsWith('meta')) {
      pushUniqueReferenceField(model.meta, {
        value: path,
        label: toRelativeLabel(path, 'meta', 'meta'),
        type: inferredType,
      });
      return;
    }

    if (path.startsWith('error')) {
      pushUniqueReferenceField(model.error, {
        value: path,
        label: toRelativeLabel(path, 'error', 'error'),
        type: inferredType,
      });
      return;
    }

    if (
      referenceBrowseContext?.forEach &&
      (path === referenceBrowseContext.forEach.itemVar ||
        path.startsWith(`${referenceBrowseContext.forEach.itemVar}.`) ||
        path === referenceBrowseContext.forEach.indexVar)
    ) {
      pushUniqueReferenceField(model.forEach, {
        value: path,
        label:
          path === referenceBrowseContext.forEach.itemVar
            ? referenceBrowseContext.forEach.itemVar
            : path === referenceBrowseContext.forEach.indexVar
              ? referenceBrowseContext.forEach.indexVar
              : path.slice(referenceBrowseContext.forEach.itemVar.length + 1),
        type: inferredType,
      });
    }
  });

  return model;
};

export const deriveReferenceScope = (
  path: string | null,
  referenceBrowseContext: DataTreeContext | undefined
): { scope: ReferenceSourceScope | ''; step: string } => {
  if (!path) return { scope: '', step: '' };
  if (path.startsWith('payload')) return { scope: 'payload', step: '' };
  if (path.startsWith('vars.')) {
    const [, step = ''] = path.split('.');
    return { scope: 'vars', step };
  }
  if (path.startsWith('meta')) return { scope: 'meta', step: '' };
  if (path.startsWith('error')) return { scope: 'error', step: '' };
  if (
    referenceBrowseContext?.forEach &&
    (path === referenceBrowseContext.forEach.itemVar ||
      path.startsWith(`${referenceBrowseContext.forEach.itemVar}.`) ||
      path === referenceBrowseContext.forEach.indexVar)
  ) {
    return { scope: 'forEach', step: '' };
  }
  return { scope: '', step: '' };
};

const filterReferenceFieldOptions = (
  options: ReferenceFieldOption[],
  targetType: string | undefined
): ReferenceFieldOption[] => {
  if (!targetType) return options;

  const exact = options.filter(
    (option) => getTypeCompatibility(option.type, targetType) === TypeCompatibility.EXACT
  );
  const coercible = options.filter(
    (option) => getTypeCompatibility(option.type, targetType) === TypeCompatibility.COERCIBLE
  );
  const unknown = options.filter(
    (option) => getTypeCompatibility(option.type, targetType) === TypeCompatibility.UNKNOWN
  );

  if (exact.length > 0) return exact;
  if (coercible.length > 0) return coercible;

  return unknown.length > 0 ? unknown : options;
};

export const ReferenceScopeSelector: React.FC<{
  idPrefix: string;
  model: ReferenceSourceModel;
  targetType: string | undefined;
  selectedScope: ReferenceSourceScope | '';
  selectedStep: string;
  selectedField: string | null;
  disabled?: boolean;
  onScopeChange: (scope: ReferenceSourceScope | '') => void;
  onStepChange: (step: string) => void;
  onFieldChange: (path: string) => void;
}> = ({
  idPrefix,
  model,
  targetType,
  selectedScope,
  selectedStep,
  selectedField,
  disabled,
  onScopeChange,
  onStepChange,
  onFieldChange,
}) => {
  const { t } = useTranslation('msp/workflows');
  const allScopeOptions = useWorkflowReferenceSectionOptions();
  const scopeOptions = useMemo<SelectOption[]>(() => {
    return allScopeOptions.filter((option) => {
      if (option.value === 'payload') return model.payload.length > 0;
      if (option.value === 'vars') return model.vars.length > 0;
      if (option.value === 'meta') return model.meta.length > 0;
      if (option.value === 'error') return model.error.length > 0;
      if (option.value === 'forEach') return model.forEach.length > 0;
      return false;
    });
  }, [allScopeOptions, model]);

  const selectedStepOption = selectedScope === 'vars'
    ? model.vars.find((step) => step.value === selectedStep) ?? null
    : null;

  const fieldOptions = useMemo<SelectOption[]>(() => {
    let options: ReferenceFieldOption[] = [];
    let rootValue: string | null = null;
    if (selectedScope === 'payload') options = model.payload;
    if (selectedScope === 'meta') options = model.meta;
    if (selectedScope === 'error') options = model.error;
    if (selectedScope === 'forEach') options = model.forEach;
    if (selectedScope === 'vars' && selectedStepOption) options = selectedStepOption.fields;

    if (selectedScope === 'payload') rootValue = 'payload';
    if (selectedScope === 'meta') rootValue = 'meta';
    if (selectedScope === 'error') rootValue = 'error';
    if (selectedScope === 'vars' && selectedStepOption) rootValue = `vars.${selectedStepOption.value}`;
    if (selectedScope === 'forEach' && options.length > 0) rootValue = options[0]?.value ?? null;

    const filteredOptions = filterReferenceFieldOptions(options, targetType);
    if (rootValue) {
      const rootOption = options.find((option) => option.value === rootValue);
      if (rootOption && !filteredOptions.some((option) => option.value === rootValue)) {
        filteredOptions.unshift(rootOption);
      }
    }

    return filteredOptions.map((option) => ({
      value: option.value,
      label: option.label,
    }));
  }, [model, selectedScope, selectedStepOption, targetType]);

  const stepOptions = useMemo<SelectOption[]>(() => {
    if (selectedScope !== 'vars') return [];
    return model.vars.map((step) => ({ value: step.value, label: step.label }));
  }, [model.vars, selectedScope]);

  const selectClassName = 'min-w-0 w-full overflow-hidden whitespace-nowrap';

  return (
    <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(12rem,1fr))]">
      <CustomSelect
        id={`${idPrefix}-reference-scope`}
        options={scopeOptions}
        value={selectedScope || undefined}
        placeholder={t('referenceSelector.placeholders.scope', { defaultValue: 'Select source scope...' })}
        onValueChange={(value) => onScopeChange(value as ReferenceSourceScope | '')}
        disabled={disabled}
        className={selectClassName}
      />
      {selectedScope === 'vars' && (
        <CustomSelect
          id={`${idPrefix}-reference-step`}
          options={stepOptions}
          value={selectedStep || undefined}
          placeholder={t('referenceSelector.placeholders.step', { defaultValue: 'Select step...' })}
          onValueChange={onStepChange}
          disabled={disabled}
          className={selectClassName}
        />
      )}
      {selectedScope && selectedScope !== 'vars' && (
        <CustomSelect
          id={`${idPrefix}-reference-field`}
          options={fieldOptions}
          value={selectedField ?? undefined}
          placeholder={t('referenceSelector.placeholders.field', { defaultValue: 'Select field...' })}
          onValueChange={onFieldChange}
          disabled={disabled}
          className={selectClassName}
        />
      )}
      {selectedScope === 'vars' && selectedStep && (
        <CustomSelect
          id={`${idPrefix}-reference-field`}
          options={fieldOptions}
          value={selectedField ?? undefined}
          placeholder={t('referenceSelector.placeholders.field', { defaultValue: 'Select field...' })}
          onValueChange={onFieldChange}
          disabled={disabled}
          className={selectClassName}
        />
      )}
    </div>
  );
};
