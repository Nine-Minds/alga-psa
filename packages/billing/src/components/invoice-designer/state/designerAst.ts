import type { DesignerComponentType } from './designerStore';

export type DesignerNodeId = string;

// Unified designer node shape: generic props + children ids only.
// Conventions for common prop namespaces (not hard typing):
// - props.name: string
// - props.style: Record<string, unknown>
// - props.layout: Record<string, unknown>
// - props.metadata: Record<string, unknown>
export interface DesignerAstNode {
  id: DesignerNodeId;
  type: DesignerComponentType;
  props: Record<string, unknown>;
  children: DesignerNodeId[];
}

export interface DesignerAstWorkspace {
  rootId: DesignerNodeId;
  nodesById: Record<DesignerNodeId, DesignerAstNode>;
}

// Root contract: the workspace's rootId points at the single document root node.
// Keeping this value stable avoids churn during the cutover from legacy state.
export const DESIGNER_AST_DOCUMENT_ID: DesignerNodeId = 'designer-document-root';

