/**
 * What the "Add" tab offers, grouped by purpose. Each entry is a field type plus the element
 * the author gets when they click or drop it.
 *
 * Phase 2 adds a "Data" group here (pickers backed by the client's own data); phase 3 adds
 * containers (steps, repeatable groups). Both are new rows in this table, nothing more.
 */
import type { FieldTypeKey } from '@alga-psa/ui/form-fields';
import type { BasicFormField } from '../../../../lib/service-requests/formSchema';

/** Palette categories, in the order the pane shows them. */
export const FORM_PALETTE_CATEGORY_ORDER = [
  'text',
  'choices',
  'datesAndNumbers',
  'files',
  'layout',
] as const;

export type FormPaletteCategory = (typeof FORM_PALETTE_CATEGORY_ORDER)[number];

export interface FormPaletteEntry {
  id: FieldTypeKey;
  category: FormPaletteCategory;
  /** Lucide icon name, resolved by the palette component. */
  icon: string;
  sortOrder: number;
}

export const FORM_PALETTE_ENTRIES: readonly FormPaletteEntry[] = [
  { id: 'short-text', category: 'text', icon: 'Type', sortOrder: 1 },
  { id: 'long-text', category: 'text', icon: 'AlignLeft', sortOrder: 2 },
  { id: 'email', category: 'text', icon: 'Mail', sortOrder: 3 },
  { id: 'phone', category: 'text', icon: 'Phone', sortOrder: 4 },
  { id: 'url', category: 'text', icon: 'Link', sortOrder: 5 },

  { id: 'select', category: 'choices', icon: 'ChevronDownSquare', sortOrder: 1 },
  { id: 'radio', category: 'choices', icon: 'CircleDot', sortOrder: 2 },
  { id: 'multi-select', category: 'choices', icon: 'ListChecks', sortOrder: 3 },
  { id: 'checkbox', category: 'choices', icon: 'CheckSquare', sortOrder: 4 },

  { id: 'number', category: 'datesAndNumbers', icon: 'Hash', sortOrder: 1 },
  { id: 'date', category: 'datesAndNumbers', icon: 'Calendar', sortOrder: 2 },
  { id: 'date-time', category: 'datesAndNumbers', icon: 'CalendarClock', sortOrder: 3 },

  { id: 'file-upload', category: 'files', icon: 'Paperclip', sortOrder: 1 },

  { id: 'section', category: 'layout', icon: 'Rows3', sortOrder: 1 },
  { id: 'text', category: 'layout', icon: 'TextQuote', sortOrder: 2 },
  { id: 'callout', category: 'layout', icon: 'Info', sortOrder: 3 },
  { id: 'divider', category: 'layout', icon: 'Minus', sortOrder: 4 },
];

/** The element a palette entry drops onto the canvas. `label` is already localized. */
export function buildPaletteElement(
  type: FieldTypeKey,
  label: string,
  optionLabels?: { optionOne: string; optionTwo: string }
): Omit<BasicFormField, 'key'> & { key?: string } {
  const element: Omit<BasicFormField, 'key'> & { key?: string } = {
    type,
    label,
    helpText: null,
    required: false,
  };

  if (type === 'select' || type === 'radio' || type === 'multi-select') {
    element.options = [
      { label: optionLabels?.optionOne ?? 'Option 1', value: 'option_1' },
      { label: optionLabels?.optionTwo ?? 'Option 2', value: 'option_2' },
    ];
  }
  if (type === 'callout') {
    element.display = { tone: 'info' };
  }
  return element;
}
