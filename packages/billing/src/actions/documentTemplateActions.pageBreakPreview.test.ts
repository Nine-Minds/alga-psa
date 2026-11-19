/**
 * The template editor's preview is one continuous flow: a forced page break
 * leaves no trace in it, so an author who starts a section on a new page sees
 * nothing change and concludes the control did nothing. The preview asks the
 * renderer to caption each boundary — except for a work tag, which prints on
 * its own cell and has no page to break.
 */
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

const templateAst = {
  kind: 'invoice-template-ast',
  version: 1,
  layout: { id: 'root', type: 'document', children: [] },
} as unknown as TemplateAst;

const renderOptions = () => renderTemplateAstHtmlDocument.mock.calls.at(-1)?.[2] as Record<string, unknown>;

async function runPreview(documentType: string) {
  const { runAuthoritativeTemplatePreview } = await import('./documentTemplateActions');
  return runAuthoritativeTemplatePreview(documentType, templateAst);
}

describe('runAuthoritativeTemplatePreview page breaks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    evaluateTemplateAst.mockReturnValue({});
    renderTemplateAstHtmlDocument.mockResolvedValue('<html></html>');
  });

  it.each(['sales-order', 'packing-slip', 'pick-list'])('captions page boundaries in the %s preview', async (documentType) => {
    await runPreview(documentType);

    expect(renderOptions().pageBreakPreview).toBe(true);
  });

  it('leaves a work tag preview alone, since a label has no page to break', async () => {
    await runPreview('work-tag');

    expect(renderOptions().pageBreakPreview).toBe(false);
  });
});
