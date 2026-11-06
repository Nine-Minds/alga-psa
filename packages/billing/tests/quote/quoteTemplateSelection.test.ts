import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────
const getByIdMock = vi.fn();
vi.mock('../../src/models/quote', () => ({
  default: { getById: (...args: any[]) => getByIdMock(...args) },
}));

const getStandardMock = vi.fn();
vi.mock('../../src/lib/quote-template-ast/standardTemplates', () => ({
  getStandardQuoteTemplateAstByCode: (...args: any[]) => getStandardMock(...args),
  STANDARD_QUOTE_DEFAULT_CODE: 'standard-quote-default',
  STANDARD_QUOTE_BY_LOCATION_CODE: 'standard-quote-by-location',
}));

import { resolveQuoteTemplateAst } from '../../src/lib/quote-template-ast/templateSelection';

const TENANT = 'test-tenant';

const SAMPLE_AST = {
  kind: 'invoice-template-ast' as const,
  version: 1 as const,
  metadata: { templateName: 'Test' },
  layout: { id: 'root', type: 'document' as const, children: [] },
};

function buildMockKnex(opts: {
  customTemplate?: Record<string, any> | null;
  standardTemplate?: Record<string, any> | null;
  tenantAssignment?: Record<string, any> | null;
}) {
  // Every standard-template lookup is recorded so a test can prove which
  // layout code was asked for, not just which one came back.
  const standardLookups: any[] = [];

  const knex: any = (table: string) => {
    const chain: any = {};
    chain.select = vi.fn(() => chain);
    chain.where = vi.fn((clause: any) => {
      if (table === 'standard_quote_document_templates') standardLookups.push(clause);
      return chain;
    });
    chain.whereNull = vi.fn(() => chain);
    chain.first = vi.fn(async () => {
      if (table === 'quote_document_templates') return opts.customTemplate ?? null;
      if (table === 'standard_quote_document_templates') return opts.standardTemplate ?? null;
      if (table === 'quote_document_template_assignments') return opts.tenantAssignment ?? null;
      return null;
    });
    return chain;
  };

  knex.standardLookups = standardLookups;
  return knex;
}

const requestedStandardCodes = (knex: any): string[] =>
  (knex.standardLookups as any[])
    .map((clause) => clause?.standard_quote_document_template_code)
    .filter((code: unknown): code is string => typeof code === 'string');

