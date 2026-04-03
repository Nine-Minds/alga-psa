import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Mock knex builder ────────────────────────────────────────────────
function buildMockKnex(initialRow?: { settings?: unknown }) {
  let storedRow = initialRow ?? null;
  const insertedRecords: Record<string, any>[] = [];

  const knex: any = (table: string) => {
    const chain: any = {};
    chain.select = vi.fn(() => chain);
    chain.where = vi.fn(() => chain);
    chain.first = vi.fn(async () => storedRow);
    chain.insert = vi.fn((record: Record<string, any>) => {
      insertedRecords.push(record);
      storedRow = { settings: record.settings };
      return chain;
    });
    chain.onConflict = vi.fn(() => chain);
    chain.merge = vi.fn(() => chain);
    return chain;
  };
  knex.fn = { now: () => 'NOW()' };

  return { knex, getInserted: () => insertedRecords };
}

import {
  getQuoteApprovalWorkflowSettings,
  setQuoteApprovalWorkflowRequired,
} from '../../src/lib/quoteApprovalSettings';

const TENANT = 'test-tenant';

describe('quoteApprovalSettings', () => {
  describe('getQuoteApprovalWorkflowSettings', () => {
    it('T220: returns approvalRequired false when no tenant_settings row exists', async () => {
      const { knex } = buildMockKnex(undefined);
      // Make first() return undefined
      const result = await getQuoteApprovalWorkflowSettings(knex, TENANT);
      expect(result).toEqual({ approvalRequired: false });
    });

    it('T221: returns approvalRequired false when settings is null', async () => {
      const { knex } = buildMockKnex({ settings: null });
      const result = await getQuoteApprovalWorkflowSettings(knex, TENANT);
      expect(result).toEqual({ approvalRequired: false });
    });

    it('T222: returns approvalRequired true when nested path exists', async () => {
      const { knex } = buildMockKnex({
        settings: { billing: { quotes: { approvalRequired: true } } },
      });
      const result = await getQuoteApprovalWorkflowSettings(knex, TENANT);
      expect(result).toEqual({ approvalRequired: true });
    });

    it('T223: parses JSON string settings', async () => {
      const { knex } = buildMockKnex({
        settings: JSON.stringify({ billing: { quotes: { approvalRequired: true } } }),
      });
      const result = await getQuoteApprovalWorkflowSettings(knex, TENANT);
      expect(result).toEqual({ approvalRequired: true });
    });

    it('T224: returns false for invalid JSON string', async () => {
      const { knex } = buildMockKnex({ settings: '{broken json' });
      const result = await getQuoteApprovalWorkflowSettings(knex, TENANT);
      expect(result).toEqual({ approvalRequired: false });
    });

    it('T225: returns false when billing.quotes path is missing', async () => {
      const { knex } = buildMockKnex({ settings: { billing: {} } });
      const result = await getQuoteApprovalWorkflowSettings(knex, TENANT);
      expect(result).toEqual({ approvalRequired: false });
    });

    it('T226: returns false for non-object/non-string settings value', async () => {
      const { knex } = buildMockKnex({ settings: 42 });
      const result = await getQuoteApprovalWorkflowSettings(knex, TENANT);
      expect(result).toEqual({ approvalRequired: false });
    });
  });

  describe('setQuoteApprovalWorkflowRequired', () => {
    it('T227: sets approvalRequired to true and preserves existing settings', async () => {
      const { knex, getInserted } = buildMockKnex({
        settings: { theme: 'dark', billing: { invoices: { autoPay: true } } },
      });

      const result = await setQuoteApprovalWorkflowRequired(knex, TENANT, true);
      expect(result).toEqual({ approvalRequired: true });

      const inserted = getInserted()[0];
      const savedSettings = JSON.parse(inserted.settings);
      expect(savedSettings.theme).toBe('dark');
      expect(savedSettings.billing.invoices.autoPay).toBe(true);
      expect(savedSettings.billing.quotes.approvalRequired).toBe(true);
    });

    it('T228: sets approvalRequired to false', async () => {
      const { knex, getInserted } = buildMockKnex({
        settings: { billing: { quotes: { approvalRequired: true } } },
      });

      const result = await setQuoteApprovalWorkflowRequired(knex, TENANT, false);
      expect(result).toEqual({ approvalRequired: false });

      const inserted = getInserted()[0];
      const savedSettings = JSON.parse(inserted.settings);
      expect(savedSettings.billing.quotes.approvalRequired).toBe(false);
    });

    it('T229: creates settings structure from scratch when no existing row', async () => {
      const noRow: any = undefined;
      const knex: any = (_table: string) => {
        const chain: any = {};
        chain.select = vi.fn(() => chain);
        chain.where = vi.fn(() => chain);
        chain.first = vi.fn(async () => noRow);
        chain.insert = vi.fn(() => chain);
        chain.onConflict = vi.fn(() => chain);
        chain.merge = vi.fn(() => chain);
        return chain;
      };
      knex.fn = { now: () => 'NOW()' };

      const result = await setQuoteApprovalWorkflowRequired(knex, TENANT, true);
      expect(result).toEqual({ approvalRequired: true });
    });
  });
});
