import type { LayoutElement } from '@alga-psa/types';
import type { InvoiceDesignerCompilerIr } from '../../components/invoice-designer/compiler/guiIr';

export type LayoutMetric = 'x' | 'y' | 'width' | 'height';

export type ExpectedLayoutConstraint = {
  id: string;
  nodeId: string;
  metric: LayoutMetric;
  expected: number;
  tolerance: number;
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

  ir.flatNodes
    .filter((node) => node.type !== 'document')
    .forEach((node) => {
      constraints.push({
        id: `${node.id}:x`,
        nodeId: node.id,
        metric: 'x',
        expected: node.position.x,
        tolerance,
      });
      constraints.push({
        id: `${node.id}:y`,
        nodeId: node.id,
        metric: 'y',
        expected: node.position.y,
        tolerance,
      });
      constraints.push({
        id: `${node.id}:width`,
        nodeId: node.id,
        metric: 'width',
        expected: node.size.width,
        tolerance,
      });
      constraints.push({
        id: `${node.id}:height`,
        nodeId: node.id,
        metric: 'height',
        expected: node.size.height,
        tolerance,
      });
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
