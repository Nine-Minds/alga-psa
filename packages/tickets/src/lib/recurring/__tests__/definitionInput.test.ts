import { describe, expect, it } from 'vitest';
import {
  recurringOccurrenceFiltersSchema,
  recurringSchedulePreviewInputSchema,
  recurringTicketClientUpdateSchema,
  recurringTicketDefinitionInputSchema,
  titleTemplateSchema,
} from '../definitionInput';

const id = '3f8d1f0e-6a43-4a8c-9f7e-1d2b3c4d5e6f';
const valid = {
  name: 'Patching',
  title_template: '{{client}} patching {{month}}',
  board_id: id,
  priority_id: id,
  recurrence: { frequency: 'weekly', interval: 1, weekdays: ['mon'], end: { type: 'never' } },
  start_date: '2026-01-05',
};

describe('recurringTicketDefinitionInputSchema', () => {
  it('applies defaults', () => {
    const parsed = recurringTicketDefinitionInputSchema.parse(valid);
    expect(parsed).toMatchObject({
      is_active: true,
      description: null,
      status_id: null,
      additional_agent_ids: [],
      tags: [],
      create_time: '08:00',
      due_time: '17:00',
      lead_days: 0,
      non_business_day_policy: 'keep',
      open_previous_policy: 'always_create',
      notify_client_on_create: false,
    });
  });

  it('rejects unknown fields (strict)', () => {
    expect(recurringTicketDefinitionInputSchema.safeParse({ ...valid, ticket_origin: 'web' }).success).toBe(false);
  });

  it.each([
    ['empty name', { name: '   ' }],
    ['bad time', { create_time: '25:00' }],
    ['negative lead', { lead_days: -1 }],
    ['lead too large', { lead_days: 366 }],
    ['fractional lead', { lead_days: 1.5 }],
    ['bad date', { start_date: '2026-02-30' }],
    ['bad policy', { open_previous_policy: 'cancel' }],
    ['non-uuid board', { board_id: 'x' }],
  ])('rejects %s', (_label, patch) => {
    expect(recurringTicketDefinitionInputSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });

  it('requires a category for a subcategory, with a localizable key', () => {
    const result = recurringTicketDefinitionInputSchema.safeParse({ ...valid, subcategory_id: id });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect((result.error.issues[0] as any).params.messageKey).toBe('features/tickets:recurring.errors.subcategoryNeedsCategory');
      expect(result.error.issues[0].path).toEqual(['subcategory_id']);
    }
    expect(recurringTicketDefinitionInputSchema.safeParse({ ...valid, category_id: id, subcategory_id: id }).success).toBe(true);
  });
});

describe('titleTemplateSchema', () => {
  it('trims and accepts known tokens', () => {
    expect(titleTemplateSchema.parse('  {{client}} {{year}}  ')).toBe('{{client}} {{year}}');
  });

  it('rejects unknown tokens naming every one of them', () => {
    const result = titleTemplateSchema.safeParse('{{client}} {{quarter}} {{week}}');
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0] as any;
      expect(issue.params.messageKey).toBe('features/tickets:recurring.errors.unknownTitleTokens');
      expect(issue.params.messageParams.tokens).toBe('{{quarter}}, {{week}}');
      expect(issue.params.messageParams.available).toContain('{{client}}');
    }
  });

  it('rejects empty and over-long titles', () => {
    expect(titleTemplateSchema.safeParse('  ').success).toBe(false);
    expect(titleTemplateSchema.safeParse('a'.repeat(501)).success).toBe(false);
  });
});

describe('other action schemas', () => {
  it('requires every preview field', () => {
    const preview = {
      recurrence: valid.recurrence, start_date: '2026-01-05', create_time: '08:00', due_time: '17:00', lead_days: 0, non_business_day_policy: 'next',
    };
    expect(recurringSchedulePreviewInputSchema.safeParse(preview).success).toBe(true);
    const { lead_days: _omit, ...missing } = preview;
    expect(recurringSchedulePreviewInputSchema.safeParse(missing).success).toBe(false);
  });

  it('validates the client update payload', () => {
    expect(recurringTicketClientUpdateSchema.safeParse({ overrides: {}, contact_id: null, location_id: null, asset_ids: [id] }).success).toBe(true);
    expect(recurringTicketClientUpdateSchema.safeParse({ overrides: {}, contact_id: 'nope', location_id: null, asset_ids: [] }).success).toBe(false);
  });

  it('defaults occurrence filters and caps the page size', () => {
    expect(recurringOccurrenceFiltersSchema.parse({})).toEqual({ page: 1, pageSize: 25 });
    expect(recurringOccurrenceFiltersSchema.safeParse({ pageSize: 500 }).success).toBe(false);
    expect(recurringOccurrenceFiltersSchema.safeParse({ status: 'pending' }).success).toBe(false);
  });
});
