/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const getDraftMock = vi.fn();
const createTemplateMock = vi.fn();
const getTemplateMock = vi.fn();
const updateTemplateMock = vi.fn();
const replaceMock = vi.fn();
const permissionsMock = vi.fn();

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...rest }: any) => <a href={href} {...rest}>{children}</a>,
}));
// useSearchParams: the shared BackNav reads it to carry returnFilters back to a list.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('../../../actions/ticketTemplateActions', () => ({
  createTicketTemplate: (...args: unknown[]) => createTemplateMock(...args),
  getTicketTemplate: (...args: unknown[]) => getTemplateMock(...args),
  updateTicketTemplate: (...args: unknown[]) => updateTemplateMock(...args),
}));
vi.mock('../../../actions/ticketActions', () => ({
  getTicketTemplateDraftFromTicket: (...args: unknown[]) => getDraftMock(...args),
}));
vi.mock('../useTicketTemplatePermissions', () => ({
  useTicketTemplatePermissions: () => permissionsMock(),
}));
vi.mock('../../useTicketFieldReferenceData', () => ({
  useTicketFieldReferenceData: () => ({
    loading: false, error: null, users: [], teams: [], boards: [], checklistTemplates: [], boardData: {}, ensureBoard: vi.fn(),
  }),
}));
// The shared field groups are covered by the recurring editor's tests; here they just expose their values.
vi.mock('../../recurring/RecurringFieldGroups', () => ({
  BoardStatusFields: ({ value }: any) => <div data-testid="board-value">{value.board_id}</div>,
  PriorityField: ({ value }: any) => <div data-testid="priority-value">{value ?? ''}</div>,
  CategoryField: ({ value }: any) => (
    <div data-testid="category-value">{`${value.category_id ?? ''}/${value.subcategory_id ?? ''}`}</div>
  ),
}));
vi.mock('@alga-psa/tags/components/QuickAddTagPicker', () => ({
  QuickAddTagPicker: ({ pendingTags }: any) => <div data-testid="tags-value">{pendingTags.map((tag: any) => tag.tag_text).join(',')}</div>,
}));
vi.mock('@alga-psa/ui/editor', () => ({
  TextEditor: ({ id, initialContent }: any) => (
    <div data-testid={`${id}-mock-editor`}>{(initialContent ?? []).flatMap((b: any) => (b.content ?? []).map((c: any) => c.text)).join('')}</div>
  ),
  RichTextViewer: () => null,
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: Record<string, unknown>) => {
      const opts = fallback && typeof fallback === 'object' ? fallback : options;
      const text = typeof fallback === 'string' ? fallback : typeof fallback?.defaultValue === 'string' ? fallback.defaultValue : _key;
      return text.replace(/\{\{(\w+)\}\}/g, (_m: string, name: string) => String(opts?.[name] ?? ''));
    },
  }),
}));

import { TicketTemplateEditor } from '../TicketTemplateEditor';

const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SOURCE = UUID(99);

const paragraph = (text: string) =>
  JSON.stringify([{ type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }] }]);

const makeDraft = (overrides: Record<string, unknown> = {}) => ({
  draft: {
    name: 'Jane Smith moved to Sales',
    notes: null,
    title: 'Jane Smith moved to Sales',
    description: paragraph('Move steps'),
    board_id: UUID(1),
    category_id: UUID(2),
    subcategory_id: UUID(3),
    priority_id: UUID(4),
    itil_impact: null,
    itil_urgency: null,
    tags: ['onboarding', 'hardware'],
    custom_fields: { department: 'Sales', shirt_size: 'L' },
    checklist: [
      { item_name: 'Order laptop', description: null, is_required: true, checklist_template_id: null },
      { item_name: 'Create accounts', description: 'AD', is_required: false, checklist_template_id: UUID(7) },
      { item_name: 'Print badge', description: null, is_required: true, checklist_template_id: null },
    ],
    ...overrides,
  },
  source_ticket_number: 'TIC-1042',
  has_inline_images: false,
});

