import { canNestWithinParent } from '../schema/componentSchema';
import type { DesignerComponentType, DesignerNode } from '../state/designerStore';

/**
 * Where structural edits land, decided from the selection the way document
 * editors do it: a selected container receives new blocks, a selected leaf gets
 * them as its next sibling, and with nothing (or the page) selected they go to
 * the end of the page. Every placement is a (parent, index) pair in the
 * pre-removal coordinates `moveNode` expects.
 */
export type StructureTarget = { parentId: string; index: number };

/** For a selected container: put new blocks inside it, or after it as a sibling. */
export type InsertPlacement = 'inside' | 'after';

const isStructuralRoot = (node: DesignerNode): boolean => node.type === 'document' || node.type === 'page';

const findPage = (nodesById: Map<string, DesignerNode>): DesignerNode | null => {
  const pages = Array.from(nodesById.values()).filter((node) => node.type === 'page');
  const document = Array.from(nodesById.values()).find((node) => node.type === 'document');
  return pages.find((page) => page.parentId === document?.id) ?? pages[0] ?? null;
};

export const resolveInsertionTarget = (
  nodes: DesignerNode[],
  selectedNodeId: string | null,
  type: DesignerComponentType,
  placement: InsertPlacement = 'inside'
): StructureTarget | null => {
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const));
  const page = findPage(nodesById);
  const selected = selectedNodeId ? nodesById.get(selectedNodeId) ?? null : null;

  const appendToPage = (): StructureTarget | null =>
    page && canNestWithinParent(type, page.type) ? { parentId: page.id, index: page.children.length } : null;

  if (!selected || isStructuralRoot(selected)) {
    return appendToPage();
  }

  if (placement === 'inside' && selected.allowedChildren.length > 0 && canNestWithinParent(type, selected.type)) {
    return { parentId: selected.id, index: selected.children.length };
  }

  let child: DesignerNode = selected;
  let parent = selected.parentId ? nodesById.get(selected.parentId) ?? null : null;
  while (parent) {
    if (canNestWithinParent(type, parent.type)) {
      return { parentId: parent.id, index: parent.children.indexOf(child.id) + 1 };
    }
    child = parent;
    parent = parent.parentId ? nodesById.get(parent.parentId) ?? null : null;
  }
  return appendToPage();
};

/** One step earlier (-1) or later (+1) among the node's siblings. */
export const resolveReorderTarget = (
  nodes: DesignerNode[],
  nodeId: string,
  direction: -1 | 1
): StructureTarget | null => {
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const));
  const node = nodesById.get(nodeId);
  const parent = node?.parentId ? nodesById.get(node.parentId) : undefined;
  if (!node || !parent || isStructuralRoot(node)) {
    return null;
  }
  const index = parent.children.indexOf(node.id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= parent.children.length) {
    return null;
  }
  return { parentId: parent.id, index: direction === 1 ? index + 2 : nextIndex };
};

/** Out of the parent, landing right after it in the grandparent. */
export const resolveMoveOutTarget = (nodes: DesignerNode[], nodeId: string): StructureTarget | null => {
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const));
  const node = nodesById.get(nodeId);
  const parent = node?.parentId ? nodesById.get(node.parentId) : undefined;
  const grandparent = parent?.parentId ? nodesById.get(parent.parentId) : undefined;
  if (!node || !parent || !grandparent || isStructuralRoot(parent) || !canNestWithinParent(node.type, grandparent.type)) {
    return null;
  }
  return { parentId: grandparent.id, index: grandparent.children.indexOf(parent.id) + 1 };
};

/** Into the nearest earlier sibling that can hold it, as that sibling's last child. */
export const resolveMoveIntoTarget = (nodes: DesignerNode[], nodeId: string): StructureTarget | null => {
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const));
  const node = nodesById.get(nodeId);
  const parent = node?.parentId ? nodesById.get(node.parentId) : undefined;
  if (!node || !parent) {
    return null;
  }
  const index = parent.children.indexOf(node.id);
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const sibling = nodesById.get(parent.children[cursor]);
    if (sibling && sibling.allowedChildren.length > 0 && canNestWithinParent(node.type, sibling.type)) {
      return { parentId: sibling.id, index: sibling.children.length };
    }
  }
  return null;
};

export type DesignerClipboardNode = {
  id: string;
  type: DesignerComponentType;
  props: Record<string, unknown>;
  children: string[];
};

/** A detached copy of a subtree: authored props only, ids local to the payload. */
export type DesignerClipboardPayload = {
  rootId: string;
  nodes: DesignerClipboardNode[];
};

export const copySubtree = (nodes: DesignerNode[], rootId: string): DesignerClipboardPayload | null => {
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const));
  const root = nodesById.get(rootId);
  if (!root || isStructuralRoot(root)) {
    return null;
  }
  const collected: DesignerClipboardNode[] = [];
  const visit = (id: string) => {
    const node = nodesById.get(id);
    if (!node) return;
    collected.push({
      id: node.id,
      type: node.type,
      props: JSON.parse(JSON.stringify(node.props)) as Record<string, unknown>,
      children: node.children.filter((childId) => nodesById.has(childId)),
    });
    node.children.forEach(visit);
  };
  visit(rootId);
  return { rootId, nodes: collected };
};

