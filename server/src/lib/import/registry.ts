import { Importer } from './importer';

export interface ImportSource {
  sourceId: string;
  displayName: string;
  enabled: boolean;
  supportsImport: boolean;
  supportsExport: boolean;
}

/**
 * SourceRegistry is a singleton that manages all available import/export sources
 */
export class SourceRegistry {
  private static instance: SourceRegistry;
  private importers: Map<string, new (tenant: string) => Importer<any>> = new Map();
  private sources: Map<string, ImportSource> = new Map();

  private constructor() {
    // Initialize with default sources
    this.registerSource({
      sourceId: 'qbo',
      displayName: 'QuickBooks Online',
      enabled: true,
      supportsImport: true,
      supportsExport: false
    });
  }

  public static getInstance(): SourceRegistry {
    if (!SourceRegistry.instance) {
      SourceRegistry.instance = new SourceRegistry();
    }
    return SourceRegistry.instance;
  }

  /**
   * Register an importer implementation for a source
   */
  public registerImporter(sourceId: string, importerClass: new (tenant: string) => Importer<any>): void {
    this.importers.set(sourceId, importerClass);
  }

  /**
   * Get an importer instance for a source
   */
  public getImporter(sourceId: string, tenant: string): Importer<any> | null {
    const ImporterClass = this.importers.get(sourceId);
    if (!ImporterClass) {
      return null;
    }
    return new ImporterClass(tenant);
  }

  /**
   * Register a source
   */
  public registerSource(source: ImportSource): void {
    this.sources.set(source.sourceId, source);
  }

  /**
   * Get all registered sources
   */
  public getSources(): ImportSource[] {
    return Array.from(this.sources.values());
  }

  /**
   * Get a specific source
   */
  public getSource(sourceId: string): ImportSource | undefined {
    return this.sources.get(sourceId);
  }

  /**
   * Check if a source supports import
   */
  public supportsImport(sourceId: string): boolean {
    const source = this.sources.get(sourceId);
    return source?.supportsImport || false;
  }

  /**
   * Check if a source supports export
   */
  public supportsExport(sourceId: string): boolean {
    const source = this.sources.get(sourceId);
    return source?.supportsExport || false;
  }

  /**
   * Check if a source is enabled
   */
  public isEnabled(sourceId: string): boolean {
    const source = this.sources.get(sourceId);
    return source?.enabled || false;
  }
}