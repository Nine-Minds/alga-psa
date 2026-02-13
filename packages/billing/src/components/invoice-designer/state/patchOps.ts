import type { DesignerNode } from './designerStore';

const RESERVED_PATCH_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Patch path grammar: dot-separated, with non-negative integer segments indicating array indices.
const isIntegerKey = (key: string): boolean => key !== '' && /^[0-9]+$/.test(key);

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (!isPlainObject(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const isJsonSerializable = (value: unknown, seen: Set<object> = new Set()): boolean => {
  if (value === null) return true;

  const type = typeof value;
  if (type === 'string' || type === 'boolean') return true;
  if (type === 'number') return Number.isFinite(value);
  if (type === 'undefined' || type === 'function' || type === 'symbol' || type === 'bigint') return false;

  if (Array.isArray(value)) {
    if (seen.has(value)) return false;
    seen.add(value);
    for (let i = 0; i < value.length; i += 1) {
      // Avoid sparse arrays (JSON stringification will convert holes to null).
      if (!(i in value)) return false;
      if (!isJsonSerializable(value[i], seen)) return false;
    }
    seen.delete(value);
    return true;
  }

  if (!isPlainRecord(value)) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  for (const entry of Object.entries(value)) {
    if (!isJsonSerializable(entry[1], seen)) return false;
  }
  seen.delete(value);
  return true;
};

const getUnsafePatchPathSegment = (parts: string[]): string | null =>
  parts.find((part) => RESERVED_PATCH_PATH_SEGMENTS.has(part)) ?? null;

const warnRejectedPatch = (
  op: 'setNodeProp' | 'unsetNodeProp',
  nodeId: string,
  path: string,
  reason: string
) => {
  // This is developer-facing feedback only; state updates must remain safe no-ops.
  // Guard in case this runs in a non-Next browser context where `process` might be absent.
  const isProd = typeof process !== 'undefined' && process?.env?.NODE_ENV === 'production';
  if (isProd) return;
  // eslint-disable-next-line no-console
  console.warn(`[invoice-designer] ${op} rejected patch`, { nodeId, path, reason });
};

const setIn = (value: unknown, path: string[], nextLeafValue: unknown): unknown => {
  if (path.length === 0) return nextLeafValue;

  const [head, ...tail] = path;
  if (isIntegerKey(head)) {
    const index = Number.parseInt(head, 10);
    const base = Array.isArray(value) ? value : [];
    const next = base.slice();
    // Avoid sparse arrays in canonical JSON state; fill missing entries with `null`.
    while (next.length < index) {
      next.push(null);
    }
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
    if (tail.length === 0) {
      // Leaf array unset: remove the element (no `undefined` holes).
      if (index < 0 || index >= value.length) return value;
      const next = value.slice();
      next.splice(index, 1);
      return next;
    }

    const prevChild = value[index];
    const nextChild = unsetIn(prevChild, tail);
    if (nextChild === prevChild) return value;

    const next = value.slice();
    // Nested unsets should not splice the array element. If the element becomes empty, keep it as `{}`.
    next[index] = typeof nextChild === 'undefined' ? {} : nextChild;
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
  const unsafeSegment = getUnsafePatchPathSegment(parts);
  if (unsafeSegment) {
    warnRejectedPatch('setNodeProp', nodeId, path, `unsafe-path-segment:${unsafeSegment}`);
    return nodes;
  }
  // Canonical designer state must remain JSON-serializable (history snapshots rely on it).
  if (!isJsonSerializable(propValue)) {
    warnRejectedPatch('setNodeProp', nodeId, path, 'non-json-value');
    return nodes;
  }

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
  const unsafeSegment = getUnsafePatchPathSegment(parts);
  if (unsafeSegment) {
    warnRejectedPatch('unsetNodeProp', nodeId, path, `unsafe-path-segment:${unsafeSegment}`);
    return nodes;
  }

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

  if (parent.children.includes(childId)) return nodes;

  const nextNodes = nodes.map((node) => {
    if (node.id === parentId) {
      const nextChildren = node.children.slice();
      const clampedIndex = Math.max(0, Math.min(index, nextChildren.length));
      nextChildren.splice(clampedIndex, 0, childId);
      return { ...node, children: nextChildren };
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
  if (!parent.children.includes(childId)) return nodes;

  return nodes.map((node) => {
    if (node.id === parentId) {
      const nextChildren = node.children.filter((id) => id !== childId);
      return { ...node, children: nextChildren };
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
    (node?.children ?? []).forEach(dfs);
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
  const prevIndex = prevParent ? prevParent.children.indexOf(nodeId) : -1;
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
