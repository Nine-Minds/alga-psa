/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('categories settings quick-add refactor contract', () => {
  it('T050: routes the board scope selector and category tree labels through translations', () => {
    const source = read('../CategoriesSettings.tsx');

    expect(source).toContain("const { t } = useTranslation('features/tickets');");
    expect(source).toContain("t('settings.categories.title', 'Categories')");
    expect(source).toContain("t('settings.categories.allBoards', 'All Boards')");
    expect(source).toContain("t('settings.categories.name', 'Name')");
    expect(source).toContain("t('fields.board', 'Board')");
    expect(source).toContain("t('settings.categories.orderColumn', 'Order')");
    expect(source).toContain("t('settings.display.columns.actions', 'Actions')");
  });

  it('T051: routes add/edit/delete dialog validation and toast copy through translations', () => {
    const source = read('../CategoriesSettings.tsx');

    expect(source).toContain("t('settings.categories.fetchFailed', 'Failed to fetch categories')");
    expect(source).toContain("t('settings.categories.validateDeleteFailed', 'Failed to validate category deletion.')");
    expect(source).toContain("t('settings.categories.nameRequired', 'Category name is required')");
    expect(source).toContain("t('settings.categories.editTitle', 'Edit Category')");
    expect(source).toContain("entityName={deleteDialog.categoryName || t('fields.category', 'Category')}");
    expect(source).toContain("t('settings.categories.saveSuccess', 'Category updated successfully')");
    expect(source).toContain("t('settings.categories.deleteSuccess', 'Category deleted successfully')");
    expect(source).toContain("t('settings.categories.deleteFailed', 'Failed to delete category')");
  });

  it('T035: CategoriesSettings uses QuickAddCategory for the add dialog', () => {
    const source = read('../CategoriesSettings.tsx');

    expect(source).toContain("import QuickAddCategory from '../QuickAddCategory';");
    expect(source).toContain('<QuickAddCategory');
    expect(source).toContain('isOpen={showAddEditDialog && !editingCategory}');
  });

  it('T036: CategoriesSettings keeps the create-category flow wired through QuickAddCategory and refreshes data after create', () => {
    const source = read('../CategoriesSettings.tsx');

    expect(source).toContain('onCategoryCreated={async () => {');
    expect(source).toContain('await fetchCategories();');
    expect(source).toContain('categories={categories}');
    expect(source).toContain('boards={boards}');
  });

  it('T037: CategoriesSettings keeps the edit-category flow inline and refreshes after update', () => {
    const source = read('../CategoriesSettings.tsx');

    expect(source).toContain('{editingCategory && (');
    expect(source).toContain("title={t('settings.categories.editTitle', 'Edit Category')}");
    expect(source).toContain('await updateCategory(editingCategory.category_id, updateData);');
    expect(source).toContain("toast.success(t('settings.categories.saveSuccess', 'Category updated successfully'));");
    expect(source).toContain('await fetchCategories();');
  });
});
