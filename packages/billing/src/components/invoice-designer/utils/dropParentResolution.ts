import type { DesignerComponentType, DesignerNode, Size } from '../state/designerStore';
import { canNestWithinParent } from '../state/hierarchy';

const HEADER_NAME_PATTERN = /\b(header|masthead|top)\b/i;
const HEADER_SCORE_PENALTY = 180;
const MIN_SECTION_INSERT_SPACE = 56;
const MIN_SECTION_INNER_WIDTH = 72;
const MIN_SECTION_INNER_HEIGHT = 48;
const SEMANTIC_MATCH_BONUS = 320;
const MAX_LOCAL_REFLOW_PIXELS = 240;
const MAX_LOCAL_REFLOW_NODES = 3;

const TABLE_SECTION_PATTERN = /\b(item|items|line item|line items|details|services)\b/i;
const TOTALS_SECTION_PATTERN = /\b(total|totals|summary|payment)\b/i;
const SIGNATURE_SECTION_PATTERN = /\b(footer|approval|signature)\b/i;
const INFO_SECTION_PATTERN = /\b(billing|info|details|meta)\b/i;

const isTableLike = (type: DesignerComponentType) => type === 'table' || type === 'dynamic-table';
const isTotalsLike = (type: DesignerComponentType) =>
  type === 'totals' || type === 'subtotal' || type === 'tax' || type === 'discount' || type === 'custom-total';
const isSignatureLike = (type: DesignerComponentType) => type === 'signature' || type === 'action-button';
const isInfoLike = (type: DesignerComponentType) => type === 'field' || type === 'label' || type === 'text';

const getPracticalMinimumSizeForType = (type: DesignerComponentType): Size => {
  switch (type) {
    case 'signature':
      return { width: 180, height: 96 };
    case 'action-button':
      return { width: 140, height: 40 };
    case 'attachment-list':
      return { width: 180, height: 96 };
    default:
      return { width: MIN_SECTION_INNER_WIDTH, height: MIN_SECTION_INNER_HEIGHT };
  }
};

const getReflowMinimumWidthForNode = (node: DesignerNode): number => {
  switch (node.type) {
    case 'signature':
      return 180;
    case 'action-button':
      return 140;
    case 'attachment-list':
      return 180;
    case 'table':
    case 'dynamic-table':
      return 260;
    case 'totals':
    case 'subtotal':
    case 'tax':
    case 'discount':
    case 'custom-total':
      return 180;
    case 'section':
    case 'column':
    case 'container':
      return 120;
    default:
      return 100;
  }
};

const getSemanticPatternForType = (type: DesignerComponentType): RegExp | null => {
  if (isTableLike(type)) return TABLE_SECTION_PATTERN;
  if (isTotalsLike(type)) return TOTALS_SECTION_PATTERN;
  if (isSignatureLike(type)) return SIGNATURE_SECTION_PATTERN;
  if (isInfoLike(type)) return INFO_SECTION_PATTERN;
  return null;
};

const getSemanticScore = (type: DesignerComponentType, sectionName: string) => {
  const semanticPattern = getSemanticPatternForType(type);
  if (!semanticPattern) {
    return 0;
  }
  return semanticPattern.test(sectionName) ? SEMANTIC_MATCH_BONUS : 0;
};

const getSectionChildNodes = (section: DesignerNode, nodesById: Map<string, DesignerNode>): DesignerNode[] =>
  section.childIds.map((childId) => nodesById.get(childId)).filter((node): node is DesignerNode => Boolean(node));

const getSectionInnerSize = (section: DesignerNode) => {
  const padding = section.layout?.mode === 'flex' ? Math.max(0, section.layout.padding ?? 0) : 0;
  return {
    width: Math.max(0, section.size.width - padding * 2),
    height: Math.max(0, section.size.height - padding * 2),
    padding,
  };
};

const getNodeInnerSize = (node: DesignerNode) => {
  const padding = node.layout?.mode === 'flex' ? Math.max(0, node.layout.padding ?? 0) : 0;
  return {
    width: Math.max(0, node.size.width - padding * 2),
    height: Math.max(0, node.size.height - padding * 2),
  };
};

const getFlowAvailableMainSpace = (section: DesignerNode, nodesById: Map<string, DesignerNode>) => {
  const layout = section.layout;
  if (layout?.mode !== 'flex') {
    return Number.POSITIVE_INFINITY;
  }
  const children = getSectionChildNodes(section, nodesById);
  const direction = layout.direction ?? 'column';
  const gap = Math.max(0, layout.gap ?? 0);
  const { width: innerWidth, height: innerHeight } = getSectionInnerSize(section);
  const usedMainSpace = children.reduce((total, child) => {
    return total + (direction === 'row' ? child.size.width : child.size.height);
  }, 0);
  const usedGap = children.length > 1 ? gap * (children.length - 1) : 0;
  const totalUsed = usedMainSpace + usedGap;
  const totalAvailable = direction === 'row' ? innerWidth : innerHeight;
  return Math.max(0, totalAvailable - totalUsed);
};

