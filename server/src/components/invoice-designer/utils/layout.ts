import type { DesignerNode, Point, Size } from '../state/designerStore';
import { DESIGNER_CANVAS_BOUNDS } from '../constants/layout';

export interface AlignmentGuide {
  type: 'vertical' | 'horizontal';
  position: number;
  description: string;
}

export interface ParentBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const ALIGN_THRESHOLD = 6;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export const calculateGuides = (activeNode: DesignerNode, nodes: DesignerNode[]): AlignmentGuide[] => {
  const guides: AlignmentGuide[] = [];
  nodes.forEach((node) => {
    if (node.id === activeNode.id) return;
    if (node.type === 'document' || node.type === 'page') return;
    if (activeNode.type === 'document' || activeNode.type === 'page') return;

    const nodeEdges = getEdges(node);
    const activeEdges = getEdges(activeNode);

    const verticalDiffs: Array<{ value: number; description: string }> = [
      { value: Math.abs(nodeEdges.left - activeEdges.left), description: 'Left edges aligned' },
      { value: Math.abs(nodeEdges.right - activeEdges.right), description: 'Right edges aligned' },
      { value: Math.abs(nodeEdges.centerX - activeEdges.centerX), description: 'Centers aligned' },
    ];

    verticalDiffs.forEach(({ value, description }, index) => {
      if (value <= ALIGN_THRESHOLD) {
        const position = index === 0 ? nodeEdges.left : index === 1 ? nodeEdges.right : nodeEdges.centerX;
        guides.push({ type: 'vertical', position, description });
      }
    });

    const horizontalDiffs: Array<{ value: number; description: string }> = [
      { value: Math.abs(nodeEdges.top - activeEdges.top), description: 'Top edges aligned' },
      { value: Math.abs(nodeEdges.bottom - activeEdges.bottom), description: 'Bottom edges aligned' },
      { value: Math.abs(nodeEdges.centerY - activeEdges.centerY), description: 'Middle lines aligned' },
    ];

    horizontalDiffs.forEach(({ value, description }, index) => {
      if (value <= ALIGN_THRESHOLD) {
        const position = index === 0 ? nodeEdges.top : index === 1 ? nodeEdges.bottom : nodeEdges.centerY;
        guides.push({ type: 'horizontal', position, description });
      }
    });
  });

  return guides;
};

export const getEdges = (node: DesignerNode) => {
  const { position, size } = node;
  return {
    left: position.x,
    right: position.x + size.width,
    centerX: position.x + size.width / 2,
    top: position.y,
    bottom: position.y + size.height,
    centerY: position.y + size.height / 2,
  };
};

export const clampPosition = (position: Point, canvasSize: Size): Point => ({
  x: Math.max(0, Math.min(position.x, canvasSize.width - 10)),
  y: Math.max(0, Math.min(position.y, canvasSize.height - 10)),
});

export const getParentBounds = (node: DesignerNode, nodes: DesignerNode[]): ParentBounds => {
  if (!node.parentId) {
    return {
      x: 0,
      y: 0,
      width: DESIGNER_CANVAS_BOUNDS.width,
      height: DESIGNER_CANVAS_BOUNDS.height,
    };
  }

  const parentNode = nodes.find((candidate) => candidate.id === node.parentId);
  if (parentNode) {
    return {
      x: parentNode.position.x,
      y: parentNode.position.y,
      width: parentNode.size.width,
      height: parentNode.size.height,
    };
  }

  return {
    x: 0,
    y: 0,
    width: DESIGNER_CANVAS_BOUNDS.width,
    height: DESIGNER_CANVAS_BOUNDS.height,
  };
};

export const clampPositionToParent = (node: DesignerNode, nodes: DesignerNode[], desired: Point): Point => {
  const bounds = getParentBounds(node, nodes);
  const maxX = Math.max(bounds.x, bounds.x + bounds.width - node.size.width);
  const maxY = Math.max(bounds.y, bounds.y + bounds.height - node.size.height);
  return {
    x: clamp(desired.x, bounds.x, maxX),
    y: clamp(desired.y, bounds.y, maxY),
  };
};
