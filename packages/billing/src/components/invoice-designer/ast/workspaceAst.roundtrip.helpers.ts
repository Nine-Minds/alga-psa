import { INVOICE_TEMPLATE_AST_VERSION } from '@alga-psa/types';
import type {
  InvoiceTemplateAst,
  InvoiceTemplateDocumentNode,
  InvoiceTemplateNode,
  InvoiceTemplateNodeType,
} from '@alga-psa/types';
import { exportWorkspaceToInvoiceTemplateAst, importInvoiceTemplateAstToWorkspace } from './workspaceAst';

export const cloneAst = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

type AstOverrides = Partial<Omit<InvoiceTemplateAst, 'kind' | 'version' | 'layout'>> & {
  layout?: Partial<InvoiceTemplateAst['layout']>;
};

export const createAstDocument = (
  children: InvoiceTemplateNode[],
  overrides?: AstOverrides
): InvoiceTemplateAst => {
  const layoutOverrides = overrides?.layout ?? {};
  return {
    kind: 'invoice-template-ast',
    version: INVOICE_TEMPLATE_AST_VERSION,
    bindings: { values: {}, collections: {} },
    ...overrides,
    layout: {
      id: layoutOverrides.id ?? 'root',
      type: 'document',
      children,
      ...(layoutOverrides.style ? { style: layoutOverrides.style } : {}),
    },
  };
};

export const roundTripAst = (ast: InvoiceTemplateAst): InvoiceTemplateAst =>
  exportWorkspaceToInvoiceTemplateAst(importInvoiceTemplateAstToWorkspace(cloneAst(ast)));

export const exportImportExportAst = (ast: InvoiceTemplateAst): InvoiceTemplateAst =>
  exportWorkspaceToInvoiceTemplateAst(importInvoiceTemplateAstToWorkspace(roundTripAst(ast)));

export const getDocumentNode = (ast: InvoiceTemplateAst): InvoiceTemplateDocumentNode => {
  if (ast.layout.type !== 'document') {
    throw new Error(`Expected document layout, received ${ast.layout.type}`);
  }
  return ast.layout as InvoiceTemplateDocumentNode;
};

export const findNodeById = <T extends InvoiceTemplateNode = InvoiceTemplateNode>(
  root: InvoiceTemplateNode,
  id: string
): T | null => {
  if (root.id === id) {
    return root as T;
  }

  const children = Array.isArray(root.children) ? root.children : [];
  for (const child of children) {
    const found = findNodeById<T>(child, id);
    if (found) {
      return found;
    }
  }
  return null;
};

export const listNodesByType = <T extends InvoiceTemplateNodeType>(
  root: InvoiceTemplateNode,
  type: T
): Array<Extract<InvoiceTemplateNode, { type: T }>> => {
  const output: Array<Extract<InvoiceTemplateNode, { type: T }>> = [];
  const visit = (node: InvoiceTemplateNode) => {
    if (node.type === type) {
      output.push(node as Extract<InvoiceTemplateNode, { type: T }>);
    }
    const children = Array.isArray(node.children) ? node.children : [];
    children.forEach(visit);
  };
  visit(root);
  return output;
};
