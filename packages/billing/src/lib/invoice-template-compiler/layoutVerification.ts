import type { LayoutElement } from '@alga-psa/types';
import type { InvoiceDesignerCompilerIr } from '../../components/invoice-designer/compiler/guiIr';

export type LayoutMetric = 'x' | 'y' | 'width' | 'height';

export type ExpectedLayoutConstraint = {
  id: string;
  nodeId: string;
  metric: LayoutMetric;
  expected: number;
  tolerance: number;
  category?: 'position' | 'sizing' | 'spacing' | 'alignment' | 'containment';
};

export type RenderedGeometry = {
  nodeId: string;
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
};

export type LayoutMismatch = {
  constraintId: string;
  nodeId: string;
  metric: LayoutMetric;
  expected: number;
  actual: number | null;
  delta: number | null;
  tolerance: number;
  message: string;
};

export type LayoutVerificationResult = {
  status: 'pass' | 'issues';
  mismatches: LayoutMismatch[];
};

const parsePixelValue = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return null;
  }

  const match = value.match(/-?\d+(\.\d+)?/);
  if (!match) {
    return null;
  }

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
};

const gatherLayoutChildren = (node: LayoutElement): LayoutElement[] => {
  const value = node as LayoutElement & { children?: unknown };
  if (!Array.isArray(value.children)) {
    return [];
  }
  return value.children as LayoutElement[];
};

type IrFlatNode = InvoiceDesignerCompilerIr['flatNodes'][number];

const resolveNormalizedYExpectation = (
  node: IrFlatNode,
  byId: Map<string, IrFlatNode>,
  absoluteY: number
): number => {
  if (!node.parentId) {
    return Math.round(absoluteY);
  }

  const parent = byId.get(node.parentId);
  if (!parent || parent.layout?.mode !== 'flex') {
    return Math.round(absoluteY);
  }

  const parentPadding = Math.max(0, Math.round(parent.layout.padding ?? 0));
  if (parent.layout.direction === 'row') {
    return Math.round(absoluteY) - parentPadding;
  }

  const siblingIds = parent.childIds;
  const siblingIndex = siblingIds.indexOf(node.id);
  if (siblingIndex <= 0) {
    return Math.round(absoluteY) - parentPadding;
  }

  const previousSibling = byId.get(siblingIds[siblingIndex - 1]);
  if (!previousSibling) {
    return Math.round(absoluteY) - parentPadding;
  }

  const previousSiblingBottom =
    Math.round(previousSibling.position.y) + Math.round(previousSibling.size.height);
  return Math.round(absoluteY) - previousSiblingBottom;
};

export const collectRenderedGeometryFromLayout = (
  layout: LayoutElement
): Record<string, RenderedGeometry> => {
  const geometryByNode: Record<string, RenderedGeometry> = {};

  const walk = (element: LayoutElement) => {
    if (typeof element.id === 'string' && element.id.trim().length > 0) {
      const style = element.style ?? {};
      const height = parsePixelValue(style.height) ?? parsePixelValue(style.borderTop);
      geometryByNode[element.id] = {
        nodeId: element.id,
        x: parsePixelValue(style.paddingLeft) ?? parsePixelValue(style.marginLeft),
        y: parsePixelValue(style.marginTop),
        width: parsePixelValue(style.width),
        height,
      };
    }

    gatherLayoutChildren(element).forEach((child) => walk(child));
  };

  walk(layout);
  return geometryByNode;
};

