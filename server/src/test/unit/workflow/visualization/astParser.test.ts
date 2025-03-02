import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { parseWorkflowDefinition, findWorkflowExecuteFunction } from '../../../../lib/workflow/visualization/ast/astParser';
import { analyzeWorkflowFunction } from '../../../../lib/workflow/visualization/ast/workflowAnalyzer';
import { buildFlowGraph, applySimpleLayout } from '../../../../lib/workflow/visualization/ast/flowGraphBuilder';

describe('AST Parser and Analyzer', () => {
  it('should parse and analyze the invoice approval workflow', async () => {
    // Path to the example workflow
    const workflowPath = path.resolve(process.cwd(), 'src/lib/workflow/examples/invoiceApprovalWorkflow.ts');
    
    // Parse the workflow definition
    const sourceFile = parseWorkflowDefinition({
      sourceFile: workflowPath
    });
    
    expect(sourceFile).toBeDefined();
    
    // Find the workflow execute function
    const executeFunction = findWorkflowExecuteFunction(sourceFile);
    expect(executeFunction).toBeDefined();
    
    if (!executeFunction) {
      throw new Error('Could not find workflow execute function');
    }
    
    // Analyze the workflow
    const analysis = analyzeWorkflowFunction(executeFunction);
    
    // Verify that we found workflow components
    expect(analysis.states.length).toBeGreaterThan(0);
    expect(analysis.actions.length).toBeGreaterThan(0);
    expect(analysis.events.length).toBeGreaterThan(0);
    
    // Build the flow graph
    const flowGraph = buildFlowGraph(analysis);
    expect(flowGraph.nodes.length).toBeGreaterThan(0);
    expect(flowGraph.edges.length).toBeGreaterThan(0);
    
    // Apply layout
    const layoutedGraph = applySimpleLayout(flowGraph);
    expect(layoutedGraph.nodes.length).toBe(flowGraph.nodes.length);
    expect(layoutedGraph.edges.length).toBe(flowGraph.edges.length);
    
    // Log some information for debugging
    console.log('Workflow Analysis Results:');
    console.log(`- States: ${analysis.states.length}`);
    console.log(`- Actions: ${analysis.actions.length}`);
    console.log(`- Events: ${analysis.events.length}`);
    console.log(`- Conditionals: ${analysis.conditionals.length}`);
    console.log(`- Loops: ${analysis.loops.length}`);
    console.log(`- Parallel Executions: ${analysis.parallelExecutions.length}`);
    console.log(`- Control Flow Relationships: ${analysis.controlFlow.length}`);
    console.log(`Flow Graph: ${flowGraph.nodes.length} nodes, ${flowGraph.edges.length} edges`);
  });
});