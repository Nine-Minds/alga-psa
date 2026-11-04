import { describe, expect, it } from 'vitest';
import { templateAstSchema } from '../src/lib/invoice-template-ast/schema';
import { DOCUMENT_TYPE_REGISTRY } from '../src/lib/document-templates/registry';
import { getStandardLabelTemplateAstByCode, STANDARD_LABEL_RMA_CODE, LABEL_CLASS_BY_STANDARD_CODE } from '../src/lib/label-template-ast/standardTemplates';
import { getStandardRmaReturnSlipTemplateAstByCode, STANDARD_RMA_RETURN_SLIP_CODE } from '../src/lib/rma-return-slip-template-ast/standardTemplates';
import { resolveDocumentKindFromBindingCatalog } from '../src/components/invoice-designer/utils/documentKind';

const bindingIds = (node: unknown, out = new Set<string>()): Set<string> => {
  if (Array.isArray(node)) node.forEach((n) => bindingIds(n, out));
  else if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if (typeof o.bindingId === 'string') out.add(o.bindingId);
    Object.values(o).forEach((v) => bindingIds(v, out));
  }
  return out;
};

describe('RMA standard templates (C5)', () => {
  it('the return slip is a registered document type whose standard template parses and binds only catalog values', () => {
    const entry = DOCUMENT_TYPE_REGISTRY['rma-return-slip'];
    expect(entry.defaultStandardCode).toBe(STANDARD_RMA_RETURN_SLIP_CODE);
    const ast = getStandardRmaReturnSlipTemplateAstByCode(STANDARD_RMA_RETURN_SLIP_CODE)!;
    expect(templateAstSchema.safeParse(ast).success).toBe(true);
    const catalog = new Set(Object.keys(entry.buildBindings().values ?? {}));
    for (const id of bindingIds(ast.layout)) expect(catalog.has(id), id).toBe(true);
    expect(resolveDocumentKindFromBindingCatalog(entry.buildBindings())).toBe('rma-return-slip');
  });

  it('the RMA label is a standard work-tag template of class rma-work-tag that binds only catalog values', () => {
    expect(LABEL_CLASS_BY_STANDARD_CODE[STANDARD_LABEL_RMA_CODE]).toBe('rma-work-tag');
    const ast = getStandardLabelTemplateAstByCode(STANDARD_LABEL_RMA_CODE)!;
    expect(templateAstSchema.safeParse(ast).success).toBe(true);
    const catalog = new Set(Object.keys(DOCUMENT_TYPE_REGISTRY['work-tag'].buildBindings().values ?? {}));
    for (const id of bindingIds(ast.layout)) expect(catalog.has(id), id).toBe(true);
    expect(DOCUMENT_TYPE_REGISTRY['work-tag'].standardCodes).toContain(STANDARD_LABEL_RMA_CODE);
  });
});
