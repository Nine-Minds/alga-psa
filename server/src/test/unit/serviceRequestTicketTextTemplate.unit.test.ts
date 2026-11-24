import { describe, expect, it } from 'vitest';
import {
  findUnknownServiceRequestTemplateTokens,
  getServiceRequestTemplateFields,
  normalizeTicketSubject,
  renderServiceRequestTemplate,
} from '../../lib/service-requests/ticketTextTemplate';
import {
  buildTicketDescription,
  buildTicketTitle,
} from '../../lib/service-requests/providers/builtins/ticketOnlyExecutionProvider';
import { listTokens, formatCalendarDate } from '@alga-psa/tickets/lib/titleTokens';

const formSchema = {
  fields: [
    { key: 'employee_name', type: 'short-text', label: 'Employee Name' },
    { key: 'notes', type: 'long-text', label: 'Notes' },
    {
      key: 'hardware',
      type: 'select',
      label: 'Hardware',
      options: [{ value: 'laptop', label: 'Laptop' }, { value: 'desktop', label: 'Desktop' }],
    },
    { key: 'start_date', type: 'date', label: 'Start Date' },
    { key: 'needs_badge', type: 'checkbox', label: 'Needs Badge' },
    { key: 'resume', type: 'file-upload', label: 'Resume' },
  ],
};
const en = { locale: 'en', yes: 'Yes', no: 'No' };
const render = (template: string, payload: Record<string, unknown>, format = en) =>
  renderServiceRequestTemplate(template, { formSchema, payload, format });

describe('token engine additions', () => {
  it('listTokens returns tokens in first-seen order without duplicates', () => {
    expect(listTokens('{{ b }} x {{a}} {{b}}')).toEqual(['b', 'a']);
  });

  it('formatCalendarDate formats floating dates and falls back to en for a bad locale', () => {
    expect(formatCalendarDate('2026-03-02', 'en', { dateStyle: 'long' })).toBe('March 2, 2026');
    expect(formatCalendarDate('2026-03-02', 'not a locale!!', { dateStyle: 'long' })).toBe('March 2, 2026');
    expect(() => formatCalendarDate('2/3/2026', 'en', { dateStyle: 'long' })).toThrow();
  });
});

describe('renderServiceRequestTemplate', () => {
  it('renders each field type', () => {
    expect(render('{{employee_name}}', { employee_name: '  Jane Doe  ' })).toBe('Jane Doe');
    expect(render('{{hardware}}', { hardware: 'laptop' })).toBe('Laptop');
    expect(render('{{hardware}}', { hardware: 'tablet' })).toBe('tablet');
    expect(render('{{start_date}}', { start_date: '2026-03-02' })).toBe('March 2, 2026');
    expect(render('{{start_date}}', { start_date: '2026-03-02' }, { ...en, locale: 'de' })).toBe('2. März 2026');
    expect(render('{{start_date}}', { start_date: 'next week' })).toBe('next week');
    expect(render('{{needs_badge}}', { needs_badge: true })).toBe('Yes');
    expect(render('{{needs_badge}}', { needs_badge: false }, { locale: 'de', yes: 'Ja', no: 'Nein' })).toBe('Nein');
  });

  it('renders the example subject', () => {
    expect(
      render('New Hire for Employee: {{employee_name}}, {{ start_date }}', {
        employee_name: 'Jane Doe',
        start_date: '2026-03-02',
      })
    ).toBe('New Hire for Employee: Jane Doe, March 2, 2026');
  });

  it('renders missing, unknown and file-upload tokens as empty text without throwing', () => {
    expect(render('[{{employee_name}}]', {})).toBe('[]');
    expect(render('[{{nope}}]', { nope: undefined })).toBe('[]');
    expect(render('[{{resume}}]', { resume: 'cv.pdf' })).toBe('[]');
    expect(() => render('{{x', { x: 1 })).not.toThrow();
  });

  it('tolerates a missing form schema and renders raw strings', () => {
    expect(
      renderServiceRequestTemplate('{{a}}-{{b}}', { formSchema: undefined, payload: { a: 1, b: null }, format: en })
    ).toBe('1-');
  });
});

