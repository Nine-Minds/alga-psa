import { describe, expect, it } from 'vitest';
import {
  getFormInputFields,
  groupFormElementsBySection,
  isDisplayElement,
  normalizeBasicFormSchema,
  resolveStaticDefaultValues,
  validateBasicFormSchema,
  type BasicFormField,
} from '../../../lib/service-requests/basicFormBuilder';

const V1_SCHEMA = {
  fields: [
    { key: 'employee_name', type: 'short-text', label: 'Employee Name', required: true },
    { key: 'start_date', type: 'date', label: 'Start Date', required: true },
    {
      key: 'work_location',
      type: 'select',
      label: 'Work Location',
      required: false,
      options: [
        { label: 'Office', value: 'Office' },
        { label: 'Remote', value: 'Remote' },
      ],
    },
    { key: 'notes', type: 'long-text', label: 'Notes', helpText: 'Anything else' },
    { key: 'agree', type: 'checkbox', label: 'Agree', defaultValue: true },
    { key: 'attachment', type: 'file-upload', label: 'Attachment' },
  ],
};

describe('schema v2 is backward compatible', () => {
  it('normalizes a v1 schema to exactly the fields it already had', () => {
    const normalized = normalizeBasicFormSchema(V1_SCHEMA);

    expect(normalized.settings).toBeUndefined();
    expect(normalized.fields).toEqual([
      { key: 'employee_name', type: 'short-text', label: 'Employee Name', helpText: null, required: true },
      { key: 'start_date', type: 'date', label: 'Start Date', helpText: null, required: true },
      {
        key: 'work_location',
        type: 'select',
        label: 'Work Location',
        helpText: null,
        required: false,
        options: [
          { label: 'Office', value: 'Office' },
          { label: 'Remote', value: 'Remote' },
        ],
      },
      { key: 'notes', type: 'long-text', label: 'Notes', helpText: 'Anything else', required: false },
      { key: 'agree', type: 'checkbox', label: 'Agree', helpText: null, required: false, defaultValue: true },
      { key: 'attachment', type: 'file-upload', label: 'Attachment', helpText: null, required: false },
    ]);
    expect(validateBasicFormSchema(V1_SCHEMA).isValid).toBe(true);
  });

  it('keeps coercing an unknown type to short-text, as published snapshots expect', () => {
    const normalized = normalizeBasicFormSchema({
      fields: [{ key: 'mystery', type: 'quantum-slider', label: 'Mystery' }],
    });
    expect(normalized.fields[0].type).toBe('short-text');
  });
});

describe('display blocks', () => {
  const schema = {
    fields: [
      { key: 'lead_time', type: 'callout', label: 'Heads up', display: { tone: 'warning' }, required: true },
      { key: 'employee', type: 'section', label: 'Employee', display: { collapsible: true } },
      { key: 'full_name', type: 'short-text', label: 'Full name', layout: { width: 'half' } },
      { key: 'start_date', type: 'date', label: 'Start date', layout: { width: 'half' } },
      { key: 'rule', type: 'divider', label: '' },
      { key: 'hardware', type: 'section', label: 'Hardware' },
      { key: 'laptop', type: 'checkbox', label: 'Needs a laptop' },
    ],
  };

  it('never marks a display block required and keeps its display settings', () => {
    const normalized = normalizeBasicFormSchema(schema);
    const callout = normalized.fields[0];

    expect(callout.required).toBe(false);
    expect(callout.display).toEqual({ tone: 'warning' });
    expect(normalized.fields[1].display).toEqual({ collapsible: true });
    expect(isDisplayElement(callout)).toBe(true);
  });

  it('keeps only answer-carrying elements in the input list', () => {
    const normalized = normalizeBasicFormSchema(schema);
    expect(getFormInputFields(normalized.fields).map((field) => field.key)).toEqual([
      'full_name',
      'start_date',
      'laptop',
    ]);
  });

  it('groups elements under the section block that opens them', () => {
    const normalized = normalizeBasicFormSchema(schema);
    const groups = groupFormElementsBySection(normalized.fields);

    expect(groups.map((group) => group.section?.key ?? null)).toEqual([
      null,
      'employee',
      'hardware',
    ]);
    expect(groups[0].elements.map((element) => element.key)).toEqual(['lead_time']);
    expect(groups[1].elements.map((element) => element.key)).toEqual([
      'full_name',
      'start_date',
      'rule',
    ]);
    expect(groups[2].elements.map((element) => element.key)).toEqual(['laptop']);
  });

  it('does not ask a divider for a label and never seeds a value from a display block', () => {
    expect(validateBasicFormSchema(schema).errors).toEqual([]);
    expect(resolveStaticDefaultValues(schema)).toEqual({});
  });
});

