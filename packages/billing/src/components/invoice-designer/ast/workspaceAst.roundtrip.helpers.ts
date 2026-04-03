import { TEMPLATE_AST_VERSION } from '@alga-psa/types';
import type {
  TemplateAst,
  TemplateDocumentNode,
  TemplateNode,
  TemplateNodeType,
} from '@alga-psa/types';
import { exportWorkspaceToTemplateAst, importTemplateAstToWorkspace } from './workspaceAst';

export const cloneAst = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

type AstOverrides = Partial<Omit<TemplateAst, 'kind' | 'version' | 'layout'>> & {
  layout?: Partial<TemplateAst['layout']>;
};

export const createAstDocument = (
  children: TemplateNode[],
  overrides?: AstOverrides
): TemplateAst => {
  const layoutOverrides = overrides?.layout ?? {};
  return {
    kind: 'invoice-template-ast',
    version: TEMPLATE_AST_VERSION,
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

export const roundTripAst = (ast: TemplateAst): TemplateAst =>
  exportWorkspaceToTemplateAst(importTemplateAstToWorkspace(cloneAst(ast)));

export const exportImportExportAst = (ast: TemplateAst): TemplateAst =>
  exportWorkspaceToTemplateAst(importTemplateAstToWorkspace(roundTripAst(ast)));

export const getDocumentNode = (ast: TemplateAst): TemplateDocumentNode => {
  if (ast.layout.type !== 'document') {
    throw new Error(`Expected document layout, received ${ast.layout.type}`);
  }
  return ast.layout as TemplateDocumentNode;
};

export const findNodeById = <T extends TemplateNode = TemplateNode>(
  root: TemplateNode,
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

export const listNodesByType = <T extends TemplateNodeType>(
  root: TemplateNode,
  type: T
): Array<Extract<TemplateNode, { type: T }>> => {
  const output: Array<Extract<TemplateNode, { type: T }>> = [];
  const visit = (node: TemplateNode) => {
    if (node.type === type) {
      output.push(node as Extract<TemplateNode, { type: T }>);
    }
    const children = Array.isArray(node.children) ? node.children : [];
    children.forEach(visit);
  };
  visit(root);
  return output;
};
