import React, { useCallback, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  NodeTypes,
  EdgeTypes,
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  useReactFlow,
  Panel
} from 'reactflow';
import 'reactflow/dist/style.css';

import { StateNode } from './nodes/StateNode';
import { ActionNode } from './nodes/ActionNode';
import { EventNode } from './nodes/EventNode';
import { ConditionalNode } from './nodes/ConditionalNode';
import { LoopNode } from './nodes/LoopNode';
import { ParallelNode } from './nodes/ParallelNode';

import { ControlFlowEdge } from './edges/ControlFlowEdge';
import { ConditionalEdge } from './edges/ConditionalEdge';
import { ParallelEdge } from './edges/ParallelEdge';

import { FilterControls } from './controls/FilterControls';
import { ZoomControls } from './controls/ZoomControls';
import { LegendComponent } from './controls/LegendComponent';

import { useWorkflowVisualization } from 'server/src/lib/workflow/visualization/hooks/useWorkflowVisualization';
import { StatusMappingContext, defaultStatusMapping } from 'server/src/lib/workflow/visualization/types/statusMappingTypes';
import { WorkflowVisualizerProps } from 'server/src/lib/workflow/visualization/types/visualizationTypes';

// Define custom node types
const nodeTypes: NodeTypes = {
  state: StateNode,
  action: ActionNode,
  event: EventNode,
  conditional: ConditionalNode,
  loop: LoopNode,
  parallel: ParallelNode
};

// Define custom edge types
const edgeTypes: EdgeTypes = {
  controlFlow: ControlFlowEdge,
  conditional: ConditionalEdge,
  parallel: ParallelEdge
};

/**
 * Inner workflow visualizer component
 * This component is wrapped with ReactFlowProvider
 */
function WorkflowVisualizerInner({
  workflowDefinitionId,
  executionId,
  height = 600,
  width = '100%',
  showControls = true,
  showLegend = true,
  pollInterval = 5000,
  initialDefinition,
  initialExecutionStatus,
  workflowDSL
}: WorkflowVisualizerProps) {
  const { graph, loading, error, refreshStatus } = useWorkflowVisualization({
    workflowDefinitionId,
    executionId,
    pollInterval,
    initialDefinition,
    initialExecutionStatus,
    workflowDSL
  });

  const [nodes, setNodes, onNodesChange] = useNodesState(graph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graph.edges);
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const reactFlowInstance = useReactFlow();

  // Update nodes and edges when graph changes, preserving animation state
  React.useEffect(() => {
    setNodes(graph.nodes);
    
    // Preserve the 'animated' property when updating edges
    setEdges(currentEdges => {
      return graph.edges.map(newEdge => {
        // Find the corresponding edge in the current edges
        const existingEdge = currentEdges.find(e => e.id === newEdge.id);
        
        // If the edge exists and is animated, preserve that state
        if (existingEdge && existingEdge.animated) {
          return {
            ...newEdge,
            animated: true,
            style: {
              ...newEdge.style,
              stroke: '#3498db',
              strokeWidth: 2
            }
          };
        }
        
        return newEdge;
      });
    });
  }, [graph, setNodes, setEdges]);

  // Handle node click
  const onNodeClick = useCallback((event: React.MouseEvent, node: any) => {
    setSelectedNode(node);
  }, []);

  // Handle node selection clear
  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  // Handle manual refresh while preserving animation state
  const handleRefresh = useCallback(() => {
    // Store current animated edges before refresh
    const animatedEdgeIds = edges
      .filter(edge => edge.animated)
      .map(edge => edge.id);
    
    // After refresh, restore animation state
    refreshStatus().then(() => {
      // We don't need to do anything here as the useEffect for graph changes
      // will preserve the animation state using the logic we added
    });
  }, [refreshStatus, edges]);

  // Fit view when graph changes
  React.useEffect(() => {
    if (graph.nodes.length > 0) {
      setTimeout(() => {
        reactFlowInstance.fitView({ padding: 0.2 });
      }, 100);
    }
  }, [graph.nodes.length, reactFlowInstance]);

  if (loading) {
    return <div className="workflow-loading p-4 text-center" id="workflow-visualizer-loading">Loading workflow visualization...</div>;
  }

  if (error) {
    return <div className="workflow-error p-4 text-center text-red-500" id="workflow-visualizer-error">Error: {error.message}</div>;
  }

  return (
    <div className="workflow-visualizer relative" id="workflow-visualizer" style={{ height, width }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        fitView
        attributionPosition="bottom-left"
      >
        <Background />
        <Controls />
        <MiniMap 
          nodeStrokeWidth={3}
          zoomable
          pannable
        />
        
        {showControls && (
          <Panel position="top-right" className="flex flex-col gap-2">
            <button
              onClick={handleRefresh}
              className="bg-white p-2 rounded-md shadow-sm border border-gray-200 text-gray-700 hover:bg-gray-100"
              title="Refresh"
              id="workflow-refresh"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
              </svg>
            </button>
            <ZoomControls />
            <FilterControls />
          </Panel>
        )}
        
        {showLegend && <LegendComponent />}
      </ReactFlow>
      
      {selectedNode && (
        <div className="node-details absolute bottom-4 left-4 bg-white p-3 rounded-md shadow-md border border-gray-200 max-w-xs">
          <div className="text-sm font-semibold text-gray-700 mb-2">Node Details</div>
          <div className="text-xs">
            <div><span className="font-semibold">Type:</span> {selectedNode.type}</div>
            <div><span className="font-semibold">ID:</span> {selectedNode.id}</div>
            {selectedNode.data.sourceLocation && (
              <div>
                <span className="font-semibold">Source:</span> Line {selectedNode.data.sourceLocation.line}
              </div>
            )}
            {selectedNode.type === 'action' && selectedNode.data.result && (
              <div className="mt-2">
                <div className="font-semibold">Result:</div>
                <pre className="text-xs bg-gray-100 p-1 rounded mt-1 overflow-auto max-h-24">
                  {JSON.stringify(selectedNode.data.result, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Main workflow visualizer component
 * Wraps the inner component with ReactFlowProvider and StatusMappingContext
 */
export function WorkflowVisualizer(props: WorkflowVisualizerProps) {
  return (
    <StatusMappingContext.Provider value={defaultStatusMapping}>
      <ReactFlowProvider>
        <WorkflowVisualizerInner {...props} />
      </ReactFlowProvider>
    </StatusMappingContext.Provider>
  );
}

export default WorkflowVisualizer;