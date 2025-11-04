import type {
  FieldDefinition,
  FieldMapping,
  FieldMappingResult,
  ParsedRecord
} from '@/types/imports.types';
import { ImportValidationError } from '@/lib/imports/errors';

export interface FieldMapperOptions {
  allowUnmappedOptionalFields?: boolean;
}

const isEmptyValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
};

export class FieldMapper {
  private readonly definitions: Map<string, FieldDefinition>;
  private readonly options: FieldMapperOptions;

  constructor(definitions: FieldDefinition[], options: FieldMapperOptions = {}) {
    this.definitions = new Map(definitions.map((definition) => [definition.field, definition]));
    this.options = options;
  }

  listDefinitions(): FieldDefinition[] {
    return Array.from(this.definitions.values());
  }

  getDefinition(field: string): FieldDefinition | undefined {
    return this.definitions.get(field);
  }

  async mapRecord(record: ParsedRecord, mapping: FieldMapping[]): Promise<FieldMappingResult> {
    const output: Record<string, unknown> = {};
    const errors: ImportValidationError[] = [];
    const mappedFields = new Set<string>();

    for (const entry of mapping) {
      const definition = this.getDefinition(entry.targetField);
      if (!definition) {
        errors.push(
          new ImportValidationError(
            record.rowNumber,
            entry.targetField,
            undefined,
            `Unknown target field: ${entry.targetField}`
          )
        );
        continue;
      }

      mappedFields.add(definition.field);

      const rawValue = this.getSourceValue(record, entry.sourceField);
      let parsedValue = rawValue;

      try {
        if (definition.parser) {
          parsedValue = await definition.parser(rawValue, record);
        }
      } catch (error) {
        errors.push(
          new ImportValidationError(
            record.rowNumber,
            definition.field,
            rawValue,
            error instanceof Error ? error.message : 'Failed to parse field'
          )
        );
        continue;
      }

      if (definition.validators?.length) {
        for (const validator of definition.validators) {
          const result = await validator(parsedValue, record);
          if (result) {
            errors.push(result);
          }
        }
      }

      if (definition.required && isEmptyValue(parsedValue)) {
        errors.push(
          new ImportValidationError(
            record.rowNumber,
            definition.field,
            parsedValue,
            `${definition.label} is required`
          )
        );
        continue;
      }

      if (!isEmptyValue(parsedValue) || this.options.allowUnmappedOptionalFields) {
        output[definition.field] = parsedValue;
      }
    }

    // Check for required fields that were not mapped
    for (const definition of this.definitions.values()) {
      if (!definition.required) continue;
      if (mappedFields.has(definition.field)) continue;
      const mappedValue = output[definition.field];
      if (isEmptyValue(mappedValue)) {
        errors.push(
          new ImportValidationError(
            record.rowNumber,
            definition.field,
            mappedValue,
            `${definition.label} must be mapped to a column`
          )
        );
      }
    }

    return {
      mapped: output,
      errors,
    };
  }

  private getSourceValue(record: ParsedRecord, sourceField: string): unknown {
    const key = sourceField?.trim();
    if (!key) return undefined;
    if (record.normalized && key in record.normalized) {
      return record.normalized[key];
    }
    return record.raw[key];
  }
}