describe('TicketTemplateEditor with ?fromTicket', () => {
  beforeEach(() => {
    getDraftMock.mockReset();
    createTemplateMock.mockReset();
    replaceMock.mockReset();
    getDraftMock.mockResolvedValue(makeDraft());
    createTemplateMock.mockResolvedValue({ template_id: UUID(50) });
    permissionsMock.mockReturnValue({ read: true, create: true, update: true, delete: true, loaded: true });
  });

  async function renderPrefilled() {
    render(<TicketTemplateEditor templateId="new" fromTicketId={SOURCE} />);
    await waitFor(() => expect(getDraftMock).toHaveBeenCalledWith(SOURCE));
    await screen.findByDisplayValue('Order laptop');
  }

  it('shows the banner and prefills every field', async () => {
    await renderPrefilled();

    expect(document.getElementById('ticket-template-from-ticket-banner')).toHaveTextContent(
      'Prefilled from ticket #TIC-1042. Nothing is saved until you click Save.'
    );
    expect(document.getElementById('ticket-template-name')).toHaveValue('Jane Smith moved to Sales');
    expect(document.getElementById('ticket-template-title')).toHaveValue('Jane Smith moved to Sales');
    expect(screen.getByTestId('ticket-template-description-mock-editor')).toHaveTextContent('Move steps');
    expect(screen.getByTestId('board-value')).toHaveTextContent(UUID(1));
    expect(screen.getByTestId('category-value')).toHaveTextContent(`${UUID(2)}/${UUID(3)}`);
    expect(screen.getByTestId('priority-value')).toHaveTextContent(UUID(4));
    expect(screen.getByTestId('tags-value')).toHaveTextContent('onboarding,hardware');

    expect(document.getElementById('ticket-template-checklist-item-0-name')).toHaveValue('Order laptop');
    expect(document.getElementById('ticket-template-checklist-item-1-name')).toHaveValue('Create accounts');
    expect(document.getElementById('ticket-template-checklist-item-2-name')).toHaveValue('Print badge');
    expect(document.getElementById('ticket-template-custom-field-0-name')).toHaveValue('department');
    expect(document.getElementById('ticket-template-custom-field-0-value')).toHaveValue('Sales');
    expect(document.getElementById('ticket-template-custom-field-1-name')).toHaveValue('shirt_size');
  });

  it('removing a checklist item and a custom field, then Save, sends exactly the edited input', async () => {
    await renderPrefilled();

    fireEvent.change(document.getElementById('ticket-template-name') as HTMLElement, {
      target: { value: 'Microsoft 365 Employee Department Change' },
    });
    fireEvent.click(document.getElementById('ticket-template-checklist-item-0-remove') as HTMLElement); // Order laptop
    fireEvent.click(document.getElementById('ticket-template-custom-field-1-remove') as HTMLElement); // shirt_size
    fireEvent.click(document.getElementById('ticket-template-save') as HTMLElement);

    await waitFor(() => expect(createTemplateMock).toHaveBeenCalledTimes(1));
    const [input, sourceTicketId] = createTemplateMock.mock.calls[0];
    expect(sourceTicketId).toBe(SOURCE);
    expect(input).toEqual({
      name: 'Microsoft 365 Employee Department Change',
      notes: null,
      title: 'Jane Smith moved to Sales',
      // A new template is offered in the picker unless the editor says otherwise (R5).
      offer_for_manual_use: true,
      description: paragraph('Move steps'),
      board_id: UUID(1),
      category_id: UUID(2),
      subcategory_id: UUID(3),
      priority_id: UUID(4),
      itil_impact: null,
      itil_urgency: null,
      tags: ['onboarding', 'hardware'],
      custom_fields: { department: 'Sales' },
      checklist: [
        { item_name: 'Create accounts', description: 'AD', is_required: false, checklist_template_id: UUID(7) },
        { item_name: 'Print badge', description: null, is_required: true, checklist_template_id: null },
      ],
    });
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith(`/msp/tickets/templates/${UUID(50)}`));
  });

  it('saves nothing until Save is pressed', async () => {
    await renderPrefilled();
    expect(createTemplateMock).not.toHaveBeenCalled();
  });

  it('shows the inline-image warning only when the source description embeds images', async () => {
    await renderPrefilled();
    expect(document.getElementById('ticket-template-inline-images-warning')).toBeNull();
  });

  it('shows the inline-image warning when the draft reports images', async () => {
    getDraftMock.mockResolvedValue({ ...makeDraft(), has_inline_images: true });
    await renderPrefilled();
    expect(document.getElementById('ticket-template-inline-images-warning')).toHaveTextContent(/images that belong to the source ticket/i);
  });

  it('locks the form and hides Save for a viewer without ticket_template:create', async () => {
    permissionsMock.mockReturnValue({ read: true, create: false, update: false, delete: false, loaded: true });
    await renderPrefilled();
    expect(document.getElementById('ticket-template-save')).toBeNull();
    expect(document.getElementById('ticket-template-view-only-alert')).toBeInTheDocument();
    expect(document.getElementById('ticket-template-name')).toBeDisabled();
  });

  it('shows a validation error instead of saving when the name is blank', async () => {
    await renderPrefilled();
    fireEvent.change(document.getElementById('ticket-template-name') as HTMLElement, { target: { value: '  ' } });
    fireEvent.click(document.getElementById('ticket-template-save') as HTMLElement);
    await waitFor(() => expect(document.getElementById('ticket-template-errors')).toHaveTextContent(/name/i));
    expect(createTemplateMock).not.toHaveBeenCalled();
  });
});
