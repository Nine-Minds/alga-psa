import { describe, expect, it } from 'vitest';
import { getSchemaRegistry, initializeWorkflowRuntimeV2 } from '@shared/workflow/runtime';
import fs from 'node:fs/promises';
import path from 'node:path';

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

function getTopLevelPropertyKeys(root: any, jsonSchema: any): string[] {
  const schema = resolveLocalRef(root, jsonSchema);

  if (!schema || typeof schema !== 'object') {
    return [];
  }

  if (schema.properties && typeof schema.properties === 'object') {
    return Object.keys(schema.properties);
  }

  if (Array.isArray(schema.allOf)) {
    const merged = new Set<string>();
    for (const part of schema.allOf) {
      for (const key of getTopLevelPropertyKeys(root, part)) {
        merged.add(key);
      }
    }
    return Array.from(merged);
  }

  if (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)) {
    const variants: any[] = Array.isArray(schema.anyOf) ? schema.anyOf : schema.oneOf;
    const merged = new Set<string>();
    for (const part of variants) {
      for (const key of getTopLevelPropertyKeys(root, part)) {
        merged.add(key);
      }
    }
    return Array.from(merged);
  }

  return [];
}

function getRequiredKeys(root: any, jsonSchema: any): string[] {
  const schema = resolveLocalRef(root, jsonSchema);

  if (!schema || typeof schema !== 'object') {
    return [];
  }

  if (Array.isArray(schema.required)) {
    return schema.required.slice();
  }

  if (Array.isArray(schema.allOf)) {
    const merged = new Set<string>();
    for (const part of schema.allOf) {
      for (const key of getRequiredKeys(root, part)) {
        merged.add(key);
      }
    }
    return Array.from(merged);
  }

  if (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)) {
    const variants: any[] = Array.isArray(schema.anyOf) ? schema.anyOf : schema.oneOf;
    const variantSets = variants.map((part) => new Set(getRequiredKeys(root, part)));
    if (variantSets.length === 0) {
      return [];
    }

    const intersection = new Set<string>(variantSets[0]);
    for (const set of variantSets.slice(1)) {
      for (const key of Array.from(intersection)) {
        if (!set.has(key)) {
          intersection.delete(key);
        }
      }
    }
    return Array.from(intersection);
  }

  return [];
}

describe('workflow event payload schemas: conventions', () => {
  it('require tenantId + occurredAt, use camelCase keys, and use consistent transition fields', async () => {
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

    const toPayloadSchemaRef = (eventType: string) => {
      const pascal = String(eventType)
        .toLowerCase()
        .split('_')
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join('');
      return `payload.${pascal}.v1`;
    };

    expect(eventTypes.size).toBeGreaterThan(0);

    for (const eventType of eventTypes) {
      const ref = toPayloadSchemaRef(eventType);
      expect(registry.has(ref)).toBe(true);

      const jsonSchema = registry.toJsonSchema(ref) as any;
      const required = new Set(getRequiredKeys(jsonSchema, jsonSchema));
      expect(required.has('tenantId')).toBe(true);
      expect(required.has('occurredAt')).toBe(true);

      const props = getTopLevelPropertyKeys(jsonSchema, jsonSchema);
      for (const key of props) {
        expect(key.includes('_')).toBe(false);
      }

      // Mutation payloads should include both updatedFields and changes.
      const hasUpdatedFields = props.includes('updatedFields');
      const hasChanges = props.includes('changes');
      expect(hasUpdatedFields).toBe(hasChanges);

      // Transition payloads should include previousX and newX as a pair (if either exists).
      const previousKeys = props.filter((k) => k.startsWith('previous') && k.length > 'previous'.length);
      const previousWithoutNewAllowed = new Set<string>([
        // "Unassigned" / "unlinked" events intentionally omit "new*" fields (new value is "none").
        'previousAssigneeId',
        'previousAssigneeType',
        'previousOwnerId',
        'previousOwnerType',
      ]);

      const expectedNew = new Set(
        previousKeys
          .filter((k) => !previousWithoutNewAllowed.has(k))
          .map((k) => `new${k.slice('previous'.length)}`)
      );

      for (const key of expectedNew) {
        if (!props.includes(key)) {
          const alternateNewByPreviousKey: Record<string, string[]> = {
            // CONTACT_PRIMARY_SET uses `contactId` as the "new primary contact" field.
            previousPrimaryContactId: ['contactId'],
          };

          const previousKey = `previous${key.slice('new'.length)}`;
          const alternates = alternateNewByPreviousKey[previousKey] ?? [];
          const hasAlternate = alternates.some((alt) => props.includes(alt));

          if (!hasAlternate) {
            throw new Error(`Schema convention violation: ${eventType} (${ref}) has ${previousKeys.join(', ')} but missing ${key}`);
          }
        }
      }
    }
  });
});
