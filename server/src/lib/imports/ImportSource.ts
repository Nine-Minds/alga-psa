import type { FieldMappingTemplate, ImportSourceRecord } from 'server/src/types/imports.types';

interface ImportSourceProps {
  tenant: string;
  importSourceId: string;
  sourceType: string;
  name: string;
  description: string | null;
  fieldMapping: FieldMappingTemplate | null;
  duplicateDetectionFields: string[] | null;
  isActive: boolean;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

const normaliseArray = (value: string[] | null | undefined): string[] | null => {
  if (!value || value.length === 0) {
    return null;
  }
  return Array.from(
    new Set(
      value
        .map((item) => item?.trim())
        .filter((item): item is string => Boolean(item && item.length > 0))
    )
  );
};

/**
 * Domain representation of an import source registration.
 */
export class ImportSource {
  private readonly props: ImportSourceProps;

  private constructor(props: ImportSourceProps) {
    this.props = props;
  }

  static fromRecord(record: ImportSourceRecord): ImportSource {
    return new ImportSource({
      tenant: record.tenant,
      importSourceId: record.import_source_id,
      sourceType: record.source_type,
      name: record.name,
      description: record.description,
      fieldMapping: record.field_mapping,
      duplicateDetectionFields: normaliseArray(record.duplicate_detection_fields),
      isActive: record.is_active,
      metadata: record.metadata,
      createdAt: new Date(record.created_at),
      updatedAt: new Date(record.updated_at)
    });
  }

  static create(props: Omit<ImportSourceProps, 'createdAt' | 'updatedAt'> & { createdAt?: Date; updatedAt?: Date }): ImportSource {
    const now = new Date();
    return new ImportSource({
      ...props,
      duplicateDetectionFields: normaliseArray(props.duplicateDetectionFields),
      createdAt: props.createdAt ?? now,
      updatedAt: props.updatedAt ?? now
    });
  }

  get tenant(): string {
    return this.props.tenant;
  }

  get id(): string {
    return this.props.importSourceId;
  }

  get sourceType(): string {
    return this.props.sourceType;
  }

  get name(): string {
    return this.props.name;
  }

  get description(): string | null {
    return this.props.description;
  }

  get fieldMapping(): FieldMappingTemplate | null {
    return this.props.fieldMapping;
  }

  get duplicateDetectionFields(): string[] | null {
    return this.props.duplicateDetectionFields;
  }

  get isActive(): boolean {
    return this.props.isActive;
  }

  get metadata(): Record<string, unknown> | null {
    return this.props.metadata;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  activate(): ImportSource {
    if (this.props.isActive) {
      return this;
    }
    return this.clone({ isActive: true });
  }

  deactivate(): ImportSource {
    if (!this.props.isActive) {
      return this;
    }
    return this.clone({ isActive: false });
  }

  withFieldMapping(fieldMapping: FieldMappingTemplate | null): ImportSource {
    return this.clone({ fieldMapping });
  }

  withDuplicateDetectionFields(fields: string[] | null): ImportSource {
    return this.clone({ duplicateDetectionFields: normaliseArray(fields) });
  }

  withMetadata(metadata: Record<string, unknown> | null): ImportSource {
    return this.clone({ metadata });
  }

  matchesImporter(sourceType: string): boolean {
    return this.props.sourceType.toLowerCase() === sourceType.toLowerCase();
  }

  toRecord(): ImportSourceRecord {
    return {
      tenant: this.props.tenant,
      import_source_id: this.props.importSourceId,
      source_type: this.props.sourceType,
      name: this.props.name,
      description: this.props.description,
      field_mapping: this.props.fieldMapping,
      duplicate_detection_fields: this.props.duplicateDetectionFields,
      is_active: this.props.isActive,
      metadata: this.props.metadata,
      created_at: this.props.createdAt.toISOString(),
      updated_at: this.props.updatedAt.toISOString()
    };
  }

  private clone(mutator: Partial<Omit<ImportSourceProps, 'tenant' | 'importSourceId' | 'sourceType' | 'createdAt'>>): ImportSource {
    const updatedAt = new Date();
    return new ImportSource({
      ...this.props,
      ...mutator,
      duplicateDetectionFields: mutator.duplicateDetectionFields
        ? normaliseArray(mutator.duplicateDetectionFields)
        : this.props.duplicateDetectionFields,
      updatedAt
    });
  }
}
