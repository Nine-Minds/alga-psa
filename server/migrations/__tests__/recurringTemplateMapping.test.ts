import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { dedupeTemplateName, mapDefinitionToTemplate, MIGRATION_NOTE_PREFIX } = require(
  path.resolve(__dirname, '..', 'utils', 'recurringTemplateMapping.cjs')
);

const definition = (overrides: Record<string, unknown> = {}) => ({
  name: 'Monthly patching',
  title_template: 'Patching for {{client}} - {{month}}',
  description: [{ type: 'paragraph', children: [{ text: 'Apply patches' }] }],
  board_id: 'board-1',
  category_id: 'cat-1',
  subcategory_id: 'sub-1',
  priority_id: 'prio-1',
  tags: ['patching', 'monthly'],
  checklist_template_id: null,
  ...overrides,
});

describe('dedupeTemplateName', () => {
  it('keeps the name when it is free', () => {
    const taken = new Set<string>();
    expect(dedupeTemplateName('Monthly patching', taken)).toBe('Monthly patching');
    expect(taken.has('monthly patching')).toBe(true);
  });

  it('compares case-insensitively against active template names', () => {
    expect(dedupeTemplateName('Monthly Patching', new Set(['monthly patching']))).toBe('Monthly Patching (recurring)');
  });

  it('numbers further collisions from 2', () => {
    const taken = new Set(['report', 'report (recurring)']);
    expect(dedupeTemplateName('Report', taken)).toBe('Report (recurring 2)');
    expect(dedupeTemplateName('Report', taken)).toBe('Report (recurring 3)');
  });

  it('keeps two definitions with the same name apart within one batch', () => {
    const taken = new Set<string>();
    expect([dedupeTemplateName('Same', taken), dedupeTemplateName('same', taken)]).toEqual(['Same', 'same (recurring)']);
  });

  it('stays within 200 characters when the suffix is added', () => {
    const long = 'x'.repeat(200);
    const name = dedupeTemplateName(long, new Set([long]));
    expect(name.length).toBeLessThanOrEqual(200);
    expect(name.endsWith(' (recurring)')).toBe(true);
  });
});

describe('mapDefinitionToTemplate', () => {
  it('copies the content fields and marks the template as scheduled-only', () => {
    const { template, items } = mapDefinitionToTemplate(definition(), [], new Set());
    expect(template).toMatchObject({
      name: 'Monthly patching',
      title: 'Patching for {{client}} - {{month}}',
      board_id: 'board-1',
      category_id: 'cat-1',
      subcategory_id: 'sub-1',
      priority_id: 'prio-1',
      itil_impact: null,
      itil_urgency: null,
      custom_fields: '{}',
      offer_for_manual_use: false,
      is_active: true,
    });
    expect(template.notes).toBe(`${MIGRATION_NOTE_PREFIX}Monthly patching on migration`);
    expect(JSON.parse(template.tags)).toEqual(['patching', 'monthly']);
    expect(items).toEqual([]);
  });

  it('writes the description exactly as the legacy generator did (R7)', () => {
    const def = definition();
    expect(mapDefinitionToTemplate(def, [], new Set()).template.description).toBe(JSON.stringify(def.description));
  });

  it('accepts jsonb columns that arrive as strings', () => {
    const def = definition({ description: JSON.stringify([{ a: 1 }]), tags: '["a"]' });
    const { template } = mapDefinitionToTemplate(def, [], new Set());
    expect(template.description).toBe('[{"a":1}]');
    expect(template.tags).toBe('["a"]');
  });

  it('maps a missing description to null', () => {
    expect(mapDefinitionToTemplate(definition({ description: null }), [], new Set()).template.description).toBeNull();
  });

  it('drops a subcategory that has no category', () => {
    const { template } = mapDefinitionToTemplate(definition({ category_id: null }), [], new Set());
    expect(template.subcategory_id).toBeNull();
  });

  it('snapshots checklist items in order, re-indexed, tagged with their checklist template (R6)', () => {
    const { items } = mapDefinitionToTemplate(
      definition({ checklist_template_id: 'ct-1' }),
      [
        { item_name: 'Second', order_number: 5, is_required: false, description: 'd' },
        { item_name: 'First', order_number: 2, is_required: true },
      ],
      new Set()
    );
    expect(items).toEqual([
      { item_name: 'First', description: null, is_required: true, order_number: 0, checklist_template_id: 'ct-1' },
      { item_name: 'Second', description: 'd', is_required: false, order_number: 1, checklist_template_id: 'ct-1' },
    ]);
  });

  it('ignores checklist rows when the definition has no checklist template', () => {
    const { items } = mapDefinitionToTemplate(definition(), [{ item_name: 'x', order_number: 0 }], new Set());
    expect(items).toEqual([]);
  });

  it('dedupes the template name against the taken set', () => {
    const { template } = mapDefinitionToTemplate(definition(), [], new Set(['monthly patching']));
    expect(template.name).toBe('Monthly patching (recurring)');
  });
});