describe('v2 schema in ticket text', () => {
  // Display blocks carry keys but no answer, so they can never stand in for one.
  const v2Schema = {
    fields: [
      { key: 'intro', type: 'text', label: 'Read this first' },
      { key: 'lead_time', type: 'callout', label: 'Five working days' },
      { key: 'rule', type: 'divider', label: '' },
      { key: 'employee', type: 'section', label: 'Employee' },
      { key: 'full_name', type: 'short-text', label: 'Full name' },
      {
        key: 'shift',
        type: 'radio',
        label: 'Shift',
        options: [{ value: 'am', label: 'Morning' }, { value: 'pm', label: 'Afternoon' }],
      },
      {
        key: 'apps',
        type: 'multi-select',
        label: 'Apps',
        options: [
          { value: 'crm', label: 'CRM' },
          { value: 'vpn', label: 'VPN' },
          { value: 'erp', label: 'ERP' },
        ],
      },
      { key: 'seats', type: 'number', label: 'Seats' },
      { key: 'work_email', type: 'email', label: 'Work email' },
      { key: 'desk_phone', type: 'phone', label: 'Desk phone' },
      { key: 'profile', type: 'url', label: 'Profile' },
      { key: 'starts_at', type: 'date-time', label: 'Starts at' },
    ],
  };
  const renderV2 = (template: string, payload: Record<string, unknown>) =>
    renderServiceRequestTemplate(template, { formSchema: v2Schema, payload, format: en });

  it('offers no display block as a placeholder', () => {
    expect(getServiceRequestTemplateFields(v2Schema).map((field) => field.key)).toEqual([
      'full_name',
      'shift',
      'apps',
      'seats',
      'work_email',
      'desk_phone',
      'profile',
      'starts_at',
    ]);
    expect(
      findUnknownServiceRequestTemplateTokens('{{intro}} {{employee}} {{full_name}}', v2Schema)
    ).toEqual(['intro', 'employee']);
  });

  it('renders every input type sensibly in a subject', () => {
    expect(renderV2('{{shift}}', { shift: 'pm' })).toBe('Afternoon');
    expect(renderV2('{{shift}}', { shift: 'night' })).toBe('night');
    expect(renderV2('{{apps}}', { apps: ['crm', 'erp'] })).toBe('CRM, ERP');
    expect(renderV2('{{apps}}', { apps: [] })).toBe('');
    expect(renderV2('{{seats}}', { seats: '3' })).toBe('3');
    expect(renderV2('{{work_email}}', { work_email: 'jane@example.com' })).toBe('jane@example.com');
    expect(renderV2('{{desk_phone}}', { desk_phone: '+46 70 123 45 67' })).toBe('+46 70 123 45 67');
    expect(renderV2('{{profile}}', { profile: 'https://example.com/jane' })).toBe(
      'https://example.com/jane'
    );
    expect(renderV2('{{starts_at}}', { starts_at: '2026-03-02' })).toBe('March 2, 2026');
    // What the date-time picker actually stores is a full instant, not YYYY-MM-DD: it must read
    // as a date and a time, never as a raw ISO timestamp.
    expect(renderV2('{{starts_at}}', { starts_at: '2026-03-02T14:30:00.000Z' })).toBe(
      'March 2, 2026 at 2:30 PM UTC'
    );
    // Not a date at all: shown verbatim rather than dropped.
    expect(renderV2('{{starts_at}}', { starts_at: 'as soon as possible' })).toBe(
      'as soon as possible'
    );
  });

  it('renders choice labels and section groups in the description', () => {
    const blocks = JSON.parse(
      buildTicketDescription(
        {
          formSchema: v2Schema,
          payload: { full_name: 'Jane Doe', shift: 'am', apps: ['vpn', 'crm'], seats: '2' },
          format: en,
        },
        {}
      )
    );
    const read = (block: any) =>
      block.type === 'table'
        ? {
            table: block.content.rows.map((row: any) =>
              row.cells.map((cell: any) => cell[0].text)
            ),
          }
        : { heading: block.content[0].text };

    expect(blocks.map(read)).toEqual([
      { heading: 'Employee' },
      {
        table: [
          ['Full name', 'Jane Doe'],
          ['Shift', 'Morning'],
          ['Apps', 'VPN, CRM'],
          ['Seats', '2'],
        ],
      },
    ]);
  });
});

