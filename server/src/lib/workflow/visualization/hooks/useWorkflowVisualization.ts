import { useState, useEffect, useCallback } from 'react';
import { parseWorkflowDefinition, findWorkflowExecuteFunction } from '../ast/astParser';
import { analyzeWorkflowFunction } from '../ast/workflowAnalyzer';
import { buildFlowGraph } from '../ast/flowGraphBuilder';
import { applyLayout } from '../services/layoutService';
import { fetchRuntimeStatus, applyRuntimeStatus } from '../services/runtimeIntegrationService';
import { FlowGraph, FlowNode } from '../types/visualizationTypes';
import { getWorkflowDefinition, getWorkflowDSLContent } from '@/lib/actions/workflow-visualization-actions';

/**
 * Parameters for the useWorkflowVisualization hook
 */
interface UseWorkflowVisualizationParams {
  workflowDefinitionId: string;
  executionId?: string;
  pollInterval?: number;
  initialDefinition?: any;
  initialExecutionStatus?: any;
  workflowDSL?: string;
}

/**
 * Result of the useWorkflowVisualization hook
 */
interface UseWorkflowVisualizationResult {
  graph: FlowGraph;
  loading: boolean;
  error: Error | null;
  refreshStatus: () => Promise<void>;
}

/**
 * Hook for workflow visualization
 * 
 * This hook handles:
 * - Loading workflow definitions
 * - Parsing and analyzing workflow code
 * - Building and laying out the flow graph
 * - Fetching and applying runtime status
 * 
 * @param params Hook parameters
 * @returns Hook result
 */
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
          
          // If we have DSL content, use it to build the graph
          if (dsl) {
            try {
              // Parse the workflow definition
              const sourceFile = parseWorkflowDefinition({
                sourceFile: 'memory.ts',
                sourceText: dsl
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
              flowGraph = applyLayout(flowGraph as FlowGraph) as any;
              
              // If we have an execution ID and status, apply runtime status
              if (executionId && initialExecutionStatus) {
                flowGraph = applyRuntimeStatus(flowGraph as FlowGraph, initialExecutionStatus);
              }
              
              setGraph(flowGraph as FlowGraph);
              setLoading(false);
              setError(null);
              return;
            } catch (err) {
              console.error('Error parsing workflow DSL:', err);
              // Fall back to placeholder graph if we have a definition
              if (definition) {
                const placeholderGraph = createPlaceholderGraph(definition);
                setGraph(placeholderGraph);
                setLoading(false);
                setError(null);
                return;
              }
              throw err;
            }
          } else if (definition) {
            // If we only have the definition, create a placeholder graph
            const placeholderGraph = createPlaceholderGraph(definition);
            setGraph(placeholderGraph);
            setLoading(false);
            setError(null);
            return;
          } else {
            throw new Error(`Could not load workflow definition: ${workflowDefinitionId}`);
          }
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
            flowGraph = applyLayout(flowGraph as FlowGraph) as any;
            
            // If we have an execution ID and status, apply runtime status
            if (executionId && initialExecutionStatus) {
              flowGraph = applyRuntimeStatus(flowGraph as FlowGraph, initialExecutionStatus);
            }
            
            setGraph(flowGraph as FlowGraph);
            setLoading(false);
            setError(null);
            return;
          } catch (err) {
            console.error('Error parsing workflow DSL:', err);
            // Fall back to placeholder graph if we have a definition
            if (initialDefinition) {
              const placeholderGraph = createPlaceholderGraph(initialDefinition);
              setGraph(placeholderGraph);
              setLoading(false);
              setError(null);
              return;
            }
            throw err;
          }
        } else if (initialDefinition) {
          // If we only have the definition, create a placeholder graph
          const placeholderGraph = createPlaceholderGraph(initialDefinition);
          setGraph(placeholderGraph);
          setLoading(false);
          setError(null);
          return;
        }
      } catch (err) {
        console.error('Error building workflow graph:', err);
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
    refreshStatus
  };
}

/**
 * Helper function to create a placeholder graph from a workflow definition
 * 
 * @param definition The workflow definition
 * @returns A flow graph
 */
function createPlaceholderGraph(definition: any): FlowGraph {
  // Create nodes for states
  const stateNodes = definition.states.map((state: any, index: number) => ({
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
  const edges = definition.transitions.map((transition: any, index: number) => ({
    id: `edge-${index}`,
    source: `state-${transition.from}`,
    target: `state-${transition.to}`,
    type: 'controlFlow',
    animated: false,
    label: transition.event
  }));
  
  // Apply layout to the graph
  return applyLayout({
    nodes: stateNodes,
    edges
  } as FlowGraph) as FlowGraph;
}