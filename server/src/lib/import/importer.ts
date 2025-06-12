import { Knex } from 'knex';

export interface Page<T> {
  items: T[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface MappedResult {
  entity: any;
  entityType: 'company' | 'contact';
  externalId: string;
}

export interface ImportContext {
  jobId: string;
  tenant: string;
  knex: Knex;
  onProgress?: (processed: number, total?: number) => Promise<void>;
  onItemProcessed?: (externalId: string, algaEntityId: string | null, status: 'SUCCESS' | 'ERROR' | 'SKIPPED', message?: string) => Promise<void>;
}

/**
 * Base interface for all importers
 */
export interface Importer<T> {
  /**
   * Fetch a page of entities from the external source
   */
  fetchPage(cursor?: string, pageSize?: number): Promise<Page<T>>;

  /**
   * Map an external entity to Alga entities
   */
  mapToAlga(entity: T): MappedResult | MappedResult[];

  /**
   * Import entities with the given context
   */
  import(context: ImportContext): Promise<void>;
}

/**
 * Abstract base class providing common functionality for importers
 */
export abstract class AbstractImporter<T> implements Importer<T> {
  constructor(protected tenant: string) {}

  abstract fetchPage(cursor?: string, pageSize?: number): Promise<Page<T>>;
  abstract mapToAlga(entity: T): MappedResult | MappedResult[];

  /**
   * Default import implementation that iterates through pages
   */
  async import(context: ImportContext): Promise<void> {
    let cursor: string | undefined;
    let processedCount = 0;
    const pageSize = 100;

    do {
      // Fetch a page of entities
      const page = await this.fetchPage(cursor, pageSize);
      
      // Process each entity in the page
      for (const entity of page.items) {
        try {
          // Map the entity to Alga format
          const mappedResults = this.mapToAlga(entity);
          const results = Array.isArray(mappedResults) ? mappedResults : [mappedResults];
          
          // Process each mapped result
          for (const result of results) {
            try {
              // The workflow will handle the actual upsert
              // We just need to track the mapping
              const externalId = result.externalId;
              
              // Report item processed via callback
              if (context.onItemProcessed) {
                await context.onItemProcessed(
                  externalId,
                  null, // Workflow will provide the actual entity ID
                  'SUCCESS',
                  `Mapped ${result.entityType}`
                );
              }
            } catch (error) {
              console.error(`Error processing mapped result:`, error);
              if (context.onItemProcessed && result.externalId) {
                await context.onItemProcessed(
                  result.externalId,
                  null,
                  'ERROR',
                  error instanceof Error ? error.message : 'Unknown error'
                );
              }
            }
          }
        } catch (error) {
          console.error(`Error mapping entity:`, error);
          // Try to extract an ID for error reporting
          const entityId = this.extractExternalId(entity);
          if (context.onItemProcessed && entityId) {
            await context.onItemProcessed(
              entityId,
              null,
              'ERROR',
              error instanceof Error ? error.message : 'Unknown error'
            );
          }
        }
        
        processedCount++;
        
        // Report progress
        if (context.onProgress && processedCount % 10 === 0) {
          await context.onProgress(processedCount);
        }
      }
      
      cursor = page.nextCursor;
    } while (cursor);
    
    // Final progress report
    if (context.onProgress) {
      await context.onProgress(processedCount);
    }
  }

  /**
   * Extract external ID from entity for error reporting
   * Override in subclasses if needed
   */
  protected extractExternalId(entity: T): string | null {
    if (typeof entity === 'object' && entity !== null) {
      return (entity as any).id || (entity as any).Id || null;
    }
    return null;
  }
}