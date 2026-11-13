import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TemplateAst } from '@alga-psa/types';

const evaluateTemplateAst = vi.fn();
const renderTemplateAstHtmlDocument = vi.fn();

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  withTransaction: vi.fn(),
  tenantDb: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (fn: any) =>
    (...args: any[]) =>
      fn({ user_id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

vi.mock('../lib/adapters/tenantPartyAdapter', () => ({
  fetchTenantParty: vi.fn(async () => null),
}));

vi.mock('../lib/invoice-template-ast/evaluator', () => ({
  evaluateTemplateAst: (...args: any[]) => evaluateTemplateAst(...args),
}));

vi.mock('../lib/invoice-template-ast/server-render', () => ({
  renderTemplateAstHtmlDocument: (...args: any[]) => renderTemplateAstHtmlDocument(...args),
}));

vi.mock('../services/pdfGenerationService', () => ({
  createPDFGenerationService: () => ({
    resolveRenderCountry: vi.fn(async () => 'US'),
  }),
}));

function astWith(labelClass: string, customPageSize: { width: number; height: number; unit: 'mm' | 'in' }): TemplateAst {
  return {
    kind: 'invoice-template-ast',
    version: 1,
    metadata: { labelClass, printSettings: { customPageSize } },
    layout: { id: 'root', type: 'document', children: [] },
  } as unknown as TemplateAst;
}

const previewedModel = () => evaluateTemplateAst.mock.calls.at(-1)?.[1] as Record<string, any>;

async function previewWorkTag(templateAst: TemplateAst) {
  const { runAuthoritativeTemplatePreview } = await import('./documentTemplateActions');
  return runAuthoritativeTemplatePreview('work-tag', templateAst);
}

describe('runAuthoritativeTemplatePreview worksheet gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    evaluateTemplateAst.mockReturnValue({});
    renderTemplateAstHtmlDocument.mockResolvedValue('<html></html>');
  });

  it('applies worksheet field rules to an A4 ticket-work-tag template', async () => {
    const result = await previewWorkTag(astWith('ticket-work-tag', { width: 210, height: 297, unit: 'mm' }));
    expect(result).toEqual({ html: '<html></html>' });
    const model = previewedModel();
    // Worksheet mode keeps the full serial, description and asset specs on the sample.
    expect(model.linkedAsset).not.toBeNull();
    expect(model.ticketDescription).toBeTruthy();
    expect(model.assetSerialNumber).toBeTruthy();
  });

  it('keeps an A4 asset-identity template in tag mode so worksheet-only fields stay hidden', async () => {
    const result = await previewWorkTag(astWith('asset-identity', { width: 210, height: 297, unit: 'mm' }));
    expect(result).toEqual({ html: '<html></html>' });
    const model = previewedModel();
    // The gate keys on the TEMPLATE's label class, not the sample's hard-coded ticket-work-tag.
    expect(model.linkedAsset).toBeNull();
    expect(model.ticketDescription).toBeNull();
    expect(model.assetSerialNumber).toBeNull();
  });

  it('keeps a 4 x 2 in ticket-work-tag template in tag mode', async () => {
    const result = await previewWorkTag(astWith('ticket-work-tag', { width: 4, height: 2, unit: 'in' }));
    expect(result).toEqual({ html: '<html></html>' });
    const model = previewedModel();
    expect(model.linkedAsset).toBeNull();
    expect(model.ticketDescription).toBeNull();
  });
});
