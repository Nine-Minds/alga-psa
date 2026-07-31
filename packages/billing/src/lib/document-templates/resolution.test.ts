import { describe, expect, it, vi } from 'vitest';
import type { TemplateAst } from '@alga-psa/types';

import { resolveDocumentTemplateAst } from './resolution';

const ast = (name: string): TemplateAst =>
  ({ kind: 'invoice-template-ast', version: 1, metadata: { templateName: name }, layout: { id: 'root', type: 'document', children: [] } }) as unknown as TemplateAst;

const standard = ast('standard');

describe('resolveDocumentTemplateAst precedence', () => {
  it('uses the entity override when present (highest precedence)', async () => {
    const result = await resolveDocumentTemplateAst({
      fetchOverride: vi.fn().mockResolvedValue(ast('override')),
      fetchTenantDefault: vi.fn().mockResolvedValue(ast('tenant')),
      getStandard: () => standard,
    });
    expect(result.source).toBe('override');
    expect(result.ast.metadata?.templateName).toBe('override');
  });

  it('falls back to the tenant default when there is no override', async () => {
    const fetchTenantDefault = vi.fn().mockResolvedValue(ast('tenant'));
    const result = await resolveDocumentTemplateAst({
      fetchOverride: vi.fn().mockResolvedValue(null),
      fetchTenantDefault,
      getStandard: () => standard,
    });
    expect(result.source).toBe('tenant-default');
    expect(result.ast.metadata?.templateName).toBe('tenant');
    expect(fetchTenantDefault).toHaveBeenCalledOnce();
  });

  it('falls back to the standard template when neither override nor tenant default exists', async () => {
    const result = await resolveDocumentTemplateAst({
      fetchOverride: vi.fn().mockResolvedValue(null),
      fetchTenantDefault: vi.fn().mockResolvedValue(null),
      getStandard: () => standard,
    });
    expect(result.source).toBe('standard');
    expect(result.ast).toBe(standard);
  });

  it('does not consult the tenant default once an override is found', async () => {
    const fetchTenantDefault = vi.fn().mockResolvedValue(ast('tenant'));
    await resolveDocumentTemplateAst({
      fetchOverride: vi.fn().mockResolvedValue(ast('override')),
      fetchTenantDefault,
      getStandard: () => standard,
    });
    expect(fetchTenantDefault).not.toHaveBeenCalled();
  });
});
