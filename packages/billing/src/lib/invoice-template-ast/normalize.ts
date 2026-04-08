import type { TemplateAst, TemplateNode } from '@alga-psa/types';

type TemplateNodeWithChildren = TemplateNode & { children?: TemplateNode[] };

const normalizeTemplateNode = (node: TemplateNode): TemplateNode => {
  const candidate = node as TemplateNodeWithChildren;
  const normalizedChildren = Array.isArray(candidate.children)
    ? candidate.children.map(normalizeTemplateNode)
    : undefined;
  const childrenChanged =
    Array.isArray(candidate.children) &&
    normalizedChildren?.some((child, index) => child !== candidate.children?.[index]);

  let nextNode: TemplateNode =
    childrenChanged && normalizedChildren
      ? ({ ...candidate, children: normalizedChildren } as TemplateNode)
      : node;

  if (nextNode.type === 'field' && nextNode.borderStyle === undefined) {
    nextNode = {
      ...nextNode,
      borderStyle: 'none',
    };
  }

  return nextNode;
};

export const normalizeTemplateAstFieldBorderDefaults = (ast: TemplateAst): TemplateAst => {
  const normalizedLayout = normalizeTemplateNode(ast.layout);
  if (normalizedLayout === ast.layout) {
    return ast;
  }

  return {
    ...ast,
    layout: normalizedLayout as TemplateAst['layout'],
  };
};
