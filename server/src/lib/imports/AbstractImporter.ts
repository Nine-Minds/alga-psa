import type {
  DetectionContext,
  DuplicateCheckResult,
  DuplicateDetectionStrategy,
  FieldMapping,
  MapToAssetContext,
  ParsedRecord,
  ValidationResult
} from 'server/src/types/imports.types';

/**
 * Base class for all importers (CSV, RMM exports, API connectors, etc).
 * Implementations provide parsing, validation, and asset mapping logic.
 */
export abstract class AbstractImporter<TRecord extends ParsedRecord = ParsedRecord> {
  abstract readonly sourceType: string;
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly supportedFileTypes: string[];

  protected readonly metadata?: Record<string, unknown>;

  constructor(metadata?: Record<string, unknown>) {
    this.metadata = metadata;
  }

  /**
   * Parse incoming payload (file contents, API response, etc.) into a uniform shape.
   */
  abstract parse(input: Buffer | string): Promise<TRecord[]>;

  /**
   * Validate parsed records. Implementations should collect all issues rather than failing fast.
   */
  abstract validate(records: TRecord[]): Promise<ValidationResult>;

  /**
   * Map a parsed record into the canonical asset shape that the importer will persist.
   */
  abstract mapToAsset(record: TRecord, context: MapToAssetContext): Promise<Record<string, unknown>>;

  /**
   * Optionally override duplicate detection. Most importers should rely on DuplicateDetector.
   */
  async detectDuplicate(
    record: TRecord,
    context: DetectionContext,
    strategy?: DuplicateDetectionStrategy
  ): Promise<DuplicateCheckResult> {
    return {
      isDuplicate: false,
      matchType: undefined,
      matchedAssetId: undefined,
      confidence: undefined,
      details: strategy
        ? {
            strategy
          }
        : undefined
    };
  }

  /**
   * Allow importers to expose default field mappings (used to seed the registry and UI).
   */
  getDefaultFieldMapping(): FieldMapping[] {
    return [];
  }

  /**
   * Provide a default duplicate detection configuration for this importer.
   */
  getDuplicateDetectionStrategy(): DuplicateDetectionStrategy | undefined {
    return undefined;
  }

  /**
   * Expose additional metadata (icons, descriptions, etc.) for UI consumption.
   */
  getMetadata(): Record<string, unknown> | undefined {
    return this.metadata;
  }
}
