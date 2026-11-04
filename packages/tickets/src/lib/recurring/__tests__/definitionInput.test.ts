import { describe, expect, it } from 'vitest';
import {
  recurringOccurrenceFiltersSchema,
  recurringSchedulePreviewInputSchema,
  recurringTicketClientUpdateSchema,
  recurringTicketDefinitionInputSchema,
} from '../definitionInput';

const id = '3f8d1f0e-6a43-4a8c-9f7e-1d2b3c4d5e6f';
const valid = {
  name: 'Patching',
  ticket_template_id: id,
  recurrence: { frequency: 'weekly', interval: 1, weekdays: ['mon'], end: { type: 'never' } },
  start_date: '2026-01-05',
};

describe('recurringTicketDefinitionInputSchema', () => {
  it('applies defaults', () => {
    const parsed = recurringTicketDefinitionInputSchema.parse(valid);
    expect(parsed).toMatchObject({
      is_active: true,
      overrides: {},
      status_id: null,
      assigned_to: null,
      additional_agent_ids: [],
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
    ['non-uuid template', { ticket_template_id: 'x' }],
    ['override with a content field', { overrides: { title: 'x' } }],
    ['override with a half board group', { overrides: { board: { board_id: id } } }],
  ])('rejects %s', (_label, patch) => {
    expect(recurringTicketDefinitionInputSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });

  it('requires a ticket template', () => {
    const { ticket_template_id: _omit, ...withoutTemplate } = valid;
    expect(recurringTicketDefinitionInputSchema.safeParse(withoutTemplate).success).toBe(false);
  });

  it.each(['title_template', 'description', 'board_id', 'priority_id', 'category_id', 'subcategory_id', 'tags', 'checklist_template_id'])(
    'no longer accepts the content field %s (the template owns it)',
    (field) => {
      expect(recurringTicketDefinitionInputSchema.safeParse({ ...valid, [field]: field === 'tags' ? [] : null }).success).toBe(false);
    }
  );

  it('accepts overrides for board+status, priority and category, and dispatch fields', () => {
    const parsed = recurringTicketDefinitionInputSchema.parse({
      ...valid,
      status_id: id,
      assigned_team_id: id,
      overrides: { board: { board_id: id, status_id: null }, priority: { priority_id: id }, category: { category_id: id, subcategory_id: null } },
    });
    expect(parsed.overrides.priority?.priority_id).toBe(id);
    expect(parsed.assigned_team_id).toBe(id);
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