export const extractExpectedLayoutConstraintsFromIr = (
  ir: InvoiceDesignerCompilerIr,
  tolerance = 2
): ExpectedLayoutConstraint[] => {
  const constraints: ExpectedLayoutConstraint[] = [];
  const byId = new Map(ir.flatNodes.map((node) => [node.id, node]));

  ir.flatNodes
    .filter((node) => node.type !== 'document')
    .forEach((node) => {
      const parent = node.parentId ? byId.get(node.parentId) : null;

      constraints.push({
        id: `${node.id}:x`,
        nodeId: node.id,
        metric: 'x',
        expected: node.position.x,
        tolerance,
        category: 'position',
      });
      constraints.push({
        id: `${node.id}:y`,
        nodeId: node.id,
        metric: 'y',
        expected: resolveNormalizedYExpectation(node, byId, node.position.y),
        tolerance,
        category: 'position',
      });
      constraints.push({
        id: `${node.id}:width`,
        nodeId: node.id,
        metric: 'width',
        expected: node.size.width,
        tolerance,
        category: 'sizing',
      });
      constraints.push({
        id: `${node.id}:height`,
        nodeId: node.id,
        metric: 'height',
        expected: node.size.height,
        tolerance,
        category: 'sizing',
      });

      if (parent?.layout?.mode === 'flex') {
        const parentPadding = Math.max(0, parent.layout.padding ?? 0);
        const maxX = Math.max(0, parent.size.width - parentPadding - node.size.width);
        const maxY = Math.max(0, parent.size.height - parentPadding - node.size.height);
        const boundedX = Math.min(Math.max(node.position.x, parentPadding), maxX);
        const boundedY = Math.min(Math.max(node.position.y, parentPadding), maxY);
        const shouldApplyContainment = (parent.layout.sizing ?? 'fixed') === 'fixed';
        if (shouldApplyContainment) {
          constraints.push({
            id: `${node.id}:containment-x`,
            nodeId: node.id,
            metric: 'x',
            expected: boundedX,
            tolerance,
            category: 'containment',
          });
          constraints.push({
            id: `${node.id}:containment-y`,
            nodeId: node.id,
            metric: 'y',
            expected: resolveNormalizedYExpectation(node, byId, boundedY),
            tolerance,
            category: 'containment',
          });
        }

        const parentChildren = parent.childIds;
        const currentIndex = parentChildren.indexOf(node.id);
        if (currentIndex > 0) {
          const previousSibling = byId.get(parentChildren[currentIndex - 1]);
          if (previousSibling) {
            const gap = Math.max(0, parent.layout.gap ?? 0);
            if (parent.layout.direction === 'column') {
              const expectedSpacingY = previousSibling.position.y + previousSibling.size.height + gap;
              const followsDerivedSpacing = Math.abs(node.position.y - expectedSpacingY) <= tolerance;
              if (followsDerivedSpacing) {
                constraints.push({
                  id: `${node.id}:spacing-y`,
                  nodeId: node.id,
                  metric: 'y',
                  expected: resolveNormalizedYExpectation(node, byId, expectedSpacingY),
                  tolerance,
                  category: 'spacing',
                });
              }
            } else {
              const expectedSpacingX = previousSibling.position.x + previousSibling.size.width + gap;
              const followsDerivedSpacing = Math.abs(node.position.x - expectedSpacingX) <= tolerance;
              if (followsDerivedSpacing) {
                constraints.push({
                  id: `${node.id}:spacing-x`,
                  nodeId: node.id,
                  metric: 'x',
                  expected: expectedSpacingX,
                  tolerance,
                  category: 'spacing',
                });
              }
            }
          }
        }

        if (parent.layout.direction === 'column') {
          const innerWidth = Math.max(1, parent.size.width - parentPadding * 2);
          if (parent.layout.align === 'center') {
            const expectedAlignmentX = parentPadding + (innerWidth - node.size.width) / 2;
            const followsDerivedAlignment = Math.abs(node.position.x - expectedAlignmentX) <= tolerance;
            if (followsDerivedAlignment) {
              constraints.push({
                id: `${node.id}:alignment-x`,
                nodeId: node.id,
                metric: 'x',
                expected: expectedAlignmentX,
                tolerance,
                category: 'alignment',
              });
            }
          } else if (parent.layout.align === 'end') {
            const expectedAlignmentX = Math.max(parentPadding, parent.size.width - parentPadding - node.size.width);
            const followsDerivedAlignment = Math.abs(node.position.x - expectedAlignmentX) <= tolerance;
            if (followsDerivedAlignment) {
              constraints.push({
                id: `${node.id}:alignment-x`,
                nodeId: node.id,
                metric: 'x',
                expected: expectedAlignmentX,
                tolerance,
                category: 'alignment',
              });
            }
          }
        } else {
          const innerHeight = Math.max(1, parent.size.height - parentPadding * 2);
          if (parent.layout.align === 'center') {
            const expectedAlignmentY = parentPadding + (innerHeight - node.size.height) / 2;
            const followsDerivedAlignment = Math.abs(node.position.y - expectedAlignmentY) <= tolerance;
            if (followsDerivedAlignment) {
              constraints.push({
                id: `${node.id}:alignment-y`,
                nodeId: node.id,
                metric: 'y',
                expected: resolveNormalizedYExpectation(node, byId, expectedAlignmentY),
                tolerance,
                category: 'alignment',
              });
            }
          } else if (parent.layout.align === 'end') {
            const expectedAlignmentY = Math.max(parentPadding, parent.size.height - parentPadding - node.size.height);
            const followsDerivedAlignment = Math.abs(node.position.y - expectedAlignmentY) <= tolerance;
            if (followsDerivedAlignment) {
              constraints.push({
                id: `${node.id}:alignment-y`,
                nodeId: node.id,
                metric: 'y',
                expected: resolveNormalizedYExpectation(node, byId, expectedAlignmentY),
                tolerance,
                category: 'alignment',
              });
            }
          }
        }
      }
    });

  return constraints;
};

export const compareLayoutConstraints = (
  constraints: ExpectedLayoutConstraint[],
  geometryByNode: Record<string, RenderedGeometry>
): LayoutVerificationResult => {
  const mismatches: LayoutMismatch[] = [];

  constraints.forEach((constraint) => {
    const rendered = geometryByNode[constraint.nodeId];
    const actualValue = rendered?.[constraint.metric] ?? null;
    if (actualValue === null) {
      mismatches.push({
        constraintId: constraint.id,
        nodeId: constraint.nodeId,
        metric: constraint.metric,
        expected: constraint.expected,
        actual: null,
        delta: null,
        tolerance: constraint.tolerance,
        message: 'Rendered geometry is missing for this node metric.',
      });
      return;
    }

    const delta = Math.abs(actualValue - constraint.expected);
    if (delta > constraint.tolerance) {
      mismatches.push({
        constraintId: constraint.id,
        nodeId: constraint.nodeId,
        metric: constraint.metric,
        expected: constraint.expected,
        actual: actualValue,
        delta,
        tolerance: constraint.tolerance,
        message: `Constraint exceeded tolerance (${delta.toFixed(2)} > ${constraint.tolerance.toFixed(2)}).`,
      });
    }
  });

  return {
    status: mismatches.length > 0 ? 'issues' : 'pass',
    mismatches,
  };
};