describe('new inputs, placement and validation rules', () => {
  it('keeps the rules a type supports and drops the ones it does not', () => {
    const normalized = normalizeBasicFormSchema({
      fields: [
        {
          key: 'quantity',
          type: 'number',
          label: 'Quantity',
          validation: { min: 1, max: 50, minLength: 3, message: ' Ask for 1 to 50. ' },
        },
        {
          key: 'summary',
          type: 'long-text',
          label: 'Summary',
          validation: { minLength: '20', max: 9 },
        },
        { key: 'when', type: 'date-time', label: 'When', validation: { minDate: '2026-01-01' } },
        { key: 'tags', type: 'multi-select', label: 'Tags', options: [{ label: 'A', value: 'a' }], validation: { maxSelected: 2 } },
      ],
    });

    expect(normalized.fields[0].validation).toEqual({ min: 1, max: 50, message: 'Ask for 1 to 50.' });
    expect(normalized.fields[1].validation).toEqual({ minLength: 20 });
    expect(normalized.fields[2].validation).toEqual({ minDate: '2026-01-01' });
    expect(normalized.fields[3].validation).toEqual({ maxSelected: 2 });
  });

  it('drops a lone custom message, which constrains nothing', () => {
    const normalized = normalizeBasicFormSchema({
      fields: [{ key: 'name', type: 'short-text', label: 'Name', validation: { message: 'Nope' } }],
    });
    expect(normalized.fields[0].validation).toBeUndefined();
  });

  it('reports an unparseable pattern', () => {
    const result = validateBasicFormSchema({
      fields: [{ key: 'code', type: 'short-text', label: 'Code', validation: { pattern: '([a-z' } }],
    });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Field "code" has an invalid pattern');
  });

  it('keeps half-width only on inputs and only a placeholder the type supports', () => {
    const normalized = normalizeBasicFormSchema({
      fields: [
        { key: 'sec', type: 'section', label: 'Section', layout: { width: 'half' } },
        { key: 'name', type: 'short-text', label: 'Name', layout: { width: 'half' }, placeholder: ' Jane ' },
        { key: 'agree', type: 'checkbox', label: 'Agree', placeholder: 'nope' },
      ],
    });

    expect(normalized.fields[0].layout).toBeUndefined();
    expect(normalized.fields[1].layout).toEqual({ width: 'half' });
    expect(normalized.fields[1].placeholder).toBe('Jane');
    expect(normalized.fields[2].placeholder).toBeUndefined();
  });

  it('requires options on every choice type', () => {
    const result = validateBasicFormSchema({
      fields: [
        { key: 'pick', type: 'radio', label: 'Pick' },
        { key: 'many', type: 'multi-select', label: 'Many' },
      ],
    });
    expect(result.errors).toEqual([
      'Field "pick" must include at least one option',
      'Field "many" must include at least one option',
    ]);
  });

  it('carries phase-2 extension points through untouched', () => {
    const normalized = normalizeBasicFormSchema({
      fields: [
        {
          key: 'contact',
          type: 'select',
          label: 'Contact',
          options: [{ label: 'A', value: 'a' }],
          optionSource: { kind: 'contacts' },
          binding: { kind: 'custom-field', field: 'ticket.requested_for' },
        },
      ],
    });
    expect(normalized.fields[0].optionSource).toEqual({ kind: 'contacts' });
    expect(normalized.fields[0].binding).toEqual({ kind: 'custom-field', field: 'ticket.requested_for' });
  });
});

describe('form-level settings', () => {
  it('keeps the settings it recognizes and drops the rest', () => {
    const normalized = normalizeBasicFormSchema({
      fields: [] as BasicFormField[],
      settings: {
        layout: { width: 'full', columns: 7 },
        submitLabel: '  Send it  ',
        successMessage: '',
        unknown: 'x',
      },
    });

    expect(normalized.settings).toEqual({ layout: { width: 'full' }, submitLabel: 'Send it' });
  });

  it('leaves settings off a schema that has none', () => {
    expect(normalizeBasicFormSchema({ fields: [], settings: { layout: { width: 'wide' } } }).settings).toBeUndefined();
  });
});

describe('conditions stored on the element', () => {
  const conditional = {
    fields: [
      { key: 'needs_laptop', type: 'checkbox', label: 'Needs a laptop?' },
      {
        key: 'hardware',
        type: 'section',
        label: 'Hardware',
        visibleWhen: [{ source: 'needs_laptop', operator: 'is-true' }],
      },
      {
        key: 'laptop_model',
        type: 'short-text',
        label: 'Laptop model',
        visibleWhen: [{ source: 'needs_laptop', operator: 'nonsense' }],
      },
    ],
  };

  it('keeps a display block condition and drops a malformed one', () => {
    const normalized = normalizeBasicFormSchema(conditional);

    expect(normalized.fields[1].visibleWhen).toEqual([
      { source: 'needs_laptop', operator: 'is-true' },
    ]);
    expect(normalized.fields[2].visibleWhen).toBeUndefined();
    expect(validateBasicFormSchema(conditional).isValid).toBe(true);
  });

  it('refuses a condition that reads an answer below it', () => {
    const result = validateBasicFormSchema({
      fields: [
        {
          key: 'hardware',
          type: 'section',
          label: 'Hardware',
          visibleWhen: [{ source: 'needs_laptop', operator: 'is-true' }],
        },
        { key: 'needs_laptop', type: 'checkbox', label: 'Needs a laptop?' },
      ],
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual([
      'Field "hardware" has a condition on "needs_laptop", which is not an answer above it',
    ]);
  });

  it('refuses an equals condition with no value, and allows a context source', () => {
    const result = validateBasicFormSchema({
      fields: [
        {
          key: 'internal_note',
          type: 'text',
          label: 'Internal note',
          visibleWhen: [
            { source: 'context.clientId', operator: 'equals' },
            { source: 'context.contactId', operator: 'has-value' },
          ],
        },
      ],
    });

    expect(result.errors).toEqual([
      'Field "internal_note" has a condition on "context.clientId" with no value',
    ]);
  });
});
