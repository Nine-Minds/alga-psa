import { describe, expect, it } from 'vitest';
import {
  descriptionHasInlineImages,
  templateChecklistToItems,
  ticketTemplateInputSchema,
  ticketToTemplateDraft,
} from './ticketTemplates';

const source = {
  title: 'Jane Smith moved to Sales',
  board_id: 'b1',
  category_id: 'c1',
  subcategory_id: 's1',
  priority_id: 'p1',
  itil_impact: 2,
  itil_urgency: 3,
  attributes: JSON.stringify({
    description: 'Original description',
    custom_fields: { department: 'Sales' },
    watch_list: [{ email: 'w@example.com' }],
    sla_last_response_threshold_notified: 80,
    source_reference: { message_id: 'm' },
    tags: ['legacy'],
  }),
  // never copied, but present on a real row
  client_id: 'client',
  contact_name_id: 'contact',
  assigned_to: 'user',
};

const checklist = [
  { item_name: 'Order laptop', description: null, is_required: true, template_id: null, completed: true, assigned_to: 'u' },
  { item_name: 'X1', description: 'from X', is_required: false, template_id: 'tpl-x' },
] as any[];

describe('ticketToTemplateDraft', () => {
  const draft = ticketToTemplateDraft(source as any, { tags: ['a', ' a ', 'b', ''], checklist });

  it('copies the template copy set', () => {
    expect(draft).toMatchObject({
      name: 'Jane Smith moved to Sales',
      title: 'Jane Smith moved to Sales',
      description: 'Original description',
      board_id: 'b1',
      category_id: 'c1',
      subcategory_id: 's1',
      priority_id: 'p1',
      itil_impact: 2,
      itil_urgency: 3,
      custom_fields: { department: 'Sales' },
    });
    expect(draft.tags).toEqual(['a', 'b']);
  });

  it('drops completion state, assignee, client, contact and system attributes', () => {
    const text = JSON.stringify(draft);
    for (const denied of ['completed', 'assigned_to', 'client_id', 'contact_name_id', 'watch_list', 'sla_last', 'source_reference', 'legacy']) {
      expect(text).not.toContain(denied);
    }
  });

  it('keeps a checklist-template id as checklist_template_id', () => {
    expect(draft.checklist).toEqual([
      { item_name: 'Order laptop', description: null, is_required: true, checklist_template_id: null },
      { item_name: 'X1', description: 'from X', is_required: false, checklist_template_id: 'tpl-x' },
    ]);
  });

  it('runs custom fields through the allowlist and tolerates bad attributes', () => {
    const odd = ticketToTemplateDraft({ ...source, attributes: '{not json' } as any, { tags: [], checklist: [] });
    expect(odd.custom_fields).toEqual({});
    expect(odd.description).toBeNull();
  });
});

describe('ticketTemplateInputSchema', () => {
  const uuid = '11111111-1111-4111-8111-111111111111';
  const base = { name: 'N', title: 'T' };

  it('accepts a minimal template and applies defaults', () => {
    const parsed = ticketTemplateInputSchema.parse(base);
    expect(parsed).toMatchObject({ tags: [], custom_fields: {}, checklist: [], board_id: null, notes: null });
  });

  it('rejects a subcategory without a category', () => {
    expect(ticketTemplateInputSchema.safeParse({ ...base, subcategory_id: uuid }).success).toBe(false);
    expect(ticketTemplateInputSchema.safeParse({ ...base, category_id: uuid, subcategory_id: uuid }).success).toBe(true);
  });

  it('rejects ITIL values out of range', () => {
    expect(ticketTemplateInputSchema.safeParse({ ...base, itil_impact: 0 }).success).toBe(false);
    expect(ticketTemplateInputSchema.safeParse({ ...base, itil_urgency: 6 }).success).toBe(false);
    expect(ticketTemplateInputSchema.safeParse({ ...base, itil_impact: 5, itil_urgency: 1 }).success).toBe(true);
  });

  it('rejects a blank name or title', () => {
    expect(ticketTemplateInputSchema.safeParse({ ...base, name: '   ' }).success).toBe(false);
    expect(ticketTemplateInputSchema.safeParse({ ...base, title: '' }).success).toBe(false);
  });

  it('rejects unknown keys (strict), including on checklist items', () => {
    expect(ticketTemplateInputSchema.safeParse({ ...base, status_id: uuid }).success).toBe(false);
    expect(ticketTemplateInputSchema.safeParse({ ...base, attributes: {} }).success).toBe(false);
    expect(
      ticketTemplateInputSchema.safeParse({ ...base, checklist: [{ item_name: 'x', is_required: true, completed: true }] }).success
    ).toBe(false);
  });
});

describe('templateChecklistToItems', () => {
  it('maps template items to insertable rows, never assigned, keeping checklist-template provenance', () => {
    expect(
      templateChecklistToItems([
        { item_name: 'a', is_required: true },
        { item_name: 'b', description: 'd', is_required: false, checklist_template_id: 'x' },
      ])
    ).toEqual([
      { item_name: 'a', description: null, is_required: true, assigned_to: null, source: 'manual', template_id: null },
      { item_name: 'b', description: 'd', is_required: false, assigned_to: null, source: 'template', template_id: 'x' },
    ]);
  });
});

describe('descriptionHasInlineImages', () => {
  it('detects image blocks and document view urls', () => {
    expect(descriptionHasInlineImages('[{"type":"image","props":{}}]')).toBe(true);
    expect(descriptionHasInlineImages('see /api/documents/view/abc')).toBe(true);
    expect(descriptionHasInlineImages('[{"type":"paragraph"}]')).toBe(false);
    expect(descriptionHasInlineImages(null)).toBe(false);
  });
});
