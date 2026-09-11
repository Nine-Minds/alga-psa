import { describe, expect, it } from 'vitest';
import { STOCK_EMAIL_PALETTE, STOCK_PALETTE_CONSTANT_NAMES } from '../stockPalette';
import { loadStockConstants } from './systemTemplateFixtures';

describe('stock email palette', () => {
  it('matches constants.cjs value for value', () => {
    const constants = loadStockConstants();

    for (const [token, constantName] of Object.entries(STOCK_PALETTE_CONSTANT_NAMES)) {
      expect(constants[constantName], `${constantName} is missing from constants.cjs`).toBeDefined();
      expect(STOCK_EMAIL_PALETTE[token as keyof typeof STOCK_EMAIL_PALETTE]).toBe(constants[constantName]);
    }
  });

  it('covers every color constant the templates paint with', () => {
    expect(Object.keys(STOCK_EMAIL_PALETTE).sort()).toEqual(Object.keys(STOCK_PALETTE_CONSTANT_NAMES).sort());
  });
});
