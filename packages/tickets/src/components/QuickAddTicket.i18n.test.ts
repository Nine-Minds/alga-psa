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

describe('quick add ticket i18n wiring contract', () => {
  it('T020: wires the dialog shell, field labels, and primary placeholders through features/tickets translations', () => {
    const source = read('./QuickAddTicket.tsx');

    expect(source).toContain("const { t } = useTranslation('features/tickets');");
    expect(source).toContain("t('quickAdd.dialogLabel', 'Quick Add Ticket Dialog')");
    expect(source).toContain("t('quickAdd.dialogTitle', 'Quick Add Ticket')");
    expect(source).toContain("t('quickAdd.formLabel', 'Quick Add Ticket Form')");
    expect(source).toContain("t('quickAdd.titlePlaceholder', 'Ticket Title *')");
    expect(source).toContain("t('quickAdd.descriptionLabel', 'Description')");
    expect(source).toContain("t('quickAdd.descriptionPlaceholder', 'Description')");
    expect(source).toContain("t('quickAdd.clientPlaceholder', 'Select Client *')");
    expect(source).toContain("t('quickAdd.selectContact', 'Select contact')");
    expect(source).toContain("t('quickAdd.selectLocation', 'Select location')");
    expect(source).toContain("t('quickAdd.boardPlaceholder', 'Select Board *')");
    expect(source).toContain("t('quickAdd.assignedTo', 'Assigned To')");
    expect(source).toContain("t('quickAdd.additionalAgents', 'Additional Agents')");
    expect(source).toContain("t('quickAdd.selectCategory', 'Select category')");
    expect(source).toContain("t('quickAdd.statusPlaceholder', 'Select Status *')");
    expect(source).toContain("t('quickAdd.selectPriority', 'Select Priority *')");
    expect(source).toContain("t('quickAdd.dueDate', 'Due Date')");
    expect(source).toContain("t('quickAdd.selectDate', 'Select date')");
    expect(source).toContain("t('quickAdd.timePlaceholder', 'Time')");
  });

  it('T021: routes quick-add validation and required-fields messaging through translations', () => {
    const source = read('./QuickAddTicket.tsx');

    expect(source).toContain("validationErrors.push(t('create.errors.titleRequired', 'Title is required'))");
    expect(source).toContain("validationErrors.push(t('validation.quickAdd.boardRequired', 'Please select a board'))");
    expect(source).toContain("validationErrors.push(t('validation.quickAdd.statusRequired', 'Please select a status'))");
    expect(source).toContain("validationErrors.push(t('validation.quickAdd.priorityRequired', 'Please select a priority'))");
    expect(source).toContain("validationErrors.push(t('validation.quickAdd.impactRequired', 'Please select an impact'))");
    expect(source).toContain("validationErrors.push(t('validation.quickAdd.urgencyRequired', 'Please select an urgency'))");
    expect(source).toContain("validationErrors.push(t('validation.quickAdd.clientRequired', 'Please select a client'))");
    expect(source).toContain("t('quickAdd.requiredFieldsHeading', 'Please fill in the required fields:')");
  });

  it('T022: uses count interpolation for quick-add tag creation partial-failure toasts', () => {
    const source = read('./QuickAddTicket.tsx');

    expect(source).toContain("toast.error(t('quickAdd.tagCreatePartialFailure', {");
    expect(source).toContain('count: failedCount');
    expect(source).toContain("defaultValue: failedCount === 1 ? '{{count}} tag could not be created' : '{{count}} tags could not be created'");
    expect(source).toContain('count: pendingTags.length');
    expect(source).toContain("defaultValue: pendingTags.length === 1 ? '{{count}} tag could not be created' : '{{count}} tags could not be created'");
  });

  it('T023: keeps the quick-add dialog backed by xx pseudo-locale strings', () => {
    const source = read('./QuickAddTicket.tsx');
    const pseudo = readJson<Record<string, unknown>>('../../../../server/public/locales/xx/features/tickets.json');

    const pseudoKeys = [
      'quickAdd.dialogTitle',
      'quickAdd.titlePlaceholder',
      'quickAdd.clientPlaceholder',
      'quickAdd.boardPlaceholder',
      'quickAdd.statusPlaceholder',
      'quickAdd.selectPriority',
      'quickAdd.dueDate',
      'quickAdd.createAndView',
      'quickAdd.continueEditing',
    ];

    for (const key of pseudoKeys) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(pseudo, key)).toBe('11111');
    }

    expect(getLeaf(pseudo, 'quickAdd.tagCreatePartialFailure_one')).toBe('11111 {{count}} 11111');
    expect(getLeaf(pseudo, 'quickAdd.tagCreatePartialFailure_other')).toBe('11111 {{count}} 11111');
  });
});
