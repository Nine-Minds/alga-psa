import React from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  NodeTypes,
  EdgeTypes,
  ReactFlowProvider,
  Panel,
  Node,
  Edge,
  OnNodesChange,
  OnEdgesChange,
  OnNodeClick,
  OnPaneClick
} from 'reactflow';
import 'reactflow/dist/style.css';

interface DynamicReactFlowProps {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  nodeTypes: NodeTypes;
  edgeTypes: EdgeTypes;
  onNodeClick: OnNodeClick;
  onPaneClick: OnPaneClick;
  fitView?: boolean;
  attributionPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  children?: React.ReactNode;
}

const DynamicReactFlow: React.FC<DynamicReactFlowProps> = (props) => {
  return <ReactFlow {...props} />;
};

export default DynamicReactFlow;