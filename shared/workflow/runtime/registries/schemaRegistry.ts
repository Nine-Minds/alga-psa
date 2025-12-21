import { ZodSchema } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export type JsonSchema = Record<string, unknown>;

export class SchemaRegistry {
  private schemas: Map<string, ZodSchema<any>> = new Map();

  register(ref: string, schema: ZodSchema<any>): void {
    if (!ref || !schema) {
      throw new Error('SchemaRegistry.register requires ref and schema');
    }
    if (this.schemas.has(ref)) {
      throw new Error(`SchemaRegistry already has schema for ref "${ref}"`);
    }
    this.schemas.set(ref, schema);
  }

  get(ref: string): ZodSchema<any> {
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
    return Array.from(this.schemas.keys()).sort();
  }

  toJsonSchema(ref: string): JsonSchema {
    const schema = this.get(ref);
    return zodToJsonSchema(schema, {
      name: ref
    }) as JsonSchema;
  }
}

let registryInstance: SchemaRegistry | null = null;

export function getSchemaRegistry(): SchemaRegistry {
  if (!registryInstance) {
    registryInstance = new SchemaRegistry();
  }
  return registryInstance;
}
