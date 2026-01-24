import { describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getSchemaRegistry, initializeWorkflowRuntimeV2 } from '@shared/workflow/runtime';

function resolveLocalRef(root: any, schema: any): any {
  if (!schema || typeof schema !== 'object') {
    return schema;
  }
  if (typeof schema.$ref !== 'string') {
    return schema;
  }
  const ref = schema.$ref;
  if (!ref.startsWith('#/')) {
    return schema;
  }

  const parts = ref.slice(2).split('/');
  let current: any = root;
  for (const part of parts) {
    if (!current || typeof current !== 'object') {
      return schema;
    }
    current = current[part];
  }
  return current ?? schema;
}

function pickFirstVariant(root: any, schema: any): any {
  const resolved = resolveLocalRef(root, schema);
  if (!resolved || typeof resolved !== 'object') {
    return resolved;
  }
  if (Array.isArray(resolved.oneOf) && resolved.oneOf.length > 0) {
    return pickFirstVariant(root, resolved.oneOf[0]);
  }
  if (Array.isArray(resolved.anyOf) && resolved.anyOf.length > 0) {
    return pickFirstVariant(root, resolved.anyOf[0]);
  }
  return resolved;
}

function getRequiredKeys(root: any, schema: any): string[] {
  const resolved = resolveLocalRef(root, schema);
  if (!resolved || typeof resolved !== 'object') {
    return [];
  }
  if (Array.isArray(resolved.required)) {
    return resolved.required.slice();
  }
  if (Array.isArray(resolved.allOf)) {
    const merged = new Set<string>();
    for (const part of resolved.allOf) {
      for (const key of getRequiredKeys(root, part)) {
        merged.add(key);
      }
    }
    return Array.from(merged);
  }
  return [];
}

function generateExample(root: any, schema: any): any {
  const resolved = pickFirstVariant(root, schema);
  if (!resolved || typeof resolved !== 'object') {
    return undefined;
  }

  if (Array.isArray(resolved.allOf) && resolved.allOf.length > 0) {
    const merged: Record<string, unknown> = {};
    for (const part of resolved.allOf) {
      const partExample = generateExample(root, part);
      if (partExample && typeof partExample === 'object' && !Array.isArray(partExample)) {
        Object.assign(merged, partExample);
      }
    }
    return merged;
  }

  if (resolved.const !== undefined) {
    return resolved.const;
  }
  if (Array.isArray(resolved.enum) && resolved.enum.length > 0) {
    return resolved.enum[0];
  }

  const type = resolved.type;
  if (type === 'string') {
    if (resolved.format === 'uuid') return uuidv4();
    if (resolved.format === 'date-time') return new Date().toISOString();
    if (resolved.format === 'email') return 'test@example.com';
    if (resolved.format === 'uri') return 'https://example.com';
    const minLength = typeof resolved.minLength === 'number' ? resolved.minLength : 1;
    return 'x'.repeat(Math.max(1, minLength));
  }
  if (type === 'integer' || type === 'number') {
    if (typeof resolved.exclusiveMinimum === 'number') return type === 'integer' ? resolved.exclusiveMinimum + 1 : resolved.exclusiveMinimum + 0.1;
    if (typeof resolved.minimum === 'number') return resolved.minimum;
    return 0;
  }
  if (type === 'boolean') return false;
  if (type === 'array') {
    const minItems = typeof resolved.minItems === 'number' ? resolved.minItems : 0;
    const itemExample = generateExample(root, resolved.items ?? {});
    return Array.from({ length: Math.max(0, minItems) }, () => itemExample);
  }
  if (type === 'object' || resolved.properties || resolved.allOf) {
    const required = new Set(getRequiredKeys(root, resolved));
    const properties: Record<string, any> = resolved.properties ?? {};

    const obj: Record<string, unknown> = {};
    for (const key of required) {
      obj[key] = generateExample(root, properties[key] ?? {});
    }

    obj.tenantId ??= uuidv4();
    obj.occurredAt ??= new Date().toISOString();
    return obj;
  }

  return undefined;
}

describe('workflow event simulator: form-mode schema builder', () => {
  it('can build JSON schema for every proposed payload_schema_ref', async () => {
    initializeWorkflowRuntimeV2();
    const registry = getSchemaRegistry();

    const proposalsPath = path.join(
      process.cwd(),
      'ee',
      'docs',
      'plans',
      '2025-12-28-workflow-event-catalog',
      'event-proposals.md'
    );
    const proposals = await fs.readFile(proposalsPath, 'utf8');

    const eventTypes = new Set<string>();
    for (const match of proposals.matchAll(/`([A-Z0-9_]+)`\s+—/g)) {
      eventTypes.add(match[1]);
    }
    expect(eventTypes.size).toBeGreaterThan(0);

    const toPayloadSchemaRef = (eventType: string) => {
      const pascal = String(eventType)
        .toLowerCase()
        .split('_')
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join('');
      return `payload.${pascal}.v1`;
    };

    for (const eventType of eventTypes) {
      const ref = toPayloadSchemaRef(eventType);
      expect(registry.has(ref)).toBe(true);

      const jsonSchema = registry.toJsonSchema(ref) as any;
      expect(jsonSchema).toBeTruthy();
      expect(typeof jsonSchema).toBe('object');
      expect(
        Boolean(
          jsonSchema.type ||
            jsonSchema.$ref ||
            jsonSchema.properties ||
            jsonSchema.anyOf ||
            jsonSchema.oneOf ||
            jsonSchema.allOf
        )
      ).toBe(true);
    }
  });

  it('returns validation errors for invalid payloads (sampled)', async () => {
    initializeWorkflowRuntimeV2();
    const registry = getSchemaRegistry();

    const sampleRefs = [
      'payload.TicketStatusChanged.v1',
      'payload.InvoiceSent.v1',
      'payload.DocumentAssociated.v1',
      'payload.IntegrationWebhookReceived.v1',
      'payload.FileUploaded.v1',
    ];

    for (const ref of sampleRefs) {
      expect(registry.has(ref)).toBe(true);
      const schema = registry.get(ref);
      const jsonSchema = registry.toJsonSchema(ref) as any;
      const example = generateExample(jsonSchema, jsonSchema);

      expect(schema.safeParse(example).success).toBe(true);

      const required = getRequiredKeys(jsonSchema, jsonSchema).filter((k) => !['tenantId', 'occurredAt'].includes(k));
      if (required.length === 0) {
        continue;
      }

      const invalid = { ...(example as any) };
      delete invalid[required[0]];
      expect(schema.safeParse(invalid).success).toBe(false);
    }
  });
});

