export type DropZone = "left" | "right" | "top" | "bottom";

export type LeafContent =
  | { kind: "inline" }
  | { kind: "iframe"; href: string; title: string; reloadKey: number };

export type LeafNode = { id: string; type: "leaf"; content: LeafContent };

export type SplitNode = {
  id: string;
  type: "split";
  direction: "row" | "column";
  ratio: number;
  first: LayoutNode;
  second: LayoutNode;
};

export type LayoutNode = LeafNode | SplitNode;

