import { DesignerNode, Point, Size } from '../state/designerStore';

export interface AlignmentGuide {
  type: 'vertical' | 'horizontal';
  position: number;
  description: string;
}

const ALIGN_THRESHOLD = 6;

export const calculateGuides = (activeNode: DesignerNode, nodes: DesignerNode[]): AlignmentGuide[] => {
  const guides: AlignmentGuide[] = [];
  nodes.forEach((node) => {
    if (node.id === activeNode.id) return;

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
