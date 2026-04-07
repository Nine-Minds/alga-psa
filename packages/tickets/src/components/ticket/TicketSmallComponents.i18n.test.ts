// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('small ticket component i18n wiring contract', () => {
  it('T091: routes ticket email notification labels through features/tickets translations', () => {
    const source = read('./TicketEmailNotifications.tsx');

    expect(source).toContain("const { t, i18n } = useTranslation('features/tickets');");
    expect(source).toContain("t('emailNotifications.title', 'Email Notifications')");
    expect(source).toContain("t('emailNotifications.time', 'Time')");
    expect(source).toContain("t('emailNotifications.recipient', 'Recipient')");
    expect(source).toContain("t('emailNotifications.subject', 'Subject')");
    expect(source).toContain("t('emailNotifications.status', 'Status')");
    expect(source).toContain("t('emailNotifications.error', 'Error')");
    expect(source).toContain("t('emailNotifications.unknownError', 'Unknown error')");
    expect(source).toContain("t('emailNotifications.loading', 'Loading…')");
    expect(source).toContain("t('emailNotifications.empty', 'No email notifications found.')");
    expect(source).toContain("t('emailNotifications.loadMore', 'Load more')");
  });

  it('T092: routes response-state select options and fallback labels through translations', () => {
    const source = read('../ResponseStateSelect.tsx');

    expect(source).toContain("const { t } = useTranslation('features/tickets');");
    expect(source).toContain("t('responseState.awaitingClient', 'Awaiting Client')");
    expect(source).toContain("t('responseState.awaitingInternal', 'Awaiting Internal')");
    expect(source).toContain("t('responseState.clear', 'Clear')");
    expect(source).toContain("t('responseState.setResponseState', 'Set Response State')");
    expect(source).toContain("t('responseState.label', 'Response State')");
    expect(source).toContain("t('responseState.notSet', 'Not set')");
  });

  it('T093: routes quick-add category dialog and validation through translations', () => {
    const source = read('../QuickAddCategory.tsx');

    expect(source).toContain("const { t } = useTranslation('features/tickets');");
    expect(source).toContain("t('settings.categories.addCategory', 'Add Category')");
    expect(source).toContain("t('settings.categories.categoryName', 'Category Name *')");
    expect(source).toContain("t('settings.categories.enterCategoryName', 'Enter category name')");
    expect(source).toContain("t('settings.categories.selectBoard', 'Select a board')");
    expect(source).toContain("t('settings.categories.selectParentCategory', 'Select parent category')");
    expect(source).toContain("t('validation.category.nameRequired', 'Category name is required')");
    expect(source).toContain("t('validation.category.boardRequiredForTopLevel', 'Board is required for top-level categories')");
    expect(source).toContain("t('settings.categories.createSuccess', 'Category created successfully')");
    expect(source).toContain("t('errors.createCategoryFailed', 'Failed to create category')");
  });

  it('T094: routes ticket details container toast/error copy through translations', () => {
    const source = read('./TicketDetailsContainer.tsx');

    expect(source).toContain("const { t } = useTranslation('features/tickets');");
    expect(source).toContain("t('errors.authRequiredUpdate', 'You must be logged in to update tickets')");
    expect(source).toContain("t('messages.ticketUpdated', 'Ticket updated successfully')");
    expect(source).toContain("t('errors.updateField', 'Failed to update {{field}}', { field })");
    expect(source).toContain("t('info.changesSaved', 'Changes saved successfully!')");
    expect(source).toContain("t('errors.saveChanges', 'Failed to save changes')");
    expect(source).toContain("t('errors.authRequiredComment', 'You must be logged in to add comments')");
    expect(source).toContain("t('messages.commentAdded', 'Comment added successfully')");
    expect(source).toContain("t('errors.addComment', 'Failed to add comment')");
  });

  it('T095: routes category picker placeholder, badges, and summary labels through translations', () => {
    const source = read('../CategoryPicker.tsx');

    expect(source).toContain("const { t } = useTranslation('features/tickets');");
    expect(source).toContain("t('categoryPicker.title', 'Category Picker')");
    expect(source).toContain("t('categoryPicker.placeholder', 'Select categories...')");
    expect(source).toContain("t('categoryPicker.noCategory', 'No Category')");
    expect(source).toContain("t('categoryPicker.itilBadge', 'ITIL')");
    expect(source).toContain("t('categoryPicker.selectedCount', {");
    expect(source).toContain("t('categoryPicker.excludingNoCategory', 'excluding No Category')");
    expect(source).toContain("t('categoryPicker.excludingPrefix', {");
    expect(source).toContain("t('categoryPicker.excludingCount', {");
    expect(source).toContain("t('categoryPicker.addNew', 'Add new category')");
  });

  it('T096: routes ticket navigation aria labels through translations', () => {
    const source = read('./TicketNavigation.tsx');

    expect(source).toContain("const { t } = useTranslation('features/tickets');");
    expect(source).toContain("t('navigation.previousTicket', 'Previous ticket')");
    expect(source).toContain("t('navigation.nextTicket', 'Next ticket')");
  });
});
