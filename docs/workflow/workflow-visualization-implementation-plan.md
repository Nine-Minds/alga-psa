# Workflow Visualization Implementation Plan (Updated)

## 1. Introduction

This document outlines a comprehensive implementation plan for creating a workflow visualization system that uses a read-only Abstract Syntax Tree (AST) of TypeScript code to visualize workflow logic flow. The system will leverage React Flow to create interactive, visual representations of workflows, including conditionals, loops, actions, events, and parallel execution patterns.

## 2. System Architecture

### 2.1 High-Level Architecture

The workflow visualization system will consist of the following major components:

1. **AST Parser and Analyzer**: Parses TypeScript workflow definitions and analyzes their structure
2. **Flow Graph Builder**: Converts AST analysis into a graph representation
3. **React Flow Renderer**: Renders the graph with custom nodes and edges
4. **Runtime Integration**: Connects with the workflow runtime for execution status

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│                 │     │                 │     │                 │     │                 │
│  TypeScript     │────►│  AST Parser     │────►│  Flow Graph     │────►│  React Flow     │
│  Workflow       │     │  & Analyzer     │     │  Builder        │     │  Renderer       │
│                 │     │                 │     │                 │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘
                                                                               │
                                                                               │
                                                                               ▼
                                                                        ┌─────────────────┐
                                                                        │                 │
                                                                        │  Runtime        │
                                                                        │  Integration    │
                                                                        │                 │
                                                                        └─────────────────┘
```

### 2.2 Component Structure

The system will be organized into the following directory structure, aligned with the existing project structure:

```
server/src/
├── components/
│   ├── ui/                           # Existing UI components
│   └── workflows/                    # Workflow-specific UI components
│       ├── visualization/
│       │   ├── WorkflowVisualizer.tsx  # Main visualization component
│       │   ├── nodes/                  # Custom node components
│       │   │   ├── StateNode.tsx
│       │   │   ├── ActionNode.tsx
│       │   │   ├── EventNode.tsx
│       │   │   ├── ConditionalNode.tsx
│       │   │   ├── LoopNode.tsx
│       │   │   └── ParallelNode.tsx
│       │   ├── edges/                  # Custom edge components
│       │   │   ├── ControlFlowEdge.tsx
│       │   │   ├── ConditionalEdge.tsx
│       │   │   └── ParallelEdge.tsx
│       │   └── controls/               # UI controls
│       │       ├── ZoomControls.tsx
│       │       ├── FilterControls.tsx
│       │       └── LegendComponent.tsx
│       └── ClientWorkflowVisualization.tsx  # Existing component
│
├── lib/
│   ├── workflow/
│   │   ├── visualization/            # Visualization core logic
│   │   │   ├── ast/                  # AST parsing and analysis
│   │   │   │   ├── astParser.ts
│   │   │   │   ├── workflowAnalyzer.ts
│   │   │   │   ├── nodeVisitors/     # Visitor pattern implementations
│   │   │   │   │   ├── stateTransitionVisitor.ts
│   │   │   │   │   ├── actionVisitor.ts
│   │   │   │   │   ├── eventVisitor.ts
│   │   │   │   │   ├── conditionalVisitor.ts
│   │   │   │   │   ├── loopVisitor.ts
│   │   │   │   │   └── parallelVisitor.ts
│   │   │   │   └── flowGraphBuilder.ts
│   │   │   ├── hooks/                # React hooks
│   │   │   │   ├── useWorkflowVisualization.ts
│   │   │   │   └── useWorkflowDefinition.ts
│   │   │   ├── services/             # Services
│   │   │   │   ├── workflowVisualizationService.ts
│   │   │   │   ├── layoutService.ts
│   │   │   │   └── runtimeIntegrationService.ts
│   │   │   ├── utils/                # Utilities
│   │   │   │   ├── astUtils.ts
│   │   │   │   ├── graphUtils.ts
│   │   │   │   └── layoutUtils.ts
│   │   │   └── types/                # Type definitions
│   │   │       ├── astTypes.ts
│   │   │       ├── visualizationTypes.ts
│   │   │       └── statusMappingTypes.ts
│   │   ├── core/                     # Existing workflow core components
│   │   ├── persistence/              # Existing workflow persistence layer
│   │   ├── streams/                  # Existing workflow streams
│   │   ├── util/                     # Existing workflow utilities
│   │   └── workers/                  # Existing workflow workers
│   │
│   └── actions/
│       └── workflow-visualization-actions.ts  # Existing actions file
│
└── test/
    └── unit/
        └── workflow/
            └── visualization/        # Visualization tests
                ├── ast/
                │   ├── astParser.test.ts
                │   └── workflowAnalyzer.test.ts
                ├── hooks/
                │   └── useWorkflowVisualization.test.ts
                └── services/
                    └── runtimeIntegrationService.test.ts