describe('quote-template-ast – templateSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getByIdMock.mockResolvedValue(null);
    getStandardMock.mockReturnValue({ ...SAMPLE_AST });
  });

  it('T270: throws when quote is not found', async () => {
    const knex = buildMockKnex({});
    getByIdMock.mockResolvedValue(null);

    await expect(resolveQuoteTemplateAst(knex, TENANT, 'nonexistent'))
      .rejects.toThrow('Quote not found');
  });

  it('T271: uses quote-level custom template when template_id is set', async () => {
    getByIdMock.mockResolvedValue({ quote_id: 'q-1', template_id: 'tmpl-custom' });
    const knex = buildMockKnex({
      customTemplate: { templateAst: SAMPLE_AST },
    });

    const result = await resolveQuoteTemplateAst(knex, TENANT, 'q-1');
    expect(result.source).toBe('quote');
    expect(result.templateId).toBe('tmpl-custom');
    expect(result.templateAst.kind).toBe('invoice-template-ast');
  });

  it('T272: falls back to tenant-default custom assignment', async () => {
    getByIdMock.mockResolvedValue({ quote_id: 'q-1', template_id: null });
    const knex = buildMockKnex({
      customTemplate: { templateAst: SAMPLE_AST },
      tenantAssignment: {
        template_source: 'custom',
        quote_document_template_id: 'tmpl-tenant',
        standard_quote_document_template_code: null,
      },
    });

    const result = await resolveQuoteTemplateAst(knex, TENANT, 'q-1');
    expect(result.source).toBe('tenant-default');
    expect(result.templateId).toBe('tmpl-tenant');
  });

  it('T273: falls back to tenant-default standard assignment', async () => {
    getByIdMock.mockResolvedValue({ quote_id: 'q-1', template_id: null });
    const knex = buildMockKnex({
      standardTemplate: { templateAst: SAMPLE_AST },
      tenantAssignment: {
        template_source: 'standard',
        standard_quote_document_template_code: 'standard-quote-default',
        quote_document_template_id: null,
      },
    });

    const result = await resolveQuoteTemplateAst(knex, TENANT, 'q-1');
    expect(result.source).toBe('tenant-default');
    expect(result.standardCode).toBe('standard-quote-default');
  });

  it('T274: falls back to standard-quote-default when no assignments exist', async () => {
    getByIdMock.mockResolvedValue({ quote_id: 'q-1', template_id: null });
    const knex = buildMockKnex({
      tenantAssignment: null,
    });
    getStandardMock.mockReturnValue({ ...SAMPLE_AST });

    const result = await resolveQuoteTemplateAst(knex, TENANT, 'q-1');
    expect(result.source).toBe('standard-fallback');
    expect(result.standardCode).toBe('standard-quote-default');
  });

  it('T275: throws when even the standard fallback is unavailable', async () => {
    getByIdMock.mockResolvedValue({ quote_id: 'q-1', template_id: null });
    const knex = buildMockKnex({ tenantAssignment: null });
    // Both DB and code-level lookups return null
    getStandardMock.mockReturnValue(null);

    await expect(resolveQuoteTemplateAst(knex, TENANT, 'q-1'))
      .rejects.toThrow('Standard quote template fallback is unavailable');
  });

  it('T276: accepts an IQuote object directly instead of a string ID', async () => {
    const quoteObj = { quote_id: 'q-direct', template_id: null } as any;
    const knex = buildMockKnex({ tenantAssignment: null });
    getStandardMock.mockReturnValue({ ...SAMPLE_AST });

    const result = await resolveQuoteTemplateAst(knex, TENANT, quoteObj);
    // Should NOT call getById since we passed the object directly
    expect(getByIdMock).not.toHaveBeenCalled();
    expect(result.source).toBe('standard-fallback');
  });

  // alga-2026-0002902 / PR review: the grouped-by-location standard layout is
  // only ever used when someone picks it — per quote or as the tenant
  // assignment. How many locations the items span never selects a layout.
  describe('by-location layout is explicit-selection only (alga-2026-0002902)', () => {
    const multiLocationItems = [
      { quote_item_id: 'i-1', location_id: 'loc-1' },
      { quote_item_id: 'i-2', location_id: 'loc-2' },
    ];

    it('T902d: honours a per-quote pick of the by-location standard', async () => {
      const quote = {
        quote_id: 'q-by-location',
        template_id: 'tmpl-standard-by-location',
        quote_items: multiLocationItems,
      } as any;
      const knex = buildMockKnex({
        standardTemplate: {
          templateAst: SAMPLE_AST,
          standard_quote_document_template_code: 'standard-quote-by-location',
        },
      });

      const result = await resolveQuoteTemplateAst(knex, TENANT, quote);
      expect(result.source).toBe('quote');
      expect(result.templateId).toBe('tmpl-standard-by-location');
      expect(result.standardCode).toBe('standard-quote-by-location');
    });

    it('T902e: honours a tenant assignment of the by-location standard', async () => {
      const quote = { quote_id: 'q-by-location', template_id: null, quote_items: multiLocationItems } as any;
      const knex = buildMockKnex({
        standardTemplate: { templateAst: SAMPLE_AST },
        tenantAssignment: {
          template_source: 'standard',
          standard_quote_document_template_code: 'standard-quote-by-location',
          quote_document_template_id: null,
        },
      });

      const result = await resolveQuoteTemplateAst(knex, TENANT, quote);
      expect(result.source).toBe('tenant-default');
      expect(result.standardCode).toBe('standard-quote-by-location');
      expect(requestedStandardCodes(knex)).toContain('standard-quote-by-location');
    });

    it('T902f: keeps the flat default for a multi-location quote picked per quote', async () => {
      const quote = {
        quote_id: 'q-multi',
        template_id: 'tmpl-standard-default',
        quote_items: multiLocationItems,
      } as any;
      const knex = buildMockKnex({
        standardTemplate: {
          templateAst: SAMPLE_AST,
          standard_quote_document_template_code: 'standard-quote-default',
        },
      });

      const result = await resolveQuoteTemplateAst(knex, TENANT, quote);
      expect(result.source).toBe('quote');
      expect(result.standardCode).toBe('standard-quote-default');
      expect(requestedStandardCodes(knex)).not.toContain('standard-quote-by-location');
      expect(getStandardMock).not.toHaveBeenCalledWith('standard-quote-by-location');
    });

    it('T902g: keeps the flat default for a multi-location quote on the tenant default', async () => {
      const quote = { quote_id: 'q-multi', template_id: null, quote_items: multiLocationItems } as any;
      const knex = buildMockKnex({
        standardTemplate: { templateAst: SAMPLE_AST },
        tenantAssignment: {
          template_source: 'standard',
          standard_quote_document_template_code: 'standard-quote-default',
          quote_document_template_id: null,
        },
      });

      const result = await resolveQuoteTemplateAst(knex, TENANT, quote);
      expect(result.source).toBe('tenant-default');
      expect(result.standardCode).toBe('standard-quote-default');
      expect(requestedStandardCodes(knex)).not.toContain('standard-quote-by-location');
    });

    it('T902h: keeps the flat default for a multi-location quote with no assignment', async () => {
      const quote = { quote_id: 'q-multi', template_id: null, quote_items: multiLocationItems } as any;
      const knex = buildMockKnex({ tenantAssignment: null });

      const result = await resolveQuoteTemplateAst(knex, TENANT, quote);
      expect(result.source).toBe('standard-fallback');
      expect(result.standardCode).toBe('standard-quote-default');
      expect(requestedStandardCodes(knex)).not.toContain('standard-quote-by-location');
      expect(getStandardMock).toHaveBeenCalledWith('standard-quote-default');
      expect(getStandardMock).not.toHaveBeenCalledWith('standard-quote-by-location');
    });

    it('T902i: leaves a custom template untouched for a multi-location quote', async () => {
      const quote = { quote_id: 'q-multi', template_id: 'tmpl-custom', quote_items: multiLocationItems } as any;
      const knex = buildMockKnex({ customTemplate: { templateAst: SAMPLE_AST } });

      const result = await resolveQuoteTemplateAst(knex, TENANT, quote);
      expect(result.source).toBe('quote');
      expect(result.templateId).toBe('tmpl-custom');
      expect(result.standardCode).toBeUndefined();
    });
  });

  it('T277: returns a clone, not the original AST reference', async () => {
    getByIdMock.mockResolvedValue({ quote_id: 'q-1', template_id: 'tmpl-1' });
    const originalAst = { ...SAMPLE_AST, layout: { ...SAMPLE_AST.layout } };
    const knex = buildMockKnex({
      customTemplate: { templateAst: originalAst },
    });

    const result = await resolveQuoteTemplateAst(knex, TENANT, 'q-1');
    // Should be a deep clone
    expect(result.templateAst).not.toBe(originalAst);
    expect(result.templateAst).toEqual(originalAst);
  });
});
