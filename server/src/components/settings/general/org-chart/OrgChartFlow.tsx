'use client';

import React, { useEffect } from 'react';
import ReactFlow, {
  Background,
  Controls,
  ReactFlowProvider,
  useReactFlow,
  type Node,
  type Edge,
  type NodeMouseHandler,
  type NodeTypes,
} from 'reactflow';
import 'reactflow/dist/style.css';

interface OrgChartFlowProps {
  nodes: Node[];
  edges: Edge[];
  nodeTypes: NodeTypes;
  onNodeClick: NodeMouseHandler;
}

const OrgChartFlowCanvas = ({ nodes, edges, nodeTypes, onNodeClick }: OrgChartFlowProps) => {
  const { fitView } = useReactFlow();

  useEffect(() => {
    if (nodes.length > 0) {
      fitView({ padding: 0.2 });
    }
  }, [nodes, fitView]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={onNodeClick}
      nodesDraggable={false}
      zoomOnScroll
      panOnScroll
      zoomOnPinch
      fitView
      className="bg-white"
    >
      <Background gap={20} size={1} className="text-border-100" />
      <Controls />
    </ReactFlow>
  );
};

const OrgChartFlow = ({ nodes, edges, nodeTypes, onNodeClick }: OrgChartFlowProps) => {
  return (
    <ReactFlowProvider>
      <OrgChartFlowCanvas nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodeClick={onNodeClick} />
    </ReactFlowProvider>
  );
};

export default OrgChartFlow;
