import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TemplateAst } from '@alga-psa/types';

const fetchTenantParty = vi.fn();
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
  fetchTenantParty: (...args: any[]) => fetchTenantParty(...args),
}));

vi.mock('../lib/invoice-template-ast/evaluator', () => ({
  evaluateTemplateAst: (...args: any[]) => evaluateTemplateAst(...args),
}));

vi.mock('../lib/invoice-template-ast/server-render', () => ({
  renderTemplateAstHtmlDocument: (...args: any[]) => renderTemplateAstHtmlDocument(...args),
}));

const templateAst = { kind: 'invoice-template-ast', version: 1, layout: { id: 'root', type: 'document', children: [] } } as unknown as TemplateAst;

const previewedModel = () => evaluateTemplateAst.mock.calls.at(-1)?.[1] as Record<string, any>;

async function runPreview(documentType: string) {
  const { runAuthoritativeTemplatePreview } = await import('./documentTemplateActions');
  return runAuthoritativeTemplatePreview(documentType, templateAst);
}

describe('runAuthoritativeTemplatePreview tenant branding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    evaluateTemplateAst.mockReturnValue({});
    renderTemplateAstHtmlDocument.mockResolvedValue('<html></html>');
  });

  it.each(['sales-order', 'packing-slip', 'pick-list'])(
    'renders the tenant real branding on the %s sample',
    async (documentType) => {
      fetchTenantParty.mockResolvedValue({
        name: 'Cascade IT Partners',
        address: '88 Pearl St, Boulder, CO 80302',
        email: 'billing@cascadeit.example',
        phone: '+1-303-555-0114',
        logo_url: 'https://cdn.example/logo.png',
      });

      const result = await runPreview(documentType);

      expect(result).toEqual({ html: '<html></html>' });
      expect(fetchTenantParty).toHaveBeenCalledWith({}, 'tenant-1');
      expect(previewedModel().tenantClient).toEqual({
        name: 'Cascade IT Partners',
        address: '88 Pearl St, Boulder, CO 80302',
        email: 'billing@cascadeit.example',
        phone: '+1-303-555-0114',
        logo_url: 'https://cdn.example/logo.png',
      });
      // The rest of the sample order must survive the overlay untouched.
      expect(previewedModel().so_number).toBe('SO-00042');
      expect(previewedModel().customer?.name).toBe('Acme Corp');
    },
  );

  it('keeps the synthetic sample issuer when the tenant has no default company', async () => {
    fetchTenantParty.mockResolvedValue(null);

    await runPreview('sales-order');

    expect(previewedModel().tenantClient?.name).toBe('Northwind MSP');
  });

  it('keeps the synthetic sample issuer when the branding lookup throws', async () => {
    fetchTenantParty.mockRejectedValue(new Error('tenant company lookup failed'));

    await runPreview('sales-order');

    expect(previewedModel().tenantClient?.name).toBe('Northwind MSP');
  });
});
