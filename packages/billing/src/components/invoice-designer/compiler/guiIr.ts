import type {
  DesignerConstraint,
  DesignerNode,
  DesignerWorkspaceSnapshot,
} from '../state/designerStore';

export type InvoiceDesignerIrVersion = 1;

export type InvoiceDesignerIrFlatNode = {
  id: string;
  type: DesignerNode['type'];
  name: string;
  parentId: string | null;
  childIds: string[];
  position: DesignerNode['position'];
  size: DesignerNode['size'];
  rotation: number;
  allowResize: boolean;
  layoutPresetId: string | null;
  layout: DesignerNode['layout'] | null;
  metadata: Record<string, unknown>;
};

export type InvoiceDesignerIrTreeNode = InvoiceDesignerIrFlatNode & {
  children: InvoiceDesignerIrTreeNode[];
};

export type InvoiceDesignerCompilerIr = {
  version: InvoiceDesignerIrVersion;
  rootNodeId: string;
  flatNodes: InvoiceDesignerIrFlatNode[];
  tree: InvoiceDesignerIrTreeNode;
  constraints: DesignerConstraint[];
};

const normalizeUnknown = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeUnknown(item));
  }

  if (value && typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    const normalizedObject: Record<string, unknown> = {};
    Object.keys(objectValue)
      .sort()
      .forEach((key) => {
        const normalized = normalizeUnknown(objectValue[key]);
        if (normalized !== undefined) {
          normalizedObject[key] = normalized;
        }
      });
    return normalizedObject;
  }

  if (typeof value === 'function' || typeof value === 'symbol') {
    return undefined;
  }

  return value;
};

const normalizeMetadata = (metadata: DesignerNode['metadata']): Record<string, unknown> => {
  if (!metadata || typeof metadata !== 'object') {
    return {};
  }

  return (normalizeUnknown(metadata) as Record<string, unknown>) ?? {};
};

const compareNodePosition = (a: DesignerNode, b: DesignerNode) =>
  a.position.y - b.position.y ||
  a.position.x - b.position.x ||
  a.type.localeCompare(b.type) ||
  a.id.localeCompare(b.id);

const normalizeConstraint = (constraint: DesignerConstraint): DesignerConstraint => {
  if (constraint.type === 'aspect-ratio') {
    return {
      ...constraint,
      nodeId: constraint.nodeId,
    };
  }

  const nodes = [...constraint.nodes].sort((left, right) => left.localeCompare(right)) as [string, string];
  return {
    ...constraint,
    nodes,
  };
};

const normalizeConstraints = (constraints: DesignerConstraint[]): DesignerConstraint[] =>
  constraints
    .map((constraint) => normalizeConstraint(constraint))
    .sort((left, right) => left.id.localeCompare(right.id) || left.type.localeCompare(right.type));

const resolveRootNode = (nodes: DesignerNode[]): DesignerNode | null => {
  if (nodes.length === 0) {
    return null;
  }

  const documentRoot = nodes.find((node) => node.type === 'document' && node.parentId === null);
  if (documentRoot) {
    return documentRoot;
  }

  const detachedRoot = nodes.find((node) => node.parentId === null);
  if (detachedRoot) {
    return detachedRoot;
  }

  return [...nodes].sort(compareNodePosition)[0];
};

const resolveChildIds = (node: DesignerNode, nodesById: Map<string, DesignerNode>): string[] => {
  const explicitChildIds = node.childIds.filter((childId) => nodesById.has(childId));
  const explicitChildSet = new Set(explicitChildIds);
  const inferredChildren = Array.from(nodesById.values())
    .filter((candidate) => candidate.parentId === node.id && !explicitChildSet.has(candidate.id))
    .sort(compareNodePosition)
    .map((candidate) => candidate.id);

  return [...explicitChildIds, ...inferredChildren];
};

const toFlatNode = (node: DesignerNode, childIds: string[]): InvoiceDesignerIrFlatNode => ({
  id: node.id,
  type: node.type,
  name: node.name,
  parentId: node.parentId,
  childIds,
  position: {
    x: node.position.x,
    y: node.position.y,
  },
  size: {
    width: node.size.width,
    height: node.size.height,
  },
  rotation: node.rotation ?? 0,
  allowResize: node.allowResize ?? true,
  layoutPresetId: node.layoutPresetId ?? null,
  layout: node.layout
    ? {
        ...node.layout,
      }
    : null,
  metadata: normalizeMetadata(node.metadata),
});

export const extractInvoiceDesignerIr = (
  workspace: DesignerWorkspaceSnapshot
): InvoiceDesignerCompilerIr => {
  const nodes = Array.isArray(workspace.nodes) ? workspace.nodes : [];
  const rootNode = resolveRootNode(nodes);
  if (!rootNode) {
    throw new Error('Cannot extract compiler IR from an empty workspace.');
  }

  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const visitedIds = new Set<string>();
  const flatNodes: InvoiceDesignerIrFlatNode[] = [];

  const buildTree = (nodeId: string): InvoiceDesignerIrTreeNode => {
    const sourceNode = nodesById.get(nodeId);
    if (!sourceNode) {
      throw new Error(`Cannot extract compiler IR: node "${nodeId}" was not found.`);
    }

    visitedIds.add(nodeId);
    const childIds = resolveChildIds(sourceNode, nodesById);
    const flatNode = toFlatNode(sourceNode, childIds);
    flatNodes.push(flatNode);

    return {
      ...flatNode,
      children: childIds.map((childId) => buildTree(childId)),
    };
  };

  const tree = buildTree(rootNode.id);

  // Keep disconnected nodes deterministic and reachable in flat output for diagnostics.
  const disconnected = nodes
    .filter((node) => !visitedIds.has(node.id))
    .sort(compareNodePosition)
    .map((node) => toFlatNode(node, resolveChildIds(node, nodesById)));
  flatNodes.push(...disconnected);

  return {
    version: 1,
    rootNodeId: rootNode.id,
    flatNodes,
    tree,
    constraints: normalizeConstraints(workspace.constraints ?? []),
  };
};
