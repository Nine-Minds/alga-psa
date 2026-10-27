/**
 * @vitest-environment jsdom
 *
 * Tags presence through the contact CSV import dialog. A row carries `tags`
 * only when the Tags column is mapped AND the trimmed cell is non-empty. A
 * blank cell is "no opinion" and must reach `importContactsFromCSV` with no
 * `tags` key (existing tags are kept); an unmapped column never produces it.
 * The failed-records download must preserve that: it writes a Tags column only
 * when the import carried one, so re-importing it cannot turn an unmapped Tags
 * column into explicit blanks.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  importContactsFromCSV: vi.fn(),
  checkExistingEmails: vi.fn(),
  unparseCSV: vi.fn(),
}));

// Real parser; unparseCSV is wrapped so the failed-records file can be read back.
vi.mock('@alga-psa/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/core')>();
  hoisted.unparseCSV.mockImplementation(actual.unparseCSV);
  return { ...actual, unparseCSV: hoisted.unparseCSV };
});

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

const CLIENTS = [{ client_id: 'client-acme', client_name: 'Acme Corp' }];

async function importCsv(csv: string, options: { unmapTags?: boolean } = {}) {
  const onImportComplete = vi.fn();
  render(
    <ContactsImportDialog isOpen onClose={vi.fn()} onImportComplete={onImportComplete} clients={CLIENTS} />,
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

  it('sends no tags key for a mapped Tags column whose cell is blank', async () => {
    const { rows } = await importCsv('Name,Email,Tags\nAda Lovelace,ada@example.com,\n');

    expect(rows).toHaveLength(1);
    expect(Object.prototype.hasOwnProperty.call(rows[0], 'tags')).toBe(false);
    expect(rows[0].full_name).toBe('Ada Lovelace');
  });

  it('sends no tags key when a mapped Tags cell is whitespace only', async () => {
    const whitespace = await importCsv('Name,Email,Tags\nAda Lovelace,ada@example.com,"   "\n');
    expect(Object.prototype.hasOwnProperty.call(whitespace.rows[0], 'tags')).toBe(false);
  });

  it('sends no tags key when a mapped Tags cell is missing from a short row', async () => {
    const { rows } = await importCsv('Name,Email,Tags\nAda Lovelace,ada@example.com\n');

    expect(Object.prototype.hasOwnProperty.call(rows[0], 'tags')).toBe(false);
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

  describe('failed-records download', () => {
    beforeEach(() => {
      hoisted.unparseCSV.mockClear();
      hoisted.importContactsFromCSV.mockImplementation(async (rows: any[]) =>
        rows.map((row) => ({ success: false, message: 'boom', originalData: row })),
      );
      Object.assign(window.URL, {
        createObjectURL: vi.fn(() => 'blob:failed'),
        revokeObjectURL: vi.fn(),
      });
      // jsdom cannot navigate to the blob URL the download anchor points at.
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    });

    async function downloadFailedRecords(csv: string, options: { unmapTags?: boolean } = {}) {
      await importCsv(csv, options);
      await waitFor(() => expect(document.getElementById('download-failed-records')).toBeInTheDocument());
      await act(async () => {
        fireEvent.click(document.getElementById('download-failed-records')!);
      });
      expect(hoisted.unparseCSV).toHaveBeenCalledTimes(1);
      const [rows, fields] = hoisted.unparseCSV.mock.calls[0];
      return { rows: rows as Array<Record<string, string>>, fields: fields as string[] };
    }

    it('writes no Tags column when no failed row carried tags', async () => {
      const { fields } = await downloadFailedRecords(
        'Name,Email,Tags\nAda Lovelace,ada@example.com,\n',
      );
      expect(fields).not.toContain('tags');
    });

    it('writes no Tags column when the Tags column was unmapped', async () => {
      const { fields } = await downloadFailedRecords(
        'Name,Email,Tags\nAda Lovelace,ada@example.com,vip\n',
        { unmapTags: true },
      );
      expect(fields).not.toContain('tags');
    });

    it('writes the Tags column, blank for rows without tags, when a failed row carried tags', async () => {
      const { fields, rows } = await downloadFailedRecords(
        'Name,Email,Tags\nAda Lovelace,ada@example.com,"vip, board"\nGrace Hopper,grace@example.com,\n',
      );
      expect(fields).toContain('tags');
      expect(rows.map((row) => row.tags)).toEqual(['vip, board', '']);
    });

    it('keeps the client name a row was imported against', async () => {
      const { rows } = await downloadFailedRecords(
        'Name,Email,Client\nAda Lovelace,ada@example.com,Acme Corp\nGrace Hopper,grace@example.com,\n',
      );
      expect(rows.map((row) => row.client)).toEqual(['Acme Corp', '']);
    });
  });
});
