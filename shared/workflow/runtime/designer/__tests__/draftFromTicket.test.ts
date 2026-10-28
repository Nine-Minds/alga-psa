import { beforeAll, describe, expect, it } from 'vitest';
import { initializeWorkflowRuntimeV2 } from '../../init';
import { workflowDefinitionSchema } from '../../types';
import { validateWorkflowDefinition } from '../../validation/publishValidation';
import {
  buildWorkflowDraftFromTicket,
  splitTicketChecklist,
  type TicketWorkflowBlueprint,
  type TicketWorkflowIncludeOptions,
} from '../draftFromTicket';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function blueprint(overrides: Partial<TicketWorkflowBlueprint> = {}): TicketWorkflowBlueprint {
  return {
    ticket_id: U(1),
    ticket_number: 'T-100',
    title: 'Onboard new hire',
    description: 'Set up laptop',
    client: { id: U(2), name: 'Acme', type: 'company' },
    contact: { id: U(3), name: 'Ada' },
    location_id: U(4),
    board_id: U(5),
    category_id: U(6),
    subcategory_id: U(7),
    priority_id: U(8),
    assigned_to: U(9),
    assigned_team_id: null,
    additional_agents: [{ user_id: U(10), first_name: 'B', last_name: 'C' }],
    tags: [{ tag_id: U(11), tag_text: 'onboarding' }, { tag_id: U(12), tag_text: 'hr' }],
    custom_fields: { field_a: 'x' },
    checklist: [],
    ...overrides,
  };
}

const ALL: TicketWorkflowIncludeOptions = { assignment: true, tags: true, customFields: true, checklist: true };
const NONE: TicketWorkflowIncludeOptions = { assignment: false, tags: false, customFields: false, checklist: false };
const MANUAL = { kind: 'manual' } as const;

const item = (name: string, extra: Partial<TicketWorkflowBlueprint['checklist'][number]> = {}) => ({
  item_name: name,
  description: null,
  is_required: false,
  template_id: null,
  template_name: null,
  template_is_active: null,
  ...extra,
});

const build = (b: TicketWorkflowBlueprint, include = ALL, trigger: any = MANUAL) =>
  buildWorkflowDraftFromTicket(b, { name: 'My workflow', trigger, include }) as any;
const createInput = (def: any) => def.steps[0].config.inputMapping;

