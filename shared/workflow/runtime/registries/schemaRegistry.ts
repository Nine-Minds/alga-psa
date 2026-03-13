import { ZodSchema } from 'zod';
import { zodToWorkflowJsonSchema } from '../jsonSchemaMetadata';

export type JsonSchema = Record<string, unknown>;

export class SchemaRegistry {
  private schemas: Map<string, ZodSchema<unknown>> = new Map();
  private jsonSchemaCache: Map<string, JsonSchema> = new Map();
  private refsCache: string[] | null = null;

  register(ref: string, schema: ZodSchema<unknown>): void {
    if (!ref || !schema) {
      throw new Error('SchemaRegistry.register requires ref and schema');
    }
    if (this.schemas.has(ref)) {
      throw new Error(`SchemaRegistry already has schema for ref "${ref}"`);
    }
    this.schemas.set(ref, schema);
    this.jsonSchemaCache.delete(ref);
    this.refsCache = null;
  }

  get(ref: string): ZodSchema<unknown> {
    const schema = this.schemas.get(ref);
    if (!schema) {
      throw new Error(`SchemaRegistry missing schema for ref "${ref}"`);
    }
    return schema;
  }

  has(ref: string): boolean {
    return this.schemas.has(ref);
  }

  listRefs(): string[] {
    if (this.refsCache) return this.refsCache;
    this.refsCache = Array.from(this.schemas.keys()).sort();
    return this.refsCache;
  }

  toJsonSchema(ref: string): JsonSchema {
    const cached = this.jsonSchemaCache.get(ref);
    if (cached) return cached;
    const schema = this.get(ref);
    const json = zodToWorkflowJsonSchema(schema, { name: ref }) as JsonSchema;
    this.jsonSchemaCache.set(ref, json);
    return json;
  }
}

let registryInstance: SchemaRegistry | null = null;

export function getSchemaRegistry(): SchemaRegistry {
  if (!registryInstance) {
    registryInstance = new SchemaRegistry();
  }
  return registryInstance;
}
