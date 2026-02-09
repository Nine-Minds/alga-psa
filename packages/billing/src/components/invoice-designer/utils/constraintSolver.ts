import * as kiwi from 'kiwi.js';

import { DESIGNER_CANVAS_BOUNDS } from '../constants/layout';
import type { DesignerConstraint, DesignerNode, ConstraintStrength } from '../state/designerStore';

const DEFAULT_STRENGTH = kiwi.Strength.required;

const strengthMap = {
  required: kiwi.Strength.required,
  strong: kiwi.Strength.strong,
  medium: kiwi.Strength.medium,
  weak: kiwi.Strength.weak,
} as const;
const toKiwiStrength = (strength?: ConstraintStrength) => strengthMap[strength ?? 'required'] ?? DEFAULT_STRENGTH;

type VariableBundle = {
  x: kiwi.Variable;
  y: kiwi.Variable;
  width: kiwi.Variable;
  height: kiwi.Variable;
};

export interface CanvasBounds {
  width: number;
  height: number;
}

export const solveConstraints = (
  nodes: DesignerNode[],
  constraints: DesignerConstraint[],
  bounds: CanvasBounds = DESIGNER_CANVAS_BOUNDS
): DesignerNode[] => {
  if (!nodes.length) {
    return nodes;
  }

  try {
    const solver = new kiwi.Solver();
    const variableMap = new Map<string, VariableBundle>();

    nodes.forEach((node) => {
      const x = new kiwi.Variable(`${node.id}-x`);
      const y = new kiwi.Variable(`${node.id}-y`);
      const width = new kiwi.Variable(`${node.id}-w`);
      const height = new kiwi.Variable(`${node.id}-h`);

      solver.addEditVariable(x, kiwi.Strength.strong);
      solver.addEditVariable(y, kiwi.Strength.strong);
      solver.addEditVariable(width, kiwi.Strength.medium);
      solver.addEditVariable(height, kiwi.Strength.medium);

      solver.suggestValue(x, node.position.x);
      solver.suggestValue(y, node.position.y);
      solver.suggestValue(width, node.size.width);
      solver.suggestValue(height, node.size.height);

      variableMap.set(node.id, { x, y, width, height });
    });

    nodes.forEach((node) => {
      const vars = variableMap.get(node.id);
      if (!vars) {
        return;
      }

      solver.addConstraint(new kiwi.Constraint(vars.x, kiwi.Operator.Ge, 0, kiwi.Strength.required));
      solver.addConstraint(new kiwi.Constraint(vars.y, kiwi.Operator.Ge, 0, kiwi.Strength.required));
      solver.addConstraint(new kiwi.Constraint(vars.width, kiwi.Operator.Ge, 1, kiwi.Strength.required));
      solver.addConstraint(new kiwi.Constraint(vars.height, kiwi.Operator.Ge, 1, kiwi.Strength.required));

      if (node.type === 'document' || node.type === 'page') {
        return;
      }

      const parentVars = node.parentId ? variableMap.get(node.parentId) : undefined;
      if (parentVars) {
        solver.addConstraint(
          new kiwi.Constraint(
            new kiwi.Expression(vars.x).plus(vars.width).minus(parentVars.width),
            kiwi.Operator.Le,
            0,
            kiwi.Strength.required
          )
        );
        solver.addConstraint(
          new kiwi.Constraint(
            new kiwi.Expression(vars.y).plus(vars.height).minus(parentVars.height),
            kiwi.Operator.Le,
            0,
            kiwi.Strength.required
          )
        );
        return;
      }

      solver.addConstraint(
        new kiwi.Constraint(new kiwi.Expression(vars.x).plus(vars.width), kiwi.Operator.Le, bounds.width, kiwi.Strength.required)
      );
      solver.addConstraint(
        new kiwi.Constraint(new kiwi.Expression(vars.y).plus(vars.height), kiwi.Operator.Le, bounds.height, kiwi.Strength.required)
      );
    });

    constraints.forEach((constraint) => {
      const strength = toKiwiStrength(constraint.strength);

      switch (constraint.type) {
        case 'align-left':
        case 'align-top':
        case 'match-width':
        case 'match-height': {
          const [aId, bId] = constraint.nodes;
          const nodeA = variableMap.get(aId);
          const nodeB = variableMap.get(bId);
          if (!nodeA || !nodeB) return;

          const [varA, varB] =
            constraint.type === 'align-left'
              ? [nodeA.x, nodeB.x]
              : constraint.type === 'align-top'
                ? [nodeA.y, nodeB.y]
                : constraint.type === 'match-width'
                  ? [nodeA.width, nodeB.width]
                  : [nodeA.height, nodeB.height];

          solver.addConstraint(new kiwi.Constraint(new kiwi.Expression(varA).minus(varB), kiwi.Operator.Eq, 0, strength));
          break;
        }
        case 'aspect-ratio': {
          const nodeVars = variableMap.get(constraint.nodeId);
          if (!nodeVars) return;
          const expr = new kiwi.Expression(nodeVars.width).minus(
            new kiwi.Expression([constraint.ratio, nodeVars.height])
          );
          solver.addConstraint(new kiwi.Constraint(expr, kiwi.Operator.Eq, 0, strength));
          break;
        }
        default:
          return;
      }
    });

    solver.updateVariables();

    return nodes.map((node) => {
      const vars = variableMap.get(node.id);
      if (!vars) return node;
      
      if (node.type === 'document' || node.type === 'page') {
        return {
          ...node,
          position: {
            x: vars.x.value(),
            y: vars.y.value(),
          },
          size: {
            width: vars.width.value(),
            height: vars.height.value(),
          },
        };
      }

      const parentVars = node.parentId ? variableMap.get(node.parentId) : undefined;
      const maxWidth = Math.max(1, parentVars?.width.value() ?? bounds.width);
      const maxHeight = Math.max(1, parentVars?.height.value() ?? bounds.height);
      const width = clamp(vars.width.value(), 1, maxWidth);
      const height = clamp(vars.height.value(), 1, maxHeight);
      const maxX = Math.max(0, maxWidth - width);
      const maxY = Math.max(0, maxHeight - height);
      return {
        ...node,
        position: {
          x: clamp(vars.x.value(), 0, maxX),
          y: clamp(vars.y.value(), 0, maxY),
        },
        size: {
          width,
          height,
        },
      };
    });
  } catch (error) {
    console.warn('[Designer] constraint solver failed, returning original layout', error);
    return nodes;
  }
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
