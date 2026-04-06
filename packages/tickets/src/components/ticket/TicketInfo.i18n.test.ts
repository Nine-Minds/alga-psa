// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(read(relativePath)) as T;
}

function getLeaf(record: Record<string, unknown>, dottedPath: string): unknown {
  return dottedPath.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    return (value as Record<string, unknown>)[key];
  }, record);
}

describe('ticket info i18n wiring contract', () => {
  it('T030: routes the detail header and core field chrome through features/tickets translations', () => {
    const source = read('./TicketInfo.tsx');

    expect(source).toContain("const { t } = useTranslation('features/tickets');");
    expect(source).toContain("t('info.editTitle', 'Edit title')");
    expect(source).toContain("t('info.unsavedChanges', 'You have unsaved changes. Click \"Save Changes\" to apply them.')");
    expect(source).toContain("t('fields.status', 'Status')");
    expect(source).toContain("t('fields.assignedTo', 'Assigned To')");
    expect(source).toContain("t('info.board', 'Board')");
    expect(source).toContain("t('fields.category', 'Category')");
    expect(source).toContain("t('info.itilCategory', 'ITIL Category')");
    expect(source).toContain("t('itil.impact', 'Impact')");
    expect(source).toContain("t('itil.urgency', 'Urgency')");
    expect(source).toContain("t('fields.priority', 'Priority')");
    expect(source).toContain("t('fields.dueDate', 'Due Date')");
    expect(source).toContain("t('info.slaStatus', 'SLA Status')");
    expect(source).toContain("t('settings.display.columns.tags', 'Tags')");
    expect(source).toContain("t('fields.description', 'Description')");
  });

  it('T031: routes confirmation dialogs and inline edit prompts through translations', () => {
    const source = read('./TicketInfo.tsx');

    expect(source).toContain("t('info.saveTitle', 'Save title')");
    expect(source).toContain("t('actions.cancel', 'Cancel')");
    expect(source).toContain("t('info.editDescription', 'Edit description')");
    expect(source).toContain("t('info.saving', 'Saving...')");
    expect(source).toContain("t('info.saveChanges', 'Save Changes')");
    expect(source).toContain("t('info.discardChangesTitle', 'Discard Changes')");
    expect(source).toContain("t('info.discardChangesMessage', 'You have unsaved changes. Are you sure you want to discard them?')");
    expect(source).toContain("t('info.discard', 'Discard')");
    expect(source).toContain("t('info.keepEditing', 'Keep Editing')");
    expect(source).toContain("t('info.clipboardDraftMessage', 'This description includes pasted images that were already uploaded as ticket documents. Keep them, or delete them permanently?')");
    expect(source).toContain("t('quickAdd.continueEditing', 'Continue Editing')");
  });

  it('T032: keeps the mixed TicketInfo key families backed by xx pseudo-locale strings', () => {
    const source = read('./TicketInfo.tsx');
    const pseudo = readJson<Record<string, unknown>>('../../../../../server/public/locales/xx/features/tickets.json');

    const pseudoKeys = [
      'fields.status',
      'fields.assignedTo',
      'fields.priority',
      'fields.dueDate',
      'fields.description',
      'info.board',
      'itil.impact',
      'itil.urgency',
      'info.saveChanges',
      'info.discardChangesTitle',
      'conversation.clipboardDraftCancelTitle',
      'quickAdd.continueEditing',
    ];

    for (const key of pseudoKeys) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(pseudo, key)).toBe('11111');
    }
  });
});