```

## 3. Detailed Implementation Plan

### 3.1 Phase 1: AST Parsing and Analysis (Weeks 1-2)

#### 3.1.1 AST Parser

The AST Parser will use the TypeScript Compiler API to parse workflow definition files and extract their structure.

**Key Implementation Details:**

```typescript
// astParser.ts
import * as ts from 'typescript';

export interface ParseOptions {
  sourceFile: string;
  sourceText?: string;
  compilerOptions?: ts.CompilerOptions;
}

export function parseWorkflowDefinition(options: ParseOptions): ts.SourceFile {
  const { sourceFile, sourceText, compilerOptions = {} } = options;
  
  // Create a program to parse the source file
  let program: ts.Program;
  
  if (sourceText) {
    // Create a virtual source file if source text is provided
    const host = ts.createCompilerHost(compilerOptions);
    const originalGetSourceFile = host.getSourceFile;
    host.getSourceFile = (fileName, languageVersion) => {
      if (fileName === sourceFile) {
        return ts.createSourceFile(fileName, sourceText, languageVersion);
      }
      return originalGetSourceFile(fileName, languageVersion);
    };
    program = ts.createProgram([sourceFile], compilerOptions, host);
  } else {
    // Create a program from the file system
    program = ts.createProgram([sourceFile], {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      ...compilerOptions
    });
  }
  
  // Get the source file from the program
  const source = program.getSourceFile(sourceFile);
  if (!source) {
    throw new Error(`Could not find source file: ${sourceFile}`);
  }
  
  return source;
}

export function findWorkflowExecuteFunction(sourceFile: ts.SourceFile): ts.FunctionLike | undefined {
  let executeFunction: ts.FunctionLike | undefined;
  
  // Visit each node to find the workflow execute function
  function visit(node: ts.Node) {
    // Look for defineWorkflow calls
    if (ts.isCallExpression(node) && 
        ts.isIdentifier(node.expression) && 
        node.expression.text === 'defineWorkflow') {
      
      // The second argument should be the execute function
      const executeArg = node.arguments[1];
      if (executeArg && (ts.isArrowFunction(executeArg) || ts.isFunctionExpression(executeArg))) {
        executeFunction = executeArg;
        return;
      }
    }
    
    ts.forEachChild(node, visit);
  }
  
  visit(sourceFile);
  return executeFunction;
}
```

#### 3.1.2 AST Visitors

We'll implement the visitor pattern to analyze different aspects of the workflow definition.

**Example State Transition Visitor:**

```typescript
// stateTransitionVisitor.ts
import * as ts from 'typescript';
import { StateTransition } from '../../types/astTypes';

export function isStateTransition(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  
  // Check if it's a call to context.setState
  const propAccess = node.expression;
  if (!ts.isPropertyAccessExpression(propAccess)) return false;
  
  const obj = propAccess.expression;
  const prop = propAccess.name;
  
  return (ts.isIdentifier(obj) && obj.text === 'context' &&
          ts.isIdentifier(prop) && prop.text === 'setState');
}