describe('buildWorkflowDraftFromTicket', () => {
  it('builds a manual draft with a literal tickets.create step', () => {
    const def = build(blueprint());
    expect(def.trigger).toBeUndefined();
    expect(def.payloadSchemaRef).toBe('payload.Empty.v1');
    expect(def.name).toBe('My workflow');
    expect(def.description).toBe('Created from ticket #T-100 (Onboard new hire)');
    expect(def.steps).toHaveLength(1);
    expect(def.steps[0]).toMatchObject({
      id: 'create-ticket',
      type: 'action.call',
      config: { actionId: 'tickets.create', version: 1, saveAs: 'createdTicket' },
    });
    expect(createInput(def)).toEqual({
      client_id: U(2), contact_id: U(3), location_id: U(4), title: 'Onboard new hire', description: 'Set up laptop',
      board_id: U(5), category_id: U(6), subcategory_id: U(7), priority_id: U(8),
      assignment: { primary: { type: 'user', id: U(9) }, additional_user_ids: [U(10)] },
      tags: ['onboarding', 'hr'],
      custom_fields: { field_a: 'x' },
      notify: { internal: true, contact: false },
    });
    expect(createInput(def)).not.toHaveProperty('status_id');
  });

  it('honours each include toggle independently; properties are always included', () => {
    const base = createInput(build(blueprint(), NONE));
    expect(base).toMatchObject({ client_id: U(2), board_id: U(5), priority_id: U(8), title: 'Onboard new hire' });
    expect(base).not.toHaveProperty('assignment');
    expect(base).not.toHaveProperty('tags');
    expect(base).not.toHaveProperty('custom_fields');
    expect(base.notify).toEqual({ internal: true, contact: false });

    expect(createInput(build(blueprint(), { ...NONE, assignment: true }))).toHaveProperty('assignment');
    expect(createInput(build(blueprint(), { ...NONE, tags: true }))).toHaveProperty('tags');
    expect(createInput(build(blueprint(), { ...NONE, customFields: true }))).toHaveProperty('custom_fields');
  });

  it('uses a team primary when only a team is assigned', () => {
    const input = createInput(build(blueprint({ assigned_to: null, assigned_team_id: U(20) })));
    expect(input.assignment.primary).toEqual({ type: 'team', id: U(20) });
  });

  it('omits assignment when there is no primary (additional agents need one)', () => {
    const input = createInput(build(blueprint({ assigned_to: null, assigned_team_id: null })));
    expect(input).not.toHaveProperty('assignment');
  });

  it('omits empty optional values', () => {
    const input = createInput(build(blueprint({ contact: null, location_id: null, category_id: null, subcategory_id: null, tags: [], custom_fields: {} })));
    for (const key of ['contact_id', 'location_id', 'category_id', 'subcategory_id', 'tags', 'custom_fields']) {
      expect(input).not.toHaveProperty(key);
    }
  });

  it('adds no checklist steps when the ticket has no checklist or checklist is off', () => {
    expect(build(blueprint()).steps).toHaveLength(1);
    expect(build(blueprint({ checklist: [item('A')] }), { ...ALL, checklist: false }).steps).toHaveLength(1);
  });

  it('emits one apply step per distinct active template then one ad-hoc step, in source order', () => {
    const t1 = { template_id: U(30), template_name: 'Onboarding', template_is_active: true };
    const t2 = { template_id: U(31), template_name: 'Security', template_is_active: true };
    const def = build(blueprint({
      checklist: [
        item('manual 1', { description: 'details', is_required: true }),
        item('t1 a', t1), item('t2 a', t2), item('t1 b', t1),
        item('manual 2'),
      ],
    }));
    expect(def.steps.map((s: any) => s.id)).toEqual(['create-ticket', 'apply-checklist-1', 'apply-checklist-2', 'add-checklist-items']);
    expect(def.steps[1].config).toMatchObject({
      actionId: 'tickets.apply_checklist',
      inputMapping: { ticket_id: { $expr: 'vars.createdTicket.ticket_id' }, template_id: U(30) },
    });
    expect(def.steps[1].name).toBe('Apply checklist: Onboarding');
    expect(def.steps[2].config.inputMapping.template_id).toBe(U(31));
    expect(def.steps[3].config).toMatchObject({
      actionId: 'tickets.add_checklist_items',
      inputMapping: {
        ticket_id: { $expr: 'vars.createdTicket.ticket_id' },
        items: [
          { item_name: 'manual 1', description: 'details', is_required: true },
          { item_name: 'manual 2', is_required: false },
        ],
      },
    });
  });

  it('sends items of an inactive or missing template to the ad-hoc step', () => {
    const def = build(blueprint({
      checklist: [
        item('inactive', { template_id: U(40), template_name: 'Old', template_is_active: false }),
        item('gone', { template_id: U(41), template_name: null, template_is_active: null }),
      ],
    }));
    expect(def.steps.map((s: any) => s.id)).toEqual(['create-ticket', 'add-checklist-items']);
    expect(def.steps[1].config.inputMapping.items.map((i: any) => i.item_name)).toEqual(['inactive', 'gone']);
  });

  it('splitTicketChecklist keeps template order of first appearance', () => {
    const split = splitTicketChecklist([
      item('a', { template_id: U(2), template_name: 'B', template_is_active: true }),
      item('b', { template_id: U(1), template_name: 'A', template_is_active: true }),
      item('c', { template_id: U(2), template_name: 'B', template_is_active: true }),
    ]);
    expect(split.templates.map((t) => t.template_id)).toEqual([U(2), U(1)]);
    expect(split.adHocItems).toEqual([]);
  });

  describe('validation', () => {
    beforeAll(() => initializeWorkflowRuntimeV2());

    const rich = blueprint({
      checklist: [
        item('manual', { is_required: true }),
        item('tpl', { template_id: U(30), template_name: 'Onboarding', template_is_active: true }),
      ],
    });

    it.each([
      ['Manual', MANUAL],
      ['TICKET_CREATED', { kind: 'trigger', payloadSchemaRef: 'payload.TicketCreated.v1', trigger: { type: 'event', eventName: 'TICKET_CREATED' } }],
    ])('parses and validates with zero errors (%s)', (_label, trigger) => {
      const def = build(rich, ALL, trigger);
      const parsed = workflowDefinitionSchema.parse(def);
      const result = validateWorkflowDefinition(parsed);
      expect(result.errors).toEqual([]);
      expect(result.ok).toBe(true);
    });
  });
});
