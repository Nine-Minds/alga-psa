import type { DesignerConstraint, DesignerNode } from '../state/designerStore';

type PairConstraint = Extract<DesignerConstraint, { nodes: [string, string] }>;

export type PairConstraintType = PairConstraint['type'];
export type PairConstraintNode = Pick<DesignerNode, 'id' | 'name' | 'type' | 'parentId'>;

export const PAIR_CONSTRAINT_TYPES = ['align-left', 'align-top', 'match-width', 'match-height'] as const;

export const PAIR_CONSTRAINT_LABELS: Record<PairConstraintType, string> = {
  'align-left': 'Align left',
  'align-top': 'Align top',
  'match-width': 'Match width',
  'match-height': 'Match height',
};

const UNSUPPORTED_PAIR_CONSTRAINT_TYPES = new Set<DesignerNode['type']>(['document', 'page']);

export type PairConstraintValidationReason =
  | 'missing-node'
  | 'same-node'
  | 'unsupported-node-type'
  | 'different-parent';

export type PairConstraintValidationResult =
  | {
      ok: true;
      orderedNodeIds: [string, string];
      referenceNode: PairConstraintNode;
      targetNode: PairConstraintNode;
    }
  | {
      ok: false;
      reason: PairConstraintValidationReason;
      message: string;
    };

export type ConstraintSanitizationResult = {
  constraints: DesignerConstraint[];
  removedInvalidCount: number;
  removedDuplicateCount: number;
};

export const isPairConstraintType = (value: DesignerConstraint['type']): value is PairConstraintType =>
  value !== 'aspect-ratio';

export const isPairConstraint = (constraint: DesignerConstraint): constraint is PairConstraint =>
  isPairConstraintType(constraint.type);

export const canNodeParticipateInPairConstraint = (node: Pick<DesignerNode, 'type'> | null | undefined) => {
  if (!node) {
    return false;
  }
  return !UNSUPPORTED_PAIR_CONSTRAINT_TYPES.has(node.type);
};

export const normalizePairConstraintNodeIds = (firstId: string, secondId: string): [string, string] =>
  firstId <= secondId ? [firstId, secondId] : [secondId, firstId];

export const buildPairConstraintId = (type: PairConstraintType, firstId: string, secondId: string) => {
  const [a, b] = normalizePairConstraintNodeIds(firstId, secondId);
  return `pair-${type}-${a}-${b}`;
};

export const buildPairConstraint = (
  type: PairConstraintType,
  firstId: string,
  secondId: string,
  strength: PairConstraint['strength'] = 'strong'
): PairConstraint => {
  const ordered = normalizePairConstraintNodeIds(firstId, secondId);
  return {
    id: buildPairConstraintId(type, ordered[0], ordered[1]),
    type,
    nodes: ordered,
    strength,
  };
};

export const validatePairConstraintNodes = (
  nodesById: Map<string, PairConstraintNode>,
  referenceNodeId: string,
  targetNodeId: string
): PairConstraintValidationResult => {
  if (!referenceNodeId || !targetNodeId) {
    return {
      ok: false,
      reason: 'missing-node',
      message: 'Select both a reference node and a target node.',
    };
  }

  if (referenceNodeId === targetNodeId) {
    return {
      ok: false,
      reason: 'same-node',
      message: 'Choose a different target node than the reference node.',
    };
  }

  const referenceNode = nodesById.get(referenceNodeId);
  const targetNode = nodesById.get(targetNodeId);
  if (!referenceNode || !targetNode) {
    return {
      ok: false,
      reason: 'missing-node',
      message: 'One or both nodes no longer exist. Reselect nodes and try again.',
    };
  }

  if (!canNodeParticipateInPairConstraint(referenceNode) || !canNodeParticipateInPairConstraint(targetNode)) {
    return {
      ok: false,
      reason: 'unsupported-node-type',
      message: 'Constraints can only be created on editable canvas nodes (not document/page).',
    };
  }

  if (!referenceNode.parentId || !targetNode.parentId || referenceNode.parentId !== targetNode.parentId) {
    return {
      ok: false,
      reason: 'different-parent',
      message: 'Constraints currently require both nodes to share the same parent.',
    };
  }

  return {
    ok: true,
    orderedNodeIds: normalizePairConstraintNodeIds(referenceNode.id, targetNode.id),
    referenceNode,
    targetNode,
  };
};

export const doesConstraintInvolveNode = (constraint: DesignerConstraint, nodeId: string): boolean => {
  if (constraint.type === 'aspect-ratio') {
    return constraint.nodeId === nodeId;
  }
  return constraint.nodes[0] === nodeId || constraint.nodes[1] === nodeId;
};

export const getPairConstraintCounterpartNodeId = (
  constraint: PairConstraint,
  nodeId: string
): string | null => {
  if (constraint.nodes[0] === nodeId) {
    return constraint.nodes[1];
  }
  if (constraint.nodes[1] === nodeId) {
    return constraint.nodes[0];
  }
  return null;
};

const sanitizePairConstraint = (
  nodesById: Map<string, PairConstraintNode>,
  constraint: PairConstraint
): PairConstraint | null => {
  const validation = validatePairConstraintNodes(nodesById, constraint.nodes[0], constraint.nodes[1]);
  if (!validation.ok) {
    return null;
  }
  return {
    id: buildPairConstraintId(constraint.type, validation.orderedNodeIds[0], validation.orderedNodeIds[1]),
    type: constraint.type,
    nodes: validation.orderedNodeIds,
    strength: 'strong',
  };
};

const sanitizeAspectConstraint = (
  nodesById: Map<string, PairConstraintNode>,
  constraint: Extract<DesignerConstraint, { type: 'aspect-ratio' }>
): Extract<DesignerConstraint, { type: 'aspect-ratio' }> | null => {
  const node = nodesById.get(constraint.nodeId);
  if (!node) {
    return null;
  }
  const ratio =
    Number.isFinite(constraint.ratio) && constraint.ratio > 0
      ? constraint.ratio
      : null;
  if (ratio === null) {
    return null;
  }
  return {
    id: `aspect-${constraint.nodeId}`,
    type: 'aspect-ratio',
    nodeId: constraint.nodeId,
    ratio,
    strength: constraint.strength ?? 'strong',
  };
};

export const sanitizeConstraints = (
  nodes: DesignerNode[],
  constraints: DesignerConstraint[]
): ConstraintSanitizationResult => {
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const));
  const seenConstraintIds = new Set<string>();
  const sanitized: DesignerConstraint[] = [];
  let removedInvalidCount = 0;
  let removedDuplicateCount = 0;

  constraints.forEach((constraint) => {
    const normalized =
      constraint.type === 'aspect-ratio'
        ? sanitizeAspectConstraint(nodesById, constraint)
        : sanitizePairConstraint(nodesById, constraint);

    if (!normalized) {
      removedInvalidCount += 1;
      return;
    }

    if (seenConstraintIds.has(normalized.id)) {
      removedDuplicateCount += 1;
      return;
    }

    seenConstraintIds.add(normalized.id);
    sanitized.push(normalized);
  });

  return {
    constraints: sanitized,
    removedInvalidCount,
    removedDuplicateCount,
  };
};