export function extractStateInfo(node: ts.Node): StateTransition {
  if (!ts.isCallExpression(node) || !isStateTransition(node)) {
    throw new Error('Node is not a state transition');
  }
  
  // Get the state argument
  const stateArg = node.arguments[0];
  let stateName = 'unknown';
  
  if (ts.isStringLiteral(stateArg)) {
    stateName = stateArg.text;
  } else if (ts.isIdentifier(stateArg)) {
    stateName = `[${stateArg.text}]`; // Variable reference
  }
  
  // Get source location for the node
  const sourceFile = node.getSourceFile();
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
  
  return {
    type: 'stateTransition',
    stateName,
    sourceLocation: {
      line: line + 1,
      character: character + 1,
      text: node.getText()
    }
  };
}
```

#### 3.1.3 Workflow Analyzer

The Workflow Analyzer will coordinate the visitors and build a complete analysis of the workflow.

```typescript
// workflowAnalyzer.ts
import * as ts from 'typescript';
import { WorkflowAnalysis } from '../types/astTypes';
import { isStateTransition, extractStateInfo } from './nodeVisitors/stateTransitionVisitor';
import { isActionCall, extractActionInfo } from './nodeVisitors/actionVisitor';
import { isEventWaiting, extractEventInfo } from './nodeVisitors/eventVisitor';
import { isConditional, extractConditionalInfo } from './nodeVisitors/conditionalVisitor';
import { isLoop, extractLoopInfo } from './nodeVisitors/loopVisitor';
import { isParallelExecution, extractParallelInfo } from './nodeVisitors/parallelVisitor';

export function analyzeWorkflowFunction(node: ts.FunctionLike): WorkflowAnalysis {
  const analysis: WorkflowAnalysis = {
    states: [],
    actions: [],
    events: [],
    conditionals: [],
    loops: [],
    parallelExecutions: [],
    controlFlow: []
  };
  
  // Track parent-child relationships for control flow
  const nodeParents = new Map<ts.Node, ts.Node>();
  
  // Visit each node in the AST
  function visit(node: ts.Node, parent?: ts.Node) {
    // Store parent relationship
    if (parent) {
      nodeParents.set(node, parent);
    }
    
    // Identify state transitions
    if (isStateTransition(node)) {
      analysis.states.push(extractStateInfo(node));
    }
    
    // Identify action calls
    if (isActionCall(node)) {
      analysis.actions.push(extractActionInfo(node));
    }
    
    // Identify event waiting
    if (isEventWaiting(node)) {
      analysis.events.push(extractEventInfo(node));
    }
    
    // Identify conditionals
    if (isConditional(node)) {
      analysis.conditionals.push(extractConditionalInfo(node));
    }
    
    // Identify loops
    if (isLoop(node)) {
      analysis.loops.push(extractLoopInfo(node));
    }
    
    // Identify parallel execution
    if (isParallelExecution(node)) {
      analysis.parallelExecutions.push(extractParallelInfo(node));
    }
    
    // Continue visiting child nodes
    ts.forEachChild(node, child => visit(child, node));
  }
  
  // Start visiting from the function body
  if (node.body) {
    visit(node.body);
  }
  
  // Build control flow relationships
  buildControlFlow(analysis, nodeParents);
  
  return analysis;
}

function buildControlFlow(analysis: WorkflowAnalysis, nodeParents: Map<ts.Node, ts.Node>): void {
  // Implementation to build control flow relationships between nodes
  // This would analyze the parent-child relationships and the execution order
  // to determine how control flows through the workflow
}
```

### 3.2 Phase 2: React Flow Integration (Weeks 3-4)

#### 3.2.1 Custom Node Components

We'll create custom node components for different types of workflow elements, following the UI coding standards from AI_coding_standards.md.

**Example State Node:**

```tsx
// StateNode.tsx
import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { StateNodeData } from 'server/src/lib/workflow/visualization/types/visualizationTypes';
import { Card } from 'server/src/components/ui/Card';

