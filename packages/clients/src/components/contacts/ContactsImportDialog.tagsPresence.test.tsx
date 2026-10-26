/**
 * @vitest-environment jsdom
 *
 * Tags presence through the contact CSV import dialog. Whether a row writes
 * tags is decided by the column mapping, not by the cell: a mapped Tags column
 * with a blank cell must reach `importContactsFromCSV` as `tags: ''` (clear the
 * tags, and admit lifecycle so an ended co-managed workspace refuses the row),
 * while an unmapped Tags column must send no `tags` key at all.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  importContactsFromCSV: vi.fn(),
  checkExistingEmails: vi.fn(),
}));

vi.mock('@alga-psa/clients/actions', () => ({
  importContactsFromCSV: hoisted.importContactsFromCSV,
  checkExistingEmails: hoisted.checkExistingEmails,
  generateContactCSVTemplate: vi.fn(async () => ''),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;
  return { useTranslation: () => ({ t }) };
});

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children, footer }: any) => (isOpen ? <div>{children}{footer}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button type="button" {...props}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: ({ containerClassName: _c, ...props }: any) => <input data-testid="csv-file" {...props} />,
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ options, value, onValueChange }: any) => (
    <select value={value} onChange={(event) => onValueChange(event.target.value)}>
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));
vi.mock('@alga-psa/ui/components/DataTable', () => ({ DataTable: () => null }));
vi.mock('@alga-psa/ui/components/Switch', () => ({ Switch: () => null }));
vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({ ConfirmationDialog: () => null }));
vi.mock('@alga-psa/ui/components/Tooltip', () => ({ Tooltip: ({ children }: any) => <>{children}</> }));
vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: any) => <div>{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
}));

import ContactsImportDialog from './ContactsImportDialog';

async function importCsv(csv: string, options: { unmapTags?: boolean } = {}) {
  const onImportComplete = vi.fn();
  render(
    <ContactsImportDialog isOpen onClose={vi.fn()} onImportComplete={onImportComplete} clients={[]} />,
  );

  await act(async () => {
    fireEvent.change(screen.getByTestId('csv-file'), {
      target: { files: [{ text: async () => csv }] },
    });
  });
  await waitFor(() => expect(document.getElementById('preview-import')).toBeInTheDocument());

  if (options.unmapTags) {
    const tagsLabel = screen.getAllByText('Tags').find((node) => node.tagName === 'SPAN')!;
    const tagsSelect = tagsLabel.parentElement!.querySelector('select')!;
    expect(tagsSelect).toHaveValue('Tags');
    await act(async () => {
      fireEvent.change(tagsSelect, { target: { value: 'unassigned' } });
    });
    expect(tagsSelect).toHaveValue('unassigned');
  }

  await act(async () => {
    fireEvent.click(document.getElementById('preview-import')!);
  });
  await waitFor(() => expect(document.getElementById('import-contacts')).toBeInTheDocument());
  await act(async () => {
    fireEvent.click(document.getElementById('import-contacts')!);
  });
  await waitFor(() => expect(hoisted.importContactsFromCSV).toHaveBeenCalledTimes(1));

  const [rows, updateExisting] = hoisted.importContactsFromCSV.mock.calls[0];
  return { rows: rows as Array<Record<string, unknown>>, updateExisting, onImportComplete };
}

describe('ContactsImportDialog — Tags presence from the column mapping', () => {
  beforeEach(() => {
    hoisted.importContactsFromCSV.mockReset();
    hoisted.checkExistingEmails.mockReset();
    hoisted.checkExistingEmails.mockResolvedValue([]);
    hoisted.importContactsFromCSV.mockImplementation(async (rows: any[]) =>
      rows.map((row) => ({ success: true, message: 'ok', originalData: row })),
    );
  });

  it('sends tags: "" for a mapped Tags column whose cell is blank', async () => {
    const { rows } = await importCsv('Name,Email,Tags\nAda Lovelace,ada@example.com,\n');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveProperty('tags', '');
    expect(rows[0].full_name).toBe('Ada Lovelace');
  });

  it('sends tags: "" when a mapped Tags cell is missing from a short row', async () => {
    const { rows } = await importCsv('Name,Email,Tags\nAda Lovelace,ada@example.com\n');

    expect(rows[0]).toHaveProperty('tags', '');
  });

  it('sends no tags key when the CSV has no Tags column', async () => {
    const { rows } = await importCsv('Name,Email\nAda Lovelace,ada@example.com\n');

    expect(Object.prototype.hasOwnProperty.call(rows[0], 'tags')).toBe(false);
  });

  it('sends no tags key when a Tags column exists but is unmapped', async () => {
    const { rows } = await importCsv('Name,Email,Tags\nAda Lovelace,ada@example.com,vip\n', {
      unmapTags: true,
    });

    expect(Object.prototype.hasOwnProperty.call(rows[0], 'tags')).toBe(false);
  });

  it('passes a mapped non-empty Tags cell through unchanged', async () => {
    const { rows } = await importCsv('Name,Email,Tags\nAda Lovelace,ada@example.com,"vip, board"\n');

    expect(rows[0]).toHaveProperty('tags', 'vip, board');
  });
});