const canParentFitComponent = (
  parent: DesignerNode,
  componentType: DesignerComponentType,
  nodesById: Map<string, DesignerNode>,
  desiredSize?: Size
) => {
  const layout = parent.layout;
  const { width: innerWidth, height: innerHeight } = getNodeInnerSize(parent);
  const practicalMinimum = getPracticalMinimumSizeForType(componentType);
  const minInnerWidth = Math.max(MIN_SECTION_INNER_WIDTH, practicalMinimum.width);
  const minInnerHeight = Math.max(MIN_SECTION_INNER_HEIGHT, practicalMinimum.height);

  if (innerWidth < minInnerWidth || innerHeight < minInnerHeight) {
    return false;
  }

  if (layout?.mode === 'flex') {
    const direction = layout.direction ?? 'column';
    const availableMainSpace = getFlowAvailableMainSpace(parent, nodesById);
    const requiresStrictRowFit = direction === 'row' && (layout.sizing !== 'hug' || isSignatureLike(componentType));
    if (requiresStrictRowFit) {
      const desiredMain = desiredSize?.width;
      const minMainRequired = Math.max(practicalMinimum.width, desiredMain ? Math.min(desiredMain, 200) : 0);
      return availableMainSpace >= minMainRequired;
    }

    if (direction === 'column' && layout.sizing === 'fixed') {
      const desiredMain = desiredSize?.height;
      const minMainRequired = Math.max(
        practicalMinimum.height,
        desiredMain ? Math.min(desiredMain, 120) : MIN_SECTION_INSERT_SPACE
      );
      return availableMainSpace >= minMainRequired;
    }
  }

  return true;
};

const canSectionFitComponent = (
  section: DesignerNode,
  componentType: DesignerComponentType,
  nodesById: Map<string, DesignerNode>,
  desiredSize?: Size
) => canParentFitComponent(section, componentType, nodesById, desiredSize);

const findBestDescendantParentInSection = (
  preferredSection: DesignerNode,
  componentType: DesignerComponentType,
  nodesById: Map<string, DesignerNode>,
  desiredSize?: Size
): DesignerNode | null => {
  const queue: Array<{ id: string; depth: number }> = preferredSection.childIds.map((id) => ({ id, depth: 1 }));
  const candidates: Array<{ node: DesignerNode; depth: number; childCount: number }> = [];

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) {
      continue;
    }
    const node = nodesById.get(next.id);
    if (!node) {
      continue;
    }

    if (
      canNestWithinParent(componentType, node.type) &&
      canParentFitComponent(node, componentType, nodesById, desiredSize)
    ) {
      candidates.push({
        node,
        depth: next.depth,
        childCount: node.childIds.length,
      });
    }

    node.childIds.forEach((childId) => {
      queue.push({ id: childId, depth: next.depth + 1 });
    });
  }

  candidates.sort((a, b) => {
    if (a.depth !== b.depth) {
      return a.depth - b.depth;
    }
    return b.childCount - a.childCount;
  });

  return candidates[0]?.node ?? null;
};

const estimateSectionVerticalSpace = (section: DesignerNode, nodesById: Map<string, DesignerNode>) => {
  const children = getSectionChildNodes(section, nodesById);
  const layout = section.layout;

  if (layout?.mode === 'flex' && layout.direction === 'column') {
    const gap = Math.max(0, layout.gap ?? 0);
    const padding = Math.max(0, layout.padding ?? 0);
    const childrenHeight = children.reduce((total, child) => total + Math.max(0, child.size.height), 0);
    const gapHeight = children.length > 1 ? gap * (children.length - 1) : 0;
    const consumedHeight = padding * 2 + childrenHeight + gapHeight;
    return Math.max(0, section.size.height - consumedHeight);
  }

  const padding = layout?.mode === 'flex' ? Math.max(0, layout.padding ?? 0) : 0;
  const furthestBottom = children.reduce((max, child) => {
    const bottom = Math.max(0, child.position.y + child.size.height);
    return bottom > max ? bottom : max;
  }, 0);
  const consumedHeight = furthestBottom + padding;
  return Math.max(0, section.size.height - consumedHeight);
};

const isFixedColumnFlowSaturated = (section: DesignerNode, availableVerticalSpace: number) => {
  const layout = section.layout;
  return (
    layout?.mode === 'flex' &&
    layout.direction === 'column' &&
    layout.sizing === 'fixed' &&
    availableVerticalSpace < MIN_SECTION_INSERT_SPACE
  );
};

