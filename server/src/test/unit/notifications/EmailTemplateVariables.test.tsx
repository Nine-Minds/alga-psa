// @vitest-environment jsdom
import React from 'react';
import Handlebars from 'handlebars';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailTemplates } from '../../../../../packages/notifications/src/components/settings/EmailTemplates';
import { getTemplateVariableToken } from '../../../../../packages/notifications/src/components/settings/TemplateVariableReference';
import { replaceTemplateVariables } from '../../../../../packages/notifications/src/components/settings/EmailTemplatePreview';
import { getSampleDataForPreview } from '../../../../../packages/notifications/src/lib/templateSampleData';
import { getNestedTemplateExampleData, templateVariableRegistry } from '../../../../../packages/notifications/src/lib/templateVariables';

const mocks = vi.hoisted(() => ({
  session: { user: { tenant: 'test-tenant' } },
  getTemplates: vi.fn(),
  getBranding: vi.fn(),
  getLocale: vi.fn(),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: mocks.session }),
}));

vi.mock('../../../../../packages/notifications/src/actions', () => ({
  getTemplatesAction: mocks.getTemplates,
  getEmailBrandingStatusAction: mocks.getBranding,
  updateTenantTemplateAction: vi.fn(),
  cloneSystemTemplateAction: vi.fn(),
  deactivateTenantTemplateAction: vi.fn(),
  isNotificationActionError: () => false,
  sendTestEmailAction: vi.fn(),
}));

vi.mock('@alga-psa/tenancy/actions/tenant-actions/tenantLocaleActions', () => ({
  getTenantLocaleSettingsAction: mocks.getLocale,
}));

vi.mock('@alga-psa/user-composition/hooks', () => ({
  useUserPreference: () => ({ value: 10, setValue: vi.fn() }),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | { defaultValue?: string }) =>
      typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? key,
  }),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children, footer }: {
    isOpen: boolean;
    children: React.ReactNode;
    footer?: React.ReactNode;
  }) => isOpen ? <div role="dialog">{children}{footer}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

type TableRow = Record<string, unknown> & { id: string };
type TableColumn = {
  dataIndex: string;
  render?: (value: unknown, row: TableRow) => React.ReactNode;
};

vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ data, columns, onRowClick }: {
    data: TableRow[];
    columns: TableColumn[];
    onRowClick: (row: TableRow) => void;
  }) => (
    <table><tbody>
      {data.map((row) => (
        <tr key={row.id} onClick={() => onRowClick(row)}>
          {columns.map((column) => (
            <td key={column.dataIndex}>
              {column.render ? column.render(row[column.dataIndex], row) : String(row[column.dataIndex] ?? '')}
            </td>
          ))}
        </tr>
      ))}
    </tbody></table>
  ),
}));

const systemTemplate = {
  id: 1,
  name: 'ticket-closed',
  category: 'Tickets',
  subject: 'Subject before REPLACE after',
  html_content: '<p>before REPLACE after</p>',
  text_content: 'before REPLACE after',
  language_code: 'en',
  created_at: '',
  updated_at: '',
};
const tenantTemplate = {
  ...systemTemplate,
  id: 2,
  tenant: 'test-tenant',
  system_template_id: systemTemplate.id,
};

function buttonById(id: string): HTMLButtonElement {
  const button = document.getElementById(id);
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing button: ${id}`);
  }
  return button;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getTemplates.mockResolvedValue({
    systemTemplates: [systemTemplate],
    tenantTemplates: [tenantTemplate],
  });
  mocks.getBranding.mockResolvedValue(null);
  mocks.getLocale.mockResolvedValue(null);
});

afterEach(cleanup);

describe('ticket detail variable insertion', () => {
  it.each([
    {
      path: 'ticket.assets',
      field: 'HTML Content',
      replace: false,
      example: 'Office Printer',
      token: '{{#each ticket.assets}}{{name}}{{/each}}',
    },
    {
      path: 'ticket.materials',
      field: 'Text Content',
      replace: true,
      example: 'Toner cartridge: 2 \u00d7 $45.00 = $90.00',
      token: '{{#each ticket.materials}}{{name}}: {{quantity}} \u00d7 {{rate}} = {{amount}}{{/each}}',
    },
    {
      path: 'ticket.timeEntries',
      field: 'Subject',
      replace: false,
      example: '06/10/2025 | Jane Smith | 1 hr 30 min | 1 hr',
      token: '{{#each ticket.timeEntries}}{{date}} | {{technician}} | {{worked}} | {{billable}}{{/each}}',
    },
  ])('inserts $path at the cursor and previews its sample row', async ({ path, field, replace, example, token }) => {
    const user = userEvent.setup();
    render(<EmailTemplates />);

    await user.click(await screen.findByText('Tickets'));
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('tab', { name: 'Variables' }));

    const id = `template-variable-ticket-closed-${path.replace(/[^a-zA-Z0-9]+/g, '-')}`;
    const variable = templateVariableRegistry['ticket-closed'].variables.find((item) => item.path === path);
    expect(variable).toBeDefined();
    if (!variable) throw new Error(`Missing variable: ${path}`);

    // The panel describes the array's row shape; the inserted loop renders `example`.
    const insertButton = buttonById(`${id}-insert`);
    expect(variable.example).toMatch(/^\[\{ .+ \}\]$/);
    expect(insertButton.textContent).toContain(variable.example);
    expect(insertButton.textContent).not.toContain('{{');
    expect(getTemplateVariableToken(variable)).toBe(token);
    expect(getTemplateVariableToken({ ...variable, example: 'Different sample' })).toBe(token);
    expect(replaceTemplateVariables(token, getSampleDataForPreview('ticket-closed', token))).toBe(example);
    expect(Handlebars.compile(token, { strict: true })(getNestedTemplateExampleData('ticket-closed'))).toBe(example);

    const editor = screen.getByLabelText(field);
    if (!(editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement)) {
      throw new Error(`Not an editable field: ${field}`);
    }
    const initial = editor.value;
    const start = initial.indexOf('REPLACE');
    expect(start).toBeGreaterThanOrEqual(0);
    const end = start + (replace ? 'REPLACE'.length : 0);
    await user.click(editor);
    editor.setSelectionRange(start, end);
    await user.click(insertButton);

    expect(editor.value).toBe(`${initial.slice(0, start)}${token}${initial.slice(end)}`);
    await waitFor(() => {
      expect(document.activeElement).toBe(editor);
      expect(editor.selectionStart).toBe(start + token.length);
      expect(editor.selectionEnd).toBe(start + token.length);
    });

    await user.click(buttonById(`${id}-copy`));
    expect(await navigator.clipboard.readText()).toBe(token);
  });

  it('keeps ordinary, loop-local and legacy array tokens unchanged', () => {
    const ticketVariables = templateVariableRegistry['ticket-closed'].variables;
    const creditVariables = templateVariableRegistry['credit-expiring'].variables;
    const tokenForPath = (path: string) => {
      const variable = [...ticketVariables, ...creditVariables].find((item) => item.path === path);
      if (!variable) throw new Error(`Missing variable: ${path}`);
      return getTemplateVariableToken(variable);
    };

    expect(tokenForPath('ticket.title')).toBe('{{ticket.title}}');
    expect(tokenForPath('ticket.timeEntries[].date')).toBe('{{this.date}}');
    expect(tokenForPath('ticket.description')).toBe('{{{ticket.description}}}');
    expect(tokenForPath('credits.items')).toBe('{{credits.items}}');
  });
});
