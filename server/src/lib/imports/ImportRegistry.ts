import { AbstractImporter } from './AbstractImporter';

/**
 * Central registry for available importers. Acts as the plugin catalog.
 */
export class ImportRegistry {
  private static instance: ImportRegistry;

  private readonly importers: Map<string, AbstractImporter> = new Map();

  private constructor() {}

  static getInstance(): ImportRegistry {
    if (!ImportRegistry.instance) {
      ImportRegistry.instance = new ImportRegistry();
    }
    return ImportRegistry.instance;
  }

  register(importer: AbstractImporter): void {
    const normalizedType = importer.sourceType.toLowerCase();
    this.importers.set(normalizedType, importer);
  }

  registerMany(importers: AbstractImporter[]): void {
    importers.forEach((importer) => this.register(importer));
  }

  unregister(sourceType: string): void {
    this.importers.delete(sourceType.toLowerCase());
  }

  get(sourceType: string): AbstractImporter | undefined {
    return this.importers.get(sourceType.toLowerCase());
  }

  list(): AbstractImporter[] {
    return Array.from(this.importers.values());
  }

  has(sourceType: string): boolean {
    return this.importers.has(sourceType.toLowerCase());
  }

  clear(): void {
    this.importers.clear();
  }
}