/**
 * The visual style one block can hand to another ("copy style / paste style"):
 * colors, borders, spacing and typography, but not size or flex sizing, which
 * belong to where a block sits rather than how it looks.
 */
export const COPYABLE_STYLE_KEYS = [
  'margin',
  'padding',
  'border',
  'borderRadius',
  'color',
  'backgroundColor',
  'fontSize',
  'fontWeight',
  'fontFamily',
  'fontStyle',
  'lineHeight',
  'textAlign',
  'objectFit',
  'objectPosition',
] as const;

export type DesignerStyleClipboard = {
  style: Partial<Record<(typeof COPYABLE_STYLE_KEYS)[number], unknown>>;
  /** Present when copied from a container; only pasted onto containers. */
  layout?: Record<string, unknown>;
};

export const copyStyle = (node: DesignerNode): DesignerStyleClipboard => {
  const style = (node.props.style ?? {}) as Record<string, unknown>;
  const copied: DesignerStyleClipboard['style'] = {};
  COPYABLE_STYLE_KEYS.forEach((key) => {
    if (style[key] !== undefined) copied[key] = JSON.parse(JSON.stringify(style[key]));
  });
  const layout = node.props.layout;
  return {
    style: copied,
    ...(node.allowedChildren.length > 0 && layout && typeof layout === 'object'
      ? { layout: JSON.parse(JSON.stringify(layout)) as Record<string, unknown> }
      : {}),
  };
};

const toKebab = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

/** "Data Field 3" and friends: the generated names an author has not changed yet. */
export const isDefaultLayerName = (name: string, schemaLabel: string): boolean => {
  const trimmed = name.trim();
  if (trimmed === schemaLabel) return true;
  const suffix = trimmed.startsWith(`${schemaLabel} `) ? trimmed.slice(schemaLabel.length + 1) : '';
  return /^\d+$/.test(suffix);
};

/**
 * A readable layer name for what a block shows: a binding ("invoice.issueDate" ->
 * "issue-date", "invoice.number" -> "invoice-number"), a standard label key
 * ("labels.invoiceTitle" -> "invoice-title") or a lone token ("{{tenant.name}}" -> "tenant-name").
 */
export const suggestLayerName = (source: { bindingKey?: string; i18nKey?: string; text?: string }): string | null => {
  if (source.bindingKey) {
    const segments = source.bindingKey.split('.').filter(Boolean);
    const leaf = segments[segments.length - 1] ?? '';
    // A bare "number"/"name" says too little on its own; keep its parent.
    return toKebab(['number', 'name', 'address'].includes(leaf) ? segments.slice(-2).join('-') : leaf) || null;
  }
  if (source.i18nKey) {
    return toKebab(source.i18nKey.replace(/^labels\./, '')) || null;
  }
  const token = source.text?.trim().match(/^\{\{\s*([^{}]+?)\s*\}\}$/);
  return token ? toKebab(token[1]) || null : null;
};

const NAME_SEPARATOR = /[-_ ]/;

const commonPrefix = (values: string[]): string => {
  let prefix = values[0] ?? '';
  values.forEach((value) => {
    while (!value.startsWith(prefix)) prefix = prefix.slice(0, -1);
  });
  // Whole name parts only: "from-ca" from "from-card"/"from-cat" is not a shared prefix.
  const cut = Math.max(...[...prefix].map((char, index) => (NAME_SEPARATOR.test(char) ? index + 1 : 0)), 0);
  return prefix.slice(0, cut);
};

const commonSuffix = (values: string[]): string => {
  let suffix = values[0] ?? '';
  values.forEach((value) => {
    while (!value.endsWith(suffix)) suffix = suffix.slice(1);
  });
  const cut = [...suffix].findIndex((char) => NAME_SEPARATOR.test(char));
  return cut === -1 ? '' : suffix.slice(cut);
};

/**
 * Renaming a copied card ("from-card-2" -> "bill-to-card") usually means its inner
 * layers should follow ("from-label-2" -> "bill-to-label"). Works out that plan from
 * the prefix and suffix the root shares with its descendants; null when there is none.
 */
export const planSubtreeRename = (
  oldName: string,
  newName: string,
  descendantNames: string[]
): Array<{ from: string; to: string }> | null => {
  if (descendantNames.length === 0 || oldName === newName) return null;
  const names = [oldName, ...descendantNames];
  const prefix = commonPrefix(names);
  const suffix = commonSuffix(names);
  if (!prefix && !suffix) return null;
  const core = oldName.slice(prefix.length, oldName.length - suffix.length);
  if (!core || !newName.endsWith(core)) return null;
  const nextPrefix = newName.slice(0, newName.length - core.length);
  const plan = descendantNames
    .map((name) => ({ from: name, to: `${nextPrefix}${name.slice(prefix.length, name.length - suffix.length)}` }))
    .filter(({ from, to }) => from !== to);
  return plan.length > 0 ? plan : null;
};