type RankedSection = {
  node: DesignerNode;
  index: number;
  availableVerticalSpace: number;
  saturated: boolean;
  score: number;
};

export const chooseBestSectionForInsertion = (
  pageNode: DesignerNode,
  nodesById: Map<string, DesignerNode>,
  componentType: DesignerComponentType,
  desiredSize?: Size
): DesignerNode | null => {
  const rankedSections = pageNode.childIds
    .map((childId, index) => ({ node: nodesById.get(childId), index }))
    .filter((entry): entry is { node: DesignerNode; index: number } => {
      if (!entry.node || entry.node.type !== 'section') {
        return false;
      }
      return canSectionFitComponent(entry.node, componentType, nodesById, desiredSize);
    })
    .map<RankedSection>(({ node, index }) => {
      const availableVerticalSpace = estimateSectionVerticalSpace(node, nodesById);
      const semanticScore = getSemanticScore(componentType, node.name);
      const headerPenalty = HEADER_NAME_PATTERN.test(node.name) ? HEADER_SCORE_PENALTY : 0;
      const score = availableVerticalSpace + semanticScore - headerPenalty;
      return {
        node,
        index,
        availableVerticalSpace,
        saturated: isFixedColumnFlowSaturated(node, availableVerticalSpace),
        score,
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.index - b.index;
    });

  const bestUsable = rankedSections.find((candidate) => !candidate.saturated);
  return bestUsable?.node ?? null;
};

type ResolveSectionInsertionParams = {
  pageNode: DesignerNode;
  nodesById: Map<string, DesignerNode>;
  componentType: DesignerComponentType;
  desiredSize?: Size;
  preferredSectionId?: string | null;
};

export const resolveSectionParentForInsertion = ({
  pageNode,
  nodesById,
  componentType,
  desiredSize,
  preferredSectionId,
}: ResolveSectionInsertionParams): DesignerNode | null => {
  if (preferredSectionId) {
    const preferred = nodesById.get(preferredSectionId);
    if (
      preferred &&
      preferred.type === 'section' &&
      preferred.parentId === pageNode.id &&
      canSectionFitComponent(preferred, componentType, nodesById, desiredSize)
    ) {
      return preferred;
    }
    if (preferred && preferred.type === 'section' && preferred.parentId === pageNode.id) {
      const descendantParent = findBestDescendantParentInSection(preferred, componentType, nodesById, desiredSize);
      if (descendantParent) {
        return descendantParent;
      }
    }
  }

  return chooseBestSectionForInsertion(pageNode, nodesById, componentType, desiredSize);
};

type ResolvePreferredParentFromSelectionParams = {
  selectedNodeId?: string | null;
  pageNode: DesignerNode;
  nodesById: Map<string, DesignerNode>;
  componentType: DesignerComponentType;
  desiredSize?: Size;
};

export const resolvePreferredParentFromSelection = ({
  selectedNodeId,
  pageNode,
  nodesById,
  componentType,
  desiredSize,
}: ResolvePreferredParentFromSelectionParams): DesignerNode | null => {
  if (!selectedNodeId) {
    return null;
  }

  let current = nodesById.get(selectedNodeId) ?? null;
  while (current) {
    if (canNestWithinParent(componentType, current.type) && canParentFitComponent(current, componentType, nodesById, desiredSize)) {
      return current;
    }

    if (current.type === 'section' && current.parentId === pageNode.id) {
      const descendantParent = findBestDescendantParentInSection(current, componentType, nodesById, desiredSize);
      if (descendantParent) {
        return descendantParent;
      }
    }

    current = current.parentId ? nodesById.get(current.parentId) ?? null : null;
  }

  return null;
};

export const findNearestSectionAncestor = (
  startNodeId: string | null | undefined,
  nodesById: Map<string, DesignerNode>
): string | null => {
  if (!startNodeId) {
    return null;
  }
  let current = nodesById.get(startNodeId) ?? null;
  while (current) {
    if (current.type === 'section') {
      return current.id;
    }
    current = current.parentId ? nodesById.get(current.parentId) ?? null : null;
  }
  return null;
};

const isDescendantOf = (nodeId: string, ancestorId: string, nodesById: Map<string, DesignerNode>) => {
  let current = nodesById.get(nodeId) ?? null;
  while (current) {
    if (current.id === ancestorId) {
      return true;
    }
    current = current.parentId ? nodesById.get(current.parentId) ?? null : null;
  }
  return false;
};

const findNearestCompatibleSelectedAncestor = (
  selectedNodeId: string,
  selectedSectionId: string,
  componentType: DesignerComponentType,
  nodesById: Map<string, DesignerNode>
): DesignerNode | null => {
  let current = nodesById.get(selectedNodeId) ?? null;
  while (current) {
    if (!isDescendantOf(current.id, selectedSectionId, nodesById)) {
      break;
    }
    if (canNestWithinParent(componentType, current.type)) {
      return current;
    }
    current = current.parentId ? nodesById.get(current.parentId) ?? null : null;
  }
  return null;
};

export type LocalReflowAdjustment = {
  nodeId: string;
  width: number;
};

const planRowLocalReflow = (
  parent: DesignerNode,
  nodesById: Map<string, DesignerNode>,
  requiredWidth: number,
  preserveNodeId?: string
): LocalReflowAdjustment[] | null => {
  if (parent.layout?.mode !== 'flex' || (parent.layout.direction ?? 'column') !== 'row') {
    return null;
  }

  const children = getSectionChildNodes(parent, nodesById);
  const gap = Math.max(0, parent.layout.gap ?? 0);
  const { width: innerWidth } = getNodeInnerSize(parent);
  const currentUsed = children.reduce((sum, child) => sum + child.size.width, 0) + (children.length > 1 ? gap * (children.length - 1) : 0);
  const additionalGap = children.length > 0 ? gap : 0;
  const deficit = Math.max(0, currentUsed + requiredWidth + additionalGap - innerWidth);
  if (deficit <= 0) {
    return [];
  }
  if (deficit > MAX_LOCAL_REFLOW_PIXELS) {
    return null;
  }

  const candidates = children
    .filter((child) => child.id !== preserveNodeId)
    .map((child) => {
      const minWidth = getReflowMinimumWidthForNode(child);
      return {
        nodeId: child.id,
        currentWidth: child.size.width,
        shrinkable: Math.max(0, child.size.width - minWidth),
      };
    })
    .filter((candidate) => candidate.shrinkable > 0)
    .sort((a, b) => b.shrinkable - a.shrinkable)
    .slice(0, MAX_LOCAL_REFLOW_NODES);

  let remaining = deficit;
  const adjustments: LocalReflowAdjustment[] = [];
  for (const candidate of candidates) {
    if (remaining <= 0) {
      break;
    }
    const shrinkBy = Math.min(remaining, candidate.shrinkable);
    if (shrinkBy <= 0) {
      continue;
    }
    adjustments.push({
      nodeId: candidate.nodeId,
      width: candidate.currentWidth - shrinkBy,
    });
    remaining -= shrinkBy;
  }

  return remaining <= 0 ? adjustments : null;
};

type ForceSelectedInsertionParams = {
  selectedNodeId: string | null;
  pageNode: DesignerNode;
  nodesById: Map<string, DesignerNode>;
  componentType: DesignerComponentType;
  desiredSize?: Size;
};

type ForceSelectedInsertionPlan =
  | { ok: true; parentId: string; reflowAdjustments: LocalReflowAdjustment[] }
  | { ok: false; message: string };

export const planForceSelectedInsertion = ({
  selectedNodeId,
  pageNode,
  nodesById,
  componentType,
  desiredSize,
}: ForceSelectedInsertionParams): ForceSelectedInsertionPlan | null => {
  const selectedSectionId = findNearestSectionAncestor(selectedNodeId, nodesById);
  if (!selectedSectionId) {
    return null;
  }
  const selectedSection = nodesById.get(selectedSectionId);
  if (!selectedSection || selectedSection.type !== 'section' || selectedSection.parentId !== pageNode.id) {
    return {
      ok: false,
      message: 'Selected section is unavailable. Re-select a section and try again.',
    };
  }

  const requiredWidth = Math.max(getPracticalMinimumSizeForType(componentType).width, desiredSize?.width ?? 0);
  const candidateParents: DesignerNode[] = [];

  if (selectedNodeId) {
    const nearestCompatible = findNearestCompatibleSelectedAncestor(selectedNodeId, selectedSection.id, componentType, nodesById);
    if (nearestCompatible) {
      candidateParents.push(nearestCompatible);
    }
  }
  if (canNestWithinParent(componentType, selectedSection.type)) {
    candidateParents.push(selectedSection);
  }

  for (const candidate of candidateParents) {
    if (canParentFitComponent(candidate, componentType, nodesById, desiredSize)) {
      return { ok: true, parentId: candidate.id, reflowAdjustments: [] };
    }
    const adjustments = planRowLocalReflow(candidate, nodesById, requiredWidth, selectedNodeId ?? undefined);
    if (adjustments) {
      return { ok: true, parentId: candidate.id, reflowAdjustments: adjustments };
    }
  }

  return {
    ok: false,
    message: 'No room in the selected section. Resize or clear space, then try again.',
  };
};