describe('template fields and unknown tokens', () => {
  it('lists insertable fields in form order without file uploads', () => {
    expect(getServiceRequestTemplateFields(formSchema).map((field) => field.key)).toEqual([
      'employee_name',
      'notes',
      'hardware',
      'start_date',
      'needs_badge',
    ]);
    expect(getServiceRequestTemplateFields(undefined)).toEqual([]);
  });

  it('reports unknown and file-upload tokens but not known ones, with or without spaces', () => {
    expect(
      findUnknownServiceRequestTemplateTokens('{{ employee_name }} {{hardware}} {{missing}} {{resume}}', formSchema)
    ).toEqual(['missing', 'resume']);
    expect(findUnknownServiceRequestTemplateTokens('plain text', formSchema)).toEqual([]);
  });
});

describe('normalizeTicketSubject', () => {
  it('collapses whitespace including newlines', () => {
    expect(normalizeTicketSubject('  a\n\n b\t c  ')).toBe('a b c');
  });

  it('caps at 255 characters with an ellipsis', () => {
    const result = normalizeTicketSubject('x'.repeat(400));
    expect(Array.from(result)).toHaveLength(255);
    expect(result.endsWith('…')).toBe(true);
    expect(normalizeTicketSubject('y'.repeat(255))).toBe('y'.repeat(255));
  });

  it('does not split a surrogate pair at the cut', () => {
    const result = normalizeTicketSubject('😀'.repeat(300));
    expect(Array.from(result)).toHaveLength(255);
    expect(result).toBe('😀'.repeat(254) + '…');
    expect(result).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});

describe('ticket-only subject chain', () => {
  const text = (payload: Record<string, unknown>) => ({ formSchema, payload, format: en });
  const definitionId = 'abcdef12-0000-0000-0000-000000000000';

  it('uses the template, formatted by field type', () => {
    expect(
      buildTicketTitle(text({ employee_name: 'Jane', hardware: 'laptop' }), definitionId, {
        titleTemplate: '{{employee_name}} ({{hardware}})',
        titleFieldKey: 'notes',
      })
    ).toBe('Jane (Laptop)');
  });

  it('falls back to titleFieldKey, then the first string answer, then the id prefix', () => {
    const payload = { employee_name: 'Jane', notes: 'Legacy title' };
    expect(buildTicketTitle(text(payload), definitionId, { titleTemplate: '{{start_date}}', titleFieldKey: 'notes' })).toBe('Legacy title');
    expect(buildTicketTitle(text(payload), definitionId, { titleTemplate: '{{start_date}}' })).toBe('Jane');
    expect(buildTicketTitle(text({ needs_badge: true }), definitionId, { titleTemplate: '{{start_date}}' })).toBe('Service Request abcdef12');
  });

  it('collapses newlines in every branch', () => {
    expect(buildTicketTitle(text({ notes: 'line one\n\nline two' }), definitionId, { titleTemplate: '{{notes}}' })).toBe('line one line two');
    expect(buildTicketTitle(text({ notes: 'first\nsecond' }), definitionId, {})).toBe('first second');
  });

  it('caps a 400 character subject on the template and first-answer branches', () => {
    const long = 'a'.repeat(400);
    for (const config of [{ titleTemplate: '{{notes}}' }, {}]) {
      const title = buildTicketTitle(text({ notes: long }), definitionId, config);
      expect(Array.from(title)).toHaveLength(255);
      expect(title.endsWith('…')).toBe(true);
    }
  });

  it('renders descriptionPrefix placeholders and keeps its line breaks', () => {
    const blocks = JSON.parse(
      buildTicketDescription(text({ employee_name: 'Jane' }), {
        descriptionPrefix: 'Requested for {{employee_name}}\nSecond line',
      })
    );
    expect(blocks[0].content[0].text).toBe('Requested for Jane\nSecond line');
    expect(blocks[1].content.rows[0].cells.map((cell: any) => cell[0].text)).toEqual(['Employee Name', 'Jane']);
  });
});
