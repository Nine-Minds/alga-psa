import { describe, expect, it } from 'vitest';
import {
  buildTicketRoutingExecutionConfig,
  getServiceRequestDraftLifecycleLabel,
  resolveTicketSubjectTemplate,
  type TicketRoutingConfigInput,
} from '../../lib/service-requests/editorHelpers';

function createRoutingInput(overrides: Partial<TicketRoutingConfigInput> = {}): TicketRoutingConfigInput {
  return {
    boardId: 'board-123',
    statusId: 'status-123',
    priorityId: 'priority-123',
    categoryId: '',
    subcategoryId: '',
    assignedToUserId: '',
    itilImpact: '',
    itilUrgency: '',
    titleTemplate: '{{request_title}}',
    descriptionPrefix: 'Portal Service Request',
    ...overrides,
  };
}

describe('service request editor helpers', () => {
  it('maps lifecycle labels to the authoring labels shown in the editor', () => {
    expect(getServiceRequestDraftLifecycleLabel('draft', false)).toBe('draft');
    expect(getServiceRequestDraftLifecycleLabel('draft', true)).toBe('draft changes');
    expect(getServiceRequestDraftLifecycleLabel('published', true)).toBe('published/live');
    expect(getServiceRequestDraftLifecycleLabel('archived', false)).toBe('archived');
    expect(getServiceRequestDraftLifecycleLabel(undefined, false)).toBeUndefined();
  });

  it('preserves non-routing execution config while replacing routing-specific keys', () => {
    const nextConfig = buildTicketRoutingExecutionConfig({
      existingExecutionConfig: {
        titleTemplate: 'New Hire Setup: {{employee_name}}',
        includeFormResponsesInDescription: true,
        boardId: 'old-board',
        statusId: 'old-status',
        priorityId: 'old-priority',
        itilImpact: 1,
      },
      ticketRoutingConfigInput: createRoutingInput({
        boardId: 'board-456',
        statusId: 'status-456',
        priorityId: 'priority-456',
      }),
      boardPriorityType: 'custom',
    });

    expect(nextConfig).toEqual({
      // The editor owns the subject template, so the saved input replaces the existing one.
      titleTemplate: '{{request_title}}',
      includeFormResponsesInDescription: true,
      boardId: 'board-456',
      statusId: 'status-456',
      priorityId: 'priority-456',
      descriptionPrefix: 'Portal Service Request',
    });
  });

  it('stores ITIL routing values and derives category plus subcategory ids', () => {
    const nextConfig = buildTicketRoutingExecutionConfig({
      existingExecutionConfig: {
        includeFormResponsesInDescription: true,
      },
      ticketRoutingConfigInput: createRoutingInput({
        priorityId: '',
        itilImpact: '2',
        itilUrgency: '4',
      }),
      selectedCategory: {
        category_id: 'subcategory-123',
        parent_category: 'category-123',
      },
      boardPriorityType: 'itil',
    });

    expect(nextConfig).toEqual({
      includeFormResponsesInDescription: true,
      boardId: 'board-123',
      statusId: 'status-123',
      categoryId: 'category-123',
      subcategoryId: 'subcategory-123',
      titleTemplate: '{{request_title}}',
      descriptionPrefix: 'Portal Service Request',
      itilImpact: 2,
      itilUrgency: 4,
    });
  });

  it('writes titleTemplate and removes a legacy titleFieldKey', () => {
    const nextConfig = buildTicketRoutingExecutionConfig({
      existingExecutionConfig: { titleFieldKey: 'request_title', titleTemplate: 'Old: {{a}}' },
      ticketRoutingConfigInput: createRoutingInput({ titleTemplate: '  New Hire: {{employee_name}}  ' }),
      boardPriorityType: 'custom',
    });

    expect(nextConfig.titleTemplate).toBe('New Hire: {{employee_name}}');
    expect(nextConfig).not.toHaveProperty('titleFieldKey');
  });

  it('removes both title keys when the subject template is blank', () => {
    const nextConfig = buildTicketRoutingExecutionConfig({
      existingExecutionConfig: { titleFieldKey: 'request_title', titleTemplate: 'Old: {{a}}' },
      ticketRoutingConfigInput: createRoutingInput({ titleTemplate: '   ' }),
      boardPriorityType: 'custom',
    });

    expect(nextConfig).not.toHaveProperty('titleTemplate');
    expect(nextConfig).not.toHaveProperty('titleFieldKey');
  });

  it('resolves the subject template from titleTemplate, a legacy titleFieldKey, or nothing', () => {
    expect(resolveTicketSubjectTemplate({ titleTemplate: 'A {{b}}', titleFieldKey: 'c' })).toBe('A {{b}}');
    expect(resolveTicketSubjectTemplate({ titleFieldKey: 'request_title' })).toBe('{{request_title}}');
    expect(resolveTicketSubjectTemplate({ titleTemplate: '  ', titleFieldKey: 'request_title' })).toBe('{{request_title}}');
    expect(resolveTicketSubjectTemplate({})).toBe('');
    expect(resolveTicketSubjectTemplate(null)).toBe('');
  });
});
