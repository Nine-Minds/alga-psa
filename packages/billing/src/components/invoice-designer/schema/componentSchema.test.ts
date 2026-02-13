import { describe, expect, it } from 'vitest';

import {
  DESIGNER_COMPONENT_SCHEMAS,
  canNestWithinParent,
  getAllowedChildrenForType,
  getAllowedParentsForType,
  getComponentSchema,
} from './componentSchema';
import type { DesignerComponentType } from '../state/designerStore';

describe('componentSchema', () => {
  it('declares defaults, inspector schema, and hierarchy rules for each component type', () => {
    for (const [type, schema] of Object.entries(DESIGNER_COMPONENT_SCHEMAS)) {
      expect(schema.type).toBe(type);
      expect(typeof schema.label).toBe('string');
      expect(schema.label.length).toBeGreaterThan(0);
      expect(typeof schema.description).toBe('string');
      expect(schema.description.length).toBeGreaterThan(0);
      expect(['Structure', 'Content', 'Media', 'Dynamic']).toContain(schema.category);

      // Defaults
      expect(schema.defaults).toBeTruthy();
      expect(typeof schema.defaults).toBe('object');

      // Inspector
      expect(schema.inspector).toBeTruthy();
      expect(Array.isArray(schema.inspector?.panels)).toBe(true);

      // Hierarchy
      expect(Array.isArray(schema.hierarchy.allowedChildren)).toBe(true);
      expect(Array.isArray(schema.hierarchy.allowedParents)).toBe(true);

      // Helper accessors should align with the schema source of truth.
      expect(getAllowedChildrenForType(schema.type)).toEqual(schema.hierarchy.allowedChildren);
      expect(getAllowedParentsForType(schema.type)).toEqual(schema.hierarchy.allowedParents);
      expect(getComponentSchema(schema.type)).toBe(schema);
    }
  });

  it('defines reciprocal allowedParents/allowedChildren (nesting checks resolve via schema only)', () => {
    for (const [parentType, parentSchema] of Object.entries(DESIGNER_COMPONENT_SCHEMAS) as Array<
      [DesignerComponentType, (typeof DESIGNER_COMPONENT_SCHEMAS)[DesignerComponentType]]
    >) {
      for (const childType of parentSchema.hierarchy.allowedChildren) {
        const childSchema = getComponentSchema(childType);
        expect(childSchema.hierarchy.allowedParents).toContain(parentType);
        expect(canNestWithinParent(childType, parentType)).toBe(true);
      }
    }

    for (const [childType, childSchema] of Object.entries(DESIGNER_COMPONENT_SCHEMAS) as Array<
      [DesignerComponentType, (typeof DESIGNER_COMPONENT_SCHEMAS)[DesignerComponentType]]
    >) {
      for (const parentType of childSchema.hierarchy.allowedParents) {
        const parentSchema = getComponentSchema(parentType);
        expect(parentSchema.hierarchy.allowedChildren).toContain(childType);
        expect(canNestWithinParent(childType, parentType)).toBe(true);
      }
    }
  });
});