export function StateNode({ data, id }: NodeProps<StateNodeData>) {
  const automationId = `workflow-state-node-${id}`;
  
  return (
    <Card className="state-node" id={automationId}>
      <Handle type="target" position={Position.Top} />
      <div className="node-header">State</div>
      <div className="node-content">
        <div className="state-name">{data.label}</div>
        <div className="state-details">
          {data.sourceLocation && (
            <div className="source-location">
              Line: {data.sourceLocation.line}
            </div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </Card>
  );
}
```

#### 3.2.2 Main Visualization Component

The main component will integrate all the custom nodes and edges with React Flow, following the UI coding standards.

```tsx
// WorkflowVisualizer.tsx
import React, { useCallback } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  NodeTypes,
  EdgeTypes
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
import { WorkflowDefinition } from 'server/src/lib/workflow/core/workflowParser';

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

interface WorkflowVisualizerProps {
  workflowDefinitionId: string;
  executionId?: string;
  height?: number | string;
  width?: number | string;
  showControls?: boolean;
  showLegend?: boolean;
  pollInterval?: number;
  initialDefinition?: WorkflowDefinition;
  initialExecutionStatus?: any;
  workflowDSL?: string;
}

export default function WorkflowVisualizer({
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
  const { graph, loading, error, setSelectedNode } = useWorkflowVisualization({
    workflowDefinitionId,
    executionId,
    pollInterval,
    initialDefinition,
    initialExecutionStatus,
    workflowDSL
  });
  
  const onNodeClick = useCallback((event: React.MouseEvent, node: any) => {
    setSelectedNode(node);
  }, [setSelectedNode]);
  
  if (loading) {
    return <div className="workflow-loading" id="workflow-visualizer-loading">Loading workflow visualization...</div>;
  }
  
  if (error) {
    return <div className="workflow-error" id="workflow-visualizer-error">Error: {error.message}</div>;
  }
  
  return (
    <div className="workflow-visualizer" id="workflow-visualizer" style={{ height, width }}>
      {showControls && (
        <div className="visualizer-controls">
          <FilterControls />
          <ZoomControls />
        </div>
      )}
      
      <ReactFlow
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={onNodeClick}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
      
      {showLegend && <LegendComponent />}
    </div>
  );
}
```

### 3.3 Phase 3: Runtime Integration (Weeks 5-6)

#### 3.3.1 Runtime Integration Service

The Runtime Integration Service will connect the visualization with the workflow runtime.

```typescript
// runtimeIntegrationService.ts
import { getWorkflowExecutionStatus } from 'server/src/lib/actions/workflow-visualization-actions';
import { FlowGraph } from '../types/visualizationTypes';

interface RuntimeStatus {
  execution: {
    execution_id: string;
    workflow_name: string;
    current_state: string;
    status: string;
  };
  events: Array<{
    event_id: string;
    event_name: string;
    from_state: string;
    to_state: string;
  }>;
  actionResults: Array<{
    action_name: string;
    success: boolean;
    error_message?: string;
  }>;
}

export async function fetchRuntimeStatus(executionId: string): Promise<RuntimeStatus | null> {
  try {
    // Fetch execution state from the workflow runtime
    const status = await getWorkflowExecutionStatus(executionId);
    return status;
  } catch (error) {
    console.error(`Failed to fetch runtime status: ${error}`);
    throw error;
  }
}

export function applyRuntimeStatus(graph: FlowGraph, status: RuntimeStatus): FlowGraph {
  if (!status) return graph;
  
  // Create a new graph with updated status
  const updatedNodes = graph.nodes.map(node => {
    // Update node status based on runtime information
    let nodeStatus = 'default';
    let nodeData = { ...node.data };
    
    if (node.type === 'state' && node.data.stateName === status.execution.current_state) {
      nodeStatus = 'active';
    } else if (node.type === 'action') {
      const actionResult = status.actionResults.find(ar => ar.action_name === node.data.actionName);
      if (actionResult) {
        nodeStatus = actionResult.success ? 'success' : 'error';
        nodeData.result = actionResult;
      }
    } else if (node.type === 'event') {
      const eventProcessed = status.events.some(e => e.event_name === node.data.eventName);
      if (eventProcessed) {
        nodeStatus = 'success';
      }
    }
    
    return {
      ...node,
      data: {
        ...nodeData,
        status: nodeStatus
      }
    };
  });
  
  // Update edges based on control flow
  const updatedEdges = graph.edges.map(edge => {
    // Determine if this edge has been traversed
    const isTraversed = determineEdgeTraversal(edge, status, graph);
    
    return {
      ...edge,
      animated: isTraversed,
      style: {
        ...edge.style,
        stroke: isTraversed ? '#3498db' : '#ccc'
      }
    };
  });
  
  return {
    nodes: updatedNodes,
    edges: updatedEdges
  };
}

function determineEdgeTraversal(edge: any, status: RuntimeStatus, graph: FlowGraph): boolean {
  // Implementation to determine if an edge has been traversed
  // based on the runtime status and graph structure
  
  // For now, a simple implementation that checks if the source and target nodes
  // correspond to consecutive states in the execution history
  if (!status.events || status.events.length === 0) return false;
  
  const sourceNode = graph.nodes.find(n => n.id === edge.source);
  const targetNode = graph.nodes.find(n => n.id === edge.target);
  
  if (!sourceNode || !targetNode) return false;
  
  // Check if there's a state transition from source to target
  return status.events.some(event => 
    (sourceNode.type === 'state' && sourceNode.data.stateName === event.from_state) &&
    (targetNode.type === 'state' && targetNode.data.stateName === event.to_state)
  );
}
```

#### 3.3.2 Workflow Visualization Hook

The main hook will coordinate the visualization process.

```typescript
// useWorkflowVisualization.ts
import { useState, useEffect, useCallback } from 'react';
import { parseWorkflowDefinition, findWorkflowExecuteFunction } from '../ast/astParser';
import { analyzeWorkflowFunction } from '../ast/workflowAnalyzer';
import { buildFlowGraph } from '../ast/flowGraphBuilder';
import { applyLayout } from '../services/layoutService';
import { fetchRuntimeStatus, applyRuntimeStatus } from '../services/runtimeIntegrationService';
import { FlowGraph, FlowNode } from '../types/visualizationTypes';
import { getWorkflowDefinition, getWorkflowDSLContent } from 'server/src/lib/actions/workflow-visualization-actions';
import { WorkflowDefinition } from 'server/src/lib/workflow/core/workflowParser';

interface UseWorkflowVisualizationParams {
  workflowDefinitionId: string;
  executionId?: string;
  pollInterval?: number;
  initialDefinition?: WorkflowDefinition;
  initialExecutionStatus?: any;
  workflowDSL?: string;
}

interface UseWorkflowVisualizationResult {
  graph: FlowGraph;
  loading: boolean;
  error: Error | null;
  selectedNode: FlowNode | null;
  setSelectedNode: (node: FlowNode | null) => void;
  refreshStatus: () => Promise<void>;
}

export function useWorkflowVisualization({
  workflowDefinitionId,
  executionId,
  pollInterval = 5000,
  initialDefinition,
  initialExecutionStatus,
  workflowDSL
}: UseWorkflowVisualizationParams): UseWorkflowVisualizationResult {
  const [graph, setGraph] = useState<FlowGraph>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const [selectedNode, setSelectedNode] = useState<FlowNode | null>(null);
  
  // Build graph from workflow definition
  useEffect(() => {
    async function buildGraph() {
      try {
        if (!initialDefinition && !workflowDSL) {
          // If we don't have an initial definition or DSL, fetch them
          const [definition, dsl] = await Promise.all([
            getWorkflowDefinition(workflowDefinitionId),
            getWorkflowDSLContent(workflowDefinitionId).catch(() => null)
          ]);
          
          // TODO: Implement graph building from definition
          // For now, create a placeholder graph
          const placeholderGraph = createPlaceholderGraph(definition);
          setGraph(placeholderGraph);
        } else if (workflowDSL) {
          // If we have DSL content, parse it and build the graph
          try {
            // Parse the workflow definition
            const sourceFile = parseWorkflowDefinition({
              sourceFile: 'memory.ts',
              sourceText: workflowDSL
            });
            
            // Find the execute function
            const executeFunction = findWorkflowExecuteFunction(sourceFile);
            if (!executeFunction) {
              throw new Error('Could not find workflow execute function');
            }
            
            // Analyze the workflow
            const analysis = analyzeWorkflowFunction(executeFunction);
            
            // Build the flow graph
            let flowGraph = buildFlowGraph(analysis);
            
            // Apply layout
            flowGraph = applyLayout(flowGraph);
            
            // If we have an execution ID and status, apply runtime status
            if (executionId && initialExecutionStatus) {
              flowGraph = applyRuntimeStatus(flowGraph, initialExecutionStatus);
            }
            
            setGraph(flowGraph);
          } catch (err) {
            console.error('Error parsing workflow DSL:', err);
            // Fall back to placeholder graph
            if (initialDefinition) {
              const placeholderGraph = createPlaceholderGraph(initialDefinition);
              setGraph(placeholderGraph);
            } else {
              throw err;
            }
          }
        } else if (initialDefinition) {
          // If we only have the definition, create a placeholder graph
          const placeholderGraph = createPlaceholderGraph(initialDefinition);
          setGraph(placeholderGraph);
        }
        
        setError(null);
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      }
    }
    
    buildGraph();
  }, [workflowDefinitionId, initialDefinition, workflowDSL, executionId, initialExecutionStatus]);
  
  // Function to refresh runtime status
  const refreshStatus = useCallback(async () => {
    if (!executionId) return;
    
    try {
      const status = await fetchRuntimeStatus(executionId);
      if (status) {
        setGraph(currentGraph => applyRuntimeStatus(currentGraph, status));
      }
    } catch (err) {
      console.error('Failed to refresh status:', err);
    }
  }, [executionId]);
  
  // Set up polling for runtime status if we have an execution ID
  useEffect(() => {
    if (!executionId) return;
    
    const intervalId = setInterval(refreshStatus, pollInterval);
    
    return () => {
      clearInterval(intervalId);
    };
  }, [executionId, refreshStatus, pollInterval]);
  
  return {
    graph,
    loading,
    error,
    selectedNode,
    setSelectedNode,
    refreshStatus
  };
}

// Helper function to create a placeholder graph from a workflow definition
function createPlaceholderGraph(definition: WorkflowDefinition): FlowGraph {
  // Create nodes for states
  const stateNodes = definition.states.map((state, index) => ({
    id: `state-${state.name}`,
    type: 'state',
    data: { 
      label: state.name,
      stateName: state.name,
      status: 'default'
    },
    position: { x: 100, y: index * 100 }
  }));
  
  // Create edges between states based on transitions
  const edges = definition.transitions.map((transition, index) => ({
    id: `edge-${index}`,
    source: `state-${transition.from}`,
    target: `state-${transition.to}`,
    type: 'controlFlow',
    animated: false,
    label: transition.event
  }));
  
  return {
    nodes: stateNodes,
    edges
  };
}
```

### 3.4 Phase 4: UI Integration and Testing (Weeks 7-8)

#### 3.4.1 Update ClientWorkflowVisualization Component

We'll update the existing ClientWorkflowVisualization component to use the new visualization components.

```tsx
// ClientWorkflowVisualization.tsx
"use client";

import { useState, useEffect } from 'react';
import WorkflowVisualizer from 'server/src/components/workflows/visualization/WorkflowVisualizer';
import { getWorkflowDefinition, getWorkflowExecutionStatus, getWorkflowDSLContent } from 'server/src/lib/actions/workflow-visualization-actions';
import { WorkflowDefinition } from 'server/src/lib/workflow/core/workflowParser';

interface ClientWorkflowVisualizationProps {
  workflowDefinitionId: string;
  executionId: string;
  height?: number | string;
  width?: string | number;
  showControls?: boolean;
  showLegend?: boolean;
  pollInterval?: number;
}

export default function ClientWorkflowVisualization({
  workflowDefinitionId,
  executionId,
  height = 450,
  width = '100%',
  showControls = true,
  showLegend = true,
  pollInterval = 5000
}: ClientWorkflowVisualizationProps) {
  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null);
  const [dslContent, setDslContent] = useState<string | null>(null);
  const [executionStatus, setExecutionStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Fetch workflow definition and DSL content
  useEffect(() => {
    async function fetchDefinitionAndDSL() {
      try {
        // Fetch both the parsed definition and raw DSL content in parallel
        const [def, dsl] = await Promise.all([
          getWorkflowDefinition(workflowDefinitionId),
          getWorkflowDSLContent(workflowDefinitionId).catch(err => {
            console.warn(`Could not load DSL content for ${workflowDefinitionId}:`, err);
            return null; // This is not a critical error, we can still use the parsed definition
          })
        ]);
        
        setDefinition(def);
        if (dsl) {
          setDslContent(dsl);
          console.log(`Successfully loaded DSL content for ${workflowDefinitionId}, length: ${dsl.length}`);
        }
      } catch (err) {
        console.error('Error fetching workflow definition:', err);
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    }

    fetchDefinitionAndDSL();
  }, [workflowDefinitionId]);

  // Fetch execution status with polling
  useEffect(() => {
    let isMounted = true;
    let timeoutId: NodeJS.Timeout;

    async function fetchStatus() {
      try {
        const status = await getWorkflowExecutionStatus(executionId);
        if (isMounted) {
          setExecutionStatus(status);
          setLoading(false);
        }
      } catch (err) {
        console.error('Error fetching workflow execution status:', err);
        if (isMounted) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      }

      // Schedule next poll if component is still mounted
      if (isMounted) {
        timeoutId = setTimeout(fetchStatus, pollInterval);
      }
    }

    fetchStatus();

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
    };
  }, [executionId, pollInterval]);

  if (loading && !definition) {
    return <div id="workflow-loading">Loading workflow visualization...</div>;
  }

  if (error) {
    return <div id="workflow-error">Error: {error.message}</div>;
  }

  if (!definition) {
    return <div id="workflow-not-found">Workflow definition not found</div>;
  }

  return (
    <WorkflowVisualizer
      workflowDefinitionId={workflowDefinitionId}
      executionId={executionId}
      height={height}
      width={width}
      showControls={showControls}
      showLegend={showLegend}
      pollInterval={pollInterval}
      initialDefinition={definition}
      initialExecutionStatus={executionStatus}
      workflowDSL={dslContent || undefined}
    />
  );
}
```

#### 3.4.2 API Endpoints

We'll update the existing workflow-visualization-actions.ts file to support the new visualization components.

```typescript
// Add to workflow-visualization-actions.ts

/**
 * Get workflow visualization data
 * This combines definition, execution status, and DSL content
 */
export async function getWorkflowVisualizationData(definitionId: string, executionId?: string) {
  try {
    // Fetch definition, DSL content, and execution status in parallel
    const [definition, dslContent, executionStatus] = await Promise.all([
      getWorkflowDefinition(definitionId),
      getWorkflowDSLContent(definitionId).catch(() => null),
      executionId ? getWorkflowExecutionStatus(executionId) : Promise.resolve(null)
    ]);
    
    return {
      definition,
      dslContent,
      executionStatus
    };
  } catch (error) {
    console.error(`Error getting workflow visualization data:`, error);
    throw error;
  }
}
```

## 4. Testing Strategy

### 4.1 Unit Tests

We'll create comprehensive unit tests for each component of the visualization system.

```typescript
// astParser.test.ts
import { parseWorkflowDefinition, findWorkflowExecuteFunction } from 'server/src/lib/workflow/visualization/ast/astParser';

describe('AST Parser', () => {
  test('should parse a workflow definition', () => {
    const source = `
      import { defineWorkflow } from '../core/workflowDefinition';
      
      export const myWorkflow = defineWorkflow(
        'MyWorkflow',
        async function workflow(context) {
          // Workflow implementation
          context.setState('initial');
        }
      );
    `;
    
    const sourceFile = parseWorkflowDefinition({
      sourceFile: 'memory.ts',
      sourceText: source
    });
    
    expect(sourceFile).toBeDefined();
  });
  
  test('should find the workflow execute function', () => {
    const source = `
      import { defineWorkflow } from '../core/workflowDefinition';
      
      export const myWorkflow = defineWorkflow(
        'MyWorkflow',
        async function workflow(context) {
          // Workflow implementation
          context.setState('initial');
        }
      );
    `;
    
    const sourceFile = parseWorkflowDefinition({
      sourceFile: 'memory.ts',
      sourceText: source
    });
    
    const executeFunction = findWorkflowExecuteFunction(sourceFile);
    
    expect(executeFunction).toBeDefined();
  });
});
```

### 4.2 Integration Tests

We'll create integration tests to verify that the visualization system works correctly with the workflow runtime.

```typescript
// workflowVisualization.integration.test.ts
import { renderHook, act } from '@testing-library/react-hooks';
import { useWorkflowVisualization } from 'server/src/lib/workflow/visualization/hooks/useWorkflowVisualization';
import { mockWorkflowDefinition, mockRuntimeStatus } from './mocks';

// Mock fetch
global.fetch = jest.fn();

describe('Workflow Visualization Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  test('should fetch workflow definition and build graph', async () => {
    // Mock fetch responses
    (global.fetch as jest.Mock).mockImplementation((url) => {
      if (url.includes('/definitions/')) {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(mockWorkflowDefinition)
        });
      }
      return Promise.resolve({ ok: false });
    });
    
    const { result, waitForNextUpdate } = renderHook(() => 
      useWorkflowVisualization({
        workflowDefinitionId: 'TestWorkflow'
      })
    );
    
    // Initial state
    expect(result.current.loading).toBe(true);
    expect(result.current.graph.nodes).toHaveLength(0);
    
    // Wait for the hook to update
    await waitForNextUpdate();
    
    // Final state
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.graph.nodes.length).toBeGreaterThan(0);
    expect(result.current.graph.edges.length).toBeGreaterThan(0);
  });
});
```

## 5. Performance Considerations

### 5.1 Rendering Optimization

- **Memoization**: Use React.memo and useMemo to prevent unnecessary re-renders
- **Virtualization**: For large workflows, implement virtualization to only render visible nodes
- **Incremental Updates**: Only update changed nodes rather than re-rendering the entire workflow

### 5.2 AST Analysis Optimization

- **Caching**: Cache AST analysis results to avoid repeated parsing
- **Incremental Analysis**: Only re-analyze parts of the workflow that have changed
- **Worker Threads**: Use worker threads for CPU-intensive AST analysis

## 6. Accessibility Considerations

### 6.1 Keyboard Navigation

- Implement keyboard shortcuts for navigation (arrow keys, tab)
- Add focus indicators for keyboard users
- Ensure all interactive elements are keyboard accessible

### 6.2 Screen Reader Support

- Add appropriate ARIA attributes to nodes and edges
- Provide text alternatives for visual status indicators
- Implement descriptive announcements for status changes

## 7. Integration with Existing Workflow System

### 7.1 Connection with Workflow Runtime

The visualization system will integrate with the existing workflow runtime through the following connections:

1. **Definition Loading**: Use the existing workflow definition loading mechanism
2. **Execution Status**: Connect to the workflow execution status API
3. **Event Monitoring**: Subscribe to workflow events for real-time updates

### 7.2 UI Integration

The visualization system will be integrated into the existing UI through:

1. **ClientWorkflowVisualization Component**: Already set up to use the visualization components
2. **Workflow Definition Viewer**: For viewing workflow definitions
3. **Workflow Execution Viewer**: For monitoring workflow executions

## 8. Timeline and Milestones

### 8.1 Week 1-2: AST Parsing and Analysis

- Set up project structure
- Implement AST parser
- Implement node visitors
- Implement workflow analyzer
- Implement flow graph builder
- Write unit tests

### 8.2 Week 3-4: React Flow Integration

- Create custom node components
- Create custom edge components
- Implement layout service
- Create main visualization component
- Write integration tests

### 8.3 Week 5-6: Runtime Integration

- Implement runtime integration service
- Create visualization hooks
- Implement status updates
- Update API endpoints
- Write end-to-end tests

### 8.4 Week 7-8: UI Integration and Testing

- Update ClientWorkflowVisualization component
- Implement accessibility features
- Optimize performance
- Create documentation
- Final testing and bug fixes

## 9. Conclusion

This implementation plan provides a comprehensive approach to creating a workflow visualization system that uses a read-only AST of TypeScript code to visualize workflow logic flow. By leveraging React Flow and the TypeScript Compiler API, we can create an interactive, visual representation of workflows that helps developers understand and debug complex workflows.

The system will be implemented in phases, starting with AST parsing and analysis, followed by React Flow integration, runtime integration, and finally UI integration and testing. Each phase builds on the previous one, creating a complete visualization system that integrates with the existing workflow runtime.

By moving the UI components into the main project UI components area, we ensure better alignment with the project structure and follow the established coding standards.