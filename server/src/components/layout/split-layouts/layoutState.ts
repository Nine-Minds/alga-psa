import type { DropZone, LayoutNode, LeafContent, LeafNode, SplitNode } from "./types";

const STORAGE_KEY_LAYOUT = "alga.splitLayouts.layout.v1";
const STORAGE_KEY_LAYOUT_MODE = "alga.splitLayouts.layoutMode.v1";
const STORAGE_KEY_ENABLED = "alga.splitLayouts.enabled.v1";

export const splitLayoutsStorage = {
  keys: {
    layout: STORAGE_KEY_LAYOUT,
    layoutMode: STORAGE_KEY_LAYOUT_MODE,
    enabled: STORAGE_KEY_ENABLED,
  },
};

function makeId(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
}

export function makeDefaultLayout(): LayoutNode {
  return { id: "leaf_inline", type: "leaf", content: { kind: "inline" } };
}

function mapLayout(node: LayoutNode, fn: (n: LayoutNode) => LayoutNode): LayoutNode {
  const mapped = fn(node);
  if (mapped.type === "split") {
    return {
      ...mapped,
      first: mapLayout(mapped.first, fn),
      second: mapLayout(mapped.second, fn),
    };
  }
  return mapped;
}

function findLeaf(node: LayoutNode, leafId: string): LeafNode | null {
  if (node.type === "leaf") {
    return node.id === leafId ? node : null;
  }
  return findLeaf(node.first, leafId) ?? findLeaf(node.second, leafId);
}

function replaceLeaf(node: LayoutNode, leafId: string, replacement: LayoutNode): LayoutNode {
  if (node.type === "leaf") {
    return node.id === leafId ? replacement : node;
  }
  return {
    ...node,
    first: replaceLeaf(node.first, leafId, replacement),
    second: replaceLeaf(node.second, leafId, replacement),
  };
}

export function splitLeaf(
  layout: LayoutNode,
  leafId: string,
  zone: DropZone,
  newContent: LeafContent,
): LayoutNode {
  const existingLeaf = findLeaf(layout, leafId);
  if (!existingLeaf) {
    return layout;
  }

  const direction: SplitNode["direction"] = zone === "left" || zone === "right" ? "row" : "column";
  const newLeaf: LeafNode = { id: makeId("leaf"), type: "leaf", content: newContent };
  const splitNode: SplitNode = {
    id: makeId("split"),
    type: "split",
    direction,
    ratio: 0.5,
    first: zone === "left" || zone === "top" ? newLeaf : existingLeaf,
    second: zone === "left" || zone === "top" ? existingLeaf : newLeaf,
  };

  return replaceLeaf(layout, leafId, splitNode);
}

export function swapLeafContents(layout: LayoutNode, aId: string, bId: string): LayoutNode {
  if (aId === bId) {
    return layout;
  }

  const a = findLeaf(layout, aId);
  const b = findLeaf(layout, bId);
  if (!a || !b) {
    return layout;
  }

  const aContent = a.content;
  const bContent = b.content;

  return mapLayout(layout, (node) => {
    if (node.type !== "leaf") {
      return node;
    }
    if (node.id === aId) {
      return { ...node, content: bContent };
    }
    if (node.id === bId) {
      return { ...node, content: aContent };
    }
    return node;
  });
}

export function removeLeaf(layout: LayoutNode, leafId: string): LayoutNode {
  // Don’t allow removing the inline leaf in this prototype.
  const leaf = findLeaf(layout, leafId);
  if (!leaf || leaf.content.kind === "inline") {
    return layout;
  }

  function walk(node: LayoutNode): LayoutNode | null {
    if (node.type === "leaf") {
      return node.id === leafId ? null : node;
    }

    const first = walk(node.first);
    const second = walk(node.second);

    if (!first && !second) {
      return null;
    }
    if (!first) {
      return second;
    }
    if (!second) {
      return first;
    }

    return { ...node, first, second };
  }

  return walk(layout) ?? makeDefaultLayout();
}

export function loadLayoutFromStorage(): LayoutNode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LAYOUT);
    if (!raw) {
      return makeDefaultLayout();
    }
    const parsed = JSON.parse(raw) as LayoutNode;
    // Ensure there is always exactly one inline leaf; if none, reset.
    let inlineCount = 0;
    const validated = mapLayout(parsed, (node) => {
      if (node.type === "leaf" && node.content.kind === "inline") {
        inlineCount += 1;
      }
      return node;
    });
    if (inlineCount !== 1) {
      return makeDefaultLayout();
    }
    return validated;
  } catch {
    return makeDefaultLayout();
  }
}

export function saveLayoutToStorage(layout: LayoutNode) {
  localStorage.setItem(STORAGE_KEY_LAYOUT, JSON.stringify(layout));
}

export function loadLayoutModeFromStorage(): boolean {
  return localStorage.getItem(STORAGE_KEY_LAYOUT_MODE) === "1";
}

export function saveLayoutModeToStorage(layoutMode: boolean) {
  localStorage.setItem(STORAGE_KEY_LAYOUT_MODE, layoutMode ? "1" : "0");
}

export function loadEnabledFromStorage(): boolean {
  return localStorage.getItem(STORAGE_KEY_ENABLED) === "1";
}

export function saveEnabledToStorage(enabled: boolean) {
  localStorage.setItem(STORAGE_KEY_ENABLED, enabled ? "1" : "0");
}

