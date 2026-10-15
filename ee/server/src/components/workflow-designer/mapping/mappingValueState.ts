import type { InputMapping, MappingValue, Expr } from '@alga-psa/workflows/runtime';

import type { ActionInputField } from './InputMappingEditor';

/**
 * Determine whether a mapping value is effectively "set" (not just present).
 * Used to highlight required fields that are missing values.
 */
export function isMappingValueSet(value: MappingValue | undefined, fieldType?: string): boolean {
  if (value === undefined) return false;
  if (value === null) return true;

  if (typeof value === 'object') {
    if ('$expr' in value) {
      return Boolean((value as Expr).$expr?.trim());
    }
    if ('$secret' in value) {
      return Boolean((value as { $secret: string }).$secret?.trim());
    }
    // An empty list, or a list/object whose entries are all blank, isn't filled in yet.
    if (Array.isArray(value)) {
      return value.some((item) => isMappingValueSet(item as MappingValue, typeof item === 'string' ? 'string' : undefined));
    }
    return Object.values(value).some((item) =>
      isMappingValueSet(item as MappingValue, typeof item === 'string' ? 'string' : undefined)
    );
  }

  if (typeof value === 'string') {
    // Treat empty strings as "unset" so required string fields can be flagged.
    return fieldType === 'string' ? value.trim().length > 0 : true;
  }

  return true;
}

/**
 * Every required input, nested ones included (a required field inside an object the step sets),
 * with how many have a value. The step card's badge and the input panel's "required missing" count
 * both come from here, so they always agree.
 */
export const flattenRequiredActionInputFields = (
  fields: ActionInputField[],
  mappingValue: unknown,
  prefix = ''
): {
  requiredFields: ActionInputField[];
  mappedRequiredFieldCount: number;
} => {
  const requiredFields: ActionInputField[] = [];
  let mappedRequiredFieldCount = 0;

  fields.forEach((field) => {
    const fieldPath = prefix ? `${prefix}.${field.name}` : field.name;
    const currentValue =
      mappingValue && typeof mappingValue === 'object' && !Array.isArray(mappingValue)
        ? (mappingValue as Record<string, unknown>)[field.name]
        : undefined;

    const hasObjectChildren = field.type === 'object' && (field.children?.length ?? 0) > 0;
    const hasArrayObjectChildren = field.type === 'array' && (field.children?.length ?? 0) > 0;
    const isWholeObjectMapping =
      currentValue &&
      typeof currentValue === 'object' &&
      !Array.isArray(currentValue) &&
      ('$expr' in currentValue || '$secret' in currentValue);

    if (
      hasObjectChildren &&
      (field.required || isMappingValueSet(currentValue as MappingValue | undefined, field.type))
    ) {
      const childStats = flattenRequiredActionInputFields(
        field.children ?? [],
        currentValue,
        fieldPath
      );

      if (childStats.requiredFields.length > 0) {
        requiredFields.push(...childStats.requiredFields);
        mappedRequiredFieldCount += isWholeObjectMapping
          ? childStats.requiredFields.length
          : childStats.mappedRequiredFieldCount;
        return;
      }
    }

    if (hasArrayObjectChildren && Array.isArray(currentValue) && currentValue.length > 0) {
      currentValue.forEach((item, index) => {
        const childStats = flattenRequiredActionInputFields(
          field.children ?? [],
          item,
          `${fieldPath}[${index}]`
        );
        requiredFields.push(...childStats.requiredFields);
        mappedRequiredFieldCount += childStats.mappedRequiredFieldCount;
      });
      return;
    }

    if (field.required) {
      requiredFields.push({
        ...field,
        name: fieldPath,
      });

      if (isMappingValueSet(currentValue as MappingValue | undefined, field.type)) {
        mappedRequiredFieldCount += 1;
      }
    }
  });

  return {
    requiredFields,
    mappedRequiredFieldCount,
  };
};

/** How many required inputs (nested ones included) still need a value. */
export const countMissingRequiredInputs = (fields: ActionInputField[], mapping: InputMapping | undefined): number => {
  const { requiredFields, mappedRequiredFieldCount } = flattenRequiredActionInputFields(fields, mapping ?? {});
  return requiredFields.length - mappedRequiredFieldCount;
};
