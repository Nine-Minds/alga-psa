import { useState, useEffect, useCallback } from 'react';
import { parseWorkflowDefinition, findWorkflowExecuteFunction } from '../ast/astParser';
import { analyzeWorkflowFunction } from '../ast/workflowAnalyzer';
import { buildFlowGraph, applyLayout } from '../ast/flowGraphBuilder';
// Import from our new implementation instead of the service
import { fetchRuntimeStatus, applyRuntimeStatus } from '../services/runtimeIntegrationService';
import { FlowGraph, FlowNode, FlowEdge } from '../types/visualizationTypes';
import { getWorkflowDefinition, getWorkflowDSLContent } from '../../actions/workflow-visualization-actions';

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
 * Hook for workflow visualization as a Control Flow Graph (CFG)
 *
 * This hook handles:
 * - Loading workflow definitions
 * - Parsing and analyzing workflow code
 * - Building and laying out the control flow graph
 * - Fetching and applying runtime status
 *
 * Phase 1.5 Enhancement: This hook now focuses exclusively on control flow elements
 * and completely ignores state transitions, providing a more accurate representation
 * of the actual code execution flow.
 *
 * @param params Hook parameters
 * @returns Hook result with the control flow graph
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
        if (workflowDSL) {
          // If we have DSL content, parse it and build the graph
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
          
          // Analyze the workflow with focus on control flow
          const analysis = analyzeWorkflowFunction(executeFunction);
          
          // Explicitly remove state transitions from the analysis to ensure CFG focus
          analysis.states = [];
          
          // Filter out any control flow relationships that involve state transitions
          analysis.controlFlow = analysis.controlFlow.filter(flow =>
            flow.from.type !== 'stateTransition' && flow.to.type !== 'stateTransition'
          );
          
          // Build the flow graph with exclusive focus on control flow
          let flowGraph = buildFlowGraph(analysis);
          
          // Apply layout using ELK.js (with fallback to directed layout)
          flowGraph = await applyLayout(flowGraph);
          
          // If we have an execution ID and status, apply runtime status
          if (executionId && initialExecutionStatus) {
            flowGraph = applyRuntimeStatus(flowGraph as FlowGraph, initialExecutionStatus);
          }
          
          setGraph(flowGraph as FlowGraph);
          setLoading(false);
          setError(null);
          return;
        } else if (!initialDefinition && !workflowDSL) {
          // If we don't have an initial definition or DSL, fetch them
          const [definition, dsl] = await Promise.all([
            getWorkflowDefinition(workflowDefinitionId),
            getWorkflowDSLContent(workflowDefinitionId).catch(() => null)
          ]);
          
          if (dsl) {
            // Parse and analyze the workflow
            const sourceFile = parseWorkflowDefinition({
              sourceFile: 'memory.ts',
              sourceText: dsl
            });
            
            const executeFunction = findWorkflowExecuteFunction(sourceFile);
            if (!executeFunction) {
              throw new Error('Could not find workflow execute function');
            }
            
            // Analyze the workflow with focus on control flow
            const analysis = analyzeWorkflowFunction(executeFunction);
            
            // Explicitly remove state transitions from the analysis to ensure CFG focus
            analysis.states = [];
            
            // Filter out any control flow relationships that involve state transitions
            analysis.controlFlow = analysis.controlFlow.filter(flow =>
              flow.from.type !== 'stateTransition' && flow.to.type !== 'stateTransition'
            );
            
            // Build the flow graph with exclusive focus on control flow
            let flowGraph = buildFlowGraph(analysis);
            
            // Apply layout using ELK.js (with fallback to directed layout)
            flowGraph = await applyLayout(flowGraph);
            
            // Apply runtime status if available
            if (executionId && initialExecutionStatus) {
              flowGraph = applyRuntimeStatus(flowGraph as FlowGraph, initialExecutionStatus);
            }
            
            setGraph(flowGraph as FlowGraph);
            setLoading(false);
            setError(null);
            return;
          } else {
            // If we couldn't get DSL content, show an error
            throw new Error(`Could not load workflow DSL for ${workflowDefinitionId}`);
          }
        }
        
        // If we reach here, we couldn't build a graph
        throw new Error(`Could not build workflow graph for ${workflowDefinitionId}`);
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

// Remove the createPlaceholderGraph function as it's no longer needed
