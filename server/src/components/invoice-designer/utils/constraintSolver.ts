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

      solver.addConstraint(new kiwi.Constraint(x, kiwi.Operator.Ge, 0, kiwi.Strength.required));
      solver.addConstraint(new kiwi.Constraint(y, kiwi.Operator.Ge, 0, kiwi.Strength.required));
      solver.addConstraint(new kiwi.Constraint(width, kiwi.Operator.Ge, 1, kiwi.Strength.required));
      solver.addConstraint(new kiwi.Constraint(height, kiwi.Operator.Ge, 1, kiwi.Strength.required));

      if (node.type !== 'document' && node.type !== 'page') {
        solver.addConstraint(new kiwi.Constraint(x, kiwi.Operator.Ge, 0, kiwi.Strength.required));
        solver.addConstraint(new kiwi.Constraint(y, kiwi.Operator.Ge, 0, kiwi.Strength.required));
        solver.addConstraint(
          new kiwi.Constraint(new kiwi.Expression(x).plus(width), kiwi.Operator.Le, bounds.width, kiwi.Strength.required)
        );
        solver.addConstraint(
          new kiwi.Constraint(new kiwi.Expression(y).plus(height), kiwi.Operator.Le, bounds.height, kiwi.Strength.required)
        );
      }

      variableMap.set(node.id, { x, y, width, height });
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

      const width = clamp(vars.width.value(), 1, bounds.width);
      const height = clamp(vars.height.value(), 1, bounds.height);
      const maxX = Math.max(0, bounds.width - width);
      const maxY = Math.max(0, bounds.height - height);
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
