// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('ticket materials card i18n wiring contract', () => {
  it('T070: routes the materials list, add dialog, and cost labels through features/tickets translations', () => {
    const source = read('./TicketMaterialsCard.tsx');

    expect(source).toContain("const { t } = useTranslation('features/tickets');");
    expect(source).toContain("t('materials.title', 'Materials')");
    expect(source).toContain("t('materials.addMaterial', 'Add Material')");
    expect(source).toContain("t('materials.product', 'Product')");
    expect(source).toContain("t('materials.selectProduct', 'Select a product...')");
    expect(source).toContain("t('materials.searchProducts', 'Search products...')");
    expect(source).toContain("t('materials.price', 'Price')");
    expect(source).toContain("t('materials.loadingPrices', 'Loading prices...')");
    expect(source).toContain("t('materials.quantity', 'Quantity')");
    expect(source).toContain("t('materials.total', 'Total')");
    expect(source).toContain("t('materials.descriptionOptional', 'Description (optional)')");
    expect(source).toContain("t('materials.qty', 'Qty')");
    expect(source).toContain("t('materials.rate', 'Rate')");
    expect(source).toContain("t('materials.status', 'Status')");
    expect(source).toContain("t('materials.billed', 'Billed')");
    expect(source).toContain("t('materials.pending', 'Pending')");
  });

  it('T071: routes materials empty-state, validation, and remove/load error feedback through translations', () => {
    const source = read('./TicketMaterialsCard.tsx');

    expect(source).toContain("t('errors.loadMaterials', 'Failed to load materials')");
    expect(source).toContain("t('errors.addMaterial', 'Failed to add material')");
    expect(source).toContain("t('errors.removeMaterial', 'Failed to remove material')");
    expect(source).toContain("t('validation.materials.productRequired', 'Please select a product')");
    expect(source).toContain("t('validation.materials.currencyRequired', 'Please select a currency')");
    expect(source).toContain("t('validation.materials.quantityMin', 'Quantity must be at least 1')");
    expect(source).toContain("t('materials.removeSuccess', 'Material removed')");
    expect(source).toContain("t('materials.loading', 'Loading materials...')");
    expect(source).toContain("t('materials.empty', 'No materials added to this ticket.')");
    expect(source).toContain("t(\n              'materials.clientRequired'");
  });
});
