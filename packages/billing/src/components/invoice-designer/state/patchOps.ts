import type { DesignerNode } from './designerStore';

const RESERVED_PATCH_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isIntegerKey = (key: string): boolean => key !== '' && String(Number.parseInt(key, 10)) === key;

const isSafePatchPath = (parts: string[]): boolean => !parts.some((part) => RESERVED_PATCH_PATH_SEGMENTS.has(part));

const setIn = (value: unknown, path: string[], nextLeafValue: unknown): unknown => {
  if (path.length === 0) return nextLeafValue;

  const [head, ...tail] = path;
  if (isIntegerKey(head)) {
    const index = Number.parseInt(head, 10);
    const base = Array.isArray(value) ? value : [];
    const next = base.slice();
    next[index] = setIn(base[index], tail, nextLeafValue);
    return next;
  }

  const base = isPlainObject(value) ? value : {};
  return { ...base, [head]: setIn(base[head], tail, nextLeafValue) };
};

const unsetIn = (value: unknown, path: string[]): unknown => {
  if (path.length === 0) return value;

  const [head, ...tail] = path;
  if (isIntegerKey(head)) {
    const index = Number.parseInt(head, 10);
    if (!Array.isArray(value)) return value;
    const next = value.slice();
    if (tail.length === 0) {
      // For arrays we treat "unset" as clearing the slot.
      next[index] = undefined;
      return next;
    }
    next[index] = unsetIn(next[index], tail);
    return next;
  }

  if (!isPlainObject(value)) return value;
  if (!(head in value)) return value;

  if (tail.length === 0) {
    const { [head]: _removed, ...rest } = value;
    return Object.keys(rest).length === 0 ? undefined : rest;
  }

  const nextChild = unsetIn(value[head], tail);
  if (nextChild === value[head]) return value;

  if (typeof nextChild === 'undefined') {
    const { [head]: _removed, ...rest } = value;
    return Object.keys(rest).length === 0 ? undefined : rest;
  }

  return { ...value, [head]: nextChild };
};

const splitDotPath = (path: string): string[] => path.split('.').map((segment) => segment.trim()).filter(Boolean);

export const setNodeProp = (nodes: DesignerNode[], nodeId: string, path: string, propValue: unknown): DesignerNode[] => {
  const parts = splitDotPath(path);
  if (parts.length === 0) return nodes;
  // Safe no-op: do not attempt any updates for paths that could cause prototype pollution.
  if (!isSafePatchPath(parts)) return nodes;

  const index = nodes.findIndex((node) => node.id === nodeId);
  if (index === -1) return nodes;

  const node = nodes[index];
  const nextNode = setIn(node, parts, propValue) as DesignerNode;
  if (nextNode === node) return nodes;

  const nextNodes = nodes.slice();
  nextNodes[index] = nextNode;
  return nextNodes;
};

export const unsetNodeProp = (nodes: DesignerNode[], nodeId: string, path: string): DesignerNode[] => {
  const parts = splitDotPath(path);
  if (parts.length === 0) return nodes;
  // Safe no-op: do not attempt any updates for paths that could cause prototype pollution.
  if (!isSafePatchPath(parts)) return nodes;

  const index = nodes.findIndex((node) => node.id === nodeId);
  if (index === -1) return nodes;

  const node = nodes[index];
  const nextNode = unsetIn(node, parts);
  if (nextNode === node || typeof nextNode === 'undefined') return nodes;

  const nextNodes = nodes.slice();
  nextNodes[index] = nextNode as DesignerNode;
  return nextNodes;
};

export const insertChild = (
  nodes: DesignerNode[],
  parentId: string,
  childId: string,
  index: number
): DesignerNode[] => {
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const));
  const parent = nodesById.get(parentId);
  const child = nodesById.get(childId);
  if (!parent || !child) return nodes;

  if (parent.childIds.includes(childId)) return nodes;

  const nextNodes = nodes.map((node) => {
    if (node.id === parentId) {
      const nextChildIds = node.childIds.slice();
      const clampedIndex = Math.max(0, Math.min(index, nextChildIds.length));
      nextChildIds.splice(clampedIndex, 0, childId);
      return { ...node, childIds: nextChildIds, children: nextChildIds };
    }
    if (node.id === childId) {
      return { ...node, parentId };
    }
    return node;
  });

  return nextNodes;
};

export const removeChild = (nodes: DesignerNode[], parentId: string, childId: string): DesignerNode[] => {
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const));
  const parent = nodesById.get(parentId);
  const child = nodesById.get(childId);
  if (!parent || !child) return nodes;
  if (!parent.childIds.includes(childId)) return nodes;

  return nodes.map((node) => {
    if (node.id === parentId) {
      const nextChildIds = node.childIds.filter((id) => id !== childId);
      return { ...node, childIds: nextChildIds, children: nextChildIds };
    }
    if (node.id === childId && node.parentId === parentId) {
      return { ...node, parentId: null };
    }
    return node;
  });
};

const collectDescendants = (nodesById: Map<string, DesignerNode>, rootId: string): Set<string> => {
  const visited = new Set<string>();
  const dfs = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const node = nodesById.get(id);
    (node?.children ?? node?.childIds ?? []).forEach(dfs);
  };
  dfs(rootId);
  return visited;
};

export const moveNode = (
  nodes: DesignerNode[],
  nodeId: string,
  nextParentId: string,
  nextIndex: number
): DesignerNode[] => {
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const));
  const node = nodesById.get(nodeId);
  const nextParent = nodesById.get(nextParentId);
  if (!node || !nextParent) return nodes;

  // Prevent cycles.
  if (collectDescendants(nodesById, nodeId).has(nextParentId)) return nodes;

  const prevParentId = node.parentId;
  const prevParent = prevParentId ? nodesById.get(prevParentId) ?? null : null;
  const prevIndex = prevParent ? prevParent.childIds.indexOf(nodeId) : -1;
  const adjustedIndex =
    prevParentId === nextParentId && prevIndex !== -1 && prevIndex < nextIndex ? Math.max(0, nextIndex - 1) : nextIndex;

  let nextNodes = nodes;
  if (prevParentId) {
    nextNodes = removeChild(nextNodes, prevParentId, nodeId);
  }
  nextNodes = insertChild(nextNodes, nextParentId, nodeId, adjustedIndex);
  return nextNodes;
};

export const deleteNode = (nodes: DesignerNode[], nodeId: string): DesignerNode[] => {
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const));
  const root = nodesById.get(nodeId);
  if (!root) return nodes;

  // Remove id from parent child list (if any).
  const parentId = root.parentId;
  let nextNodes = nodes;
  if (parentId) {
    nextNodes = removeChild(nextNodes, parentId, nodeId);
  }

  const nextNodesById = new Map(nextNodes.map((node) => [node.id, node] as const));
  const toRemove = collectDescendants(nextNodesById, nodeId);
  return nextNodes.filter((node) => !toRemove.has(node.id));
};
