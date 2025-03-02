import * as path from 'path';
import { parseWorkflowDefinition, findWorkflowExecuteFunction } from './astParser';
import { analyzeWorkflowFunction } from './workflowAnalyzer';
import { buildFlowGraph, applySimpleLayout } from './flowGraphBuilder';

/**
 * Simple test function to verify the AST parsing and analysis
 */
async function testAstParser() {
  try {
    // Path to the example workflow
    const workflowPath = path.resolve(__dirname, '../../examples/invoiceApprovalWorkflow.ts');
    
    console.log(`Parsing workflow file: ${workflowPath}`);
    
    // Parse the workflow definition
    const sourceFile = parseWorkflowDefinition({
      sourceFile: workflowPath
    });
    
    console.log('Successfully parsed workflow file');
    
    // Find the workflow execute function
    const executeFunction = findWorkflowExecuteFunction(sourceFile);
    if (!executeFunction) {
      throw new Error('Could not find workflow execute function');
    }
    
    console.log('Found workflow execute function');
    
    // Analyze the workflow
    const analysis = analyzeWorkflowFunction(executeFunction);
    
    console.log('Workflow Analysis Results:');
    console.log(`- States: ${analysis.states.length}`);
    console.log(`- Actions: ${analysis.actions.length}`);
    console.log(`- Events: ${analysis.events.length}`);
    console.log(`- Conditionals: ${analysis.conditionals.length}`);
    console.log(`- Loops: ${analysis.loops.length}`);
    console.log(`- Parallel Executions: ${analysis.parallelExecutions.length}`);
    console.log(`- Control Flow Relationships: ${analysis.controlFlow.length}`);
    
    // Build the flow graph
    const flowGraph = buildFlowGraph(analysis);
    console.log(`Flow Graph: ${flowGraph.nodes.length} nodes, ${flowGraph.edges.length} edges`);
    
    // Apply layout
    const layoutedGraph = applySimpleLayout(flowGraph);
    console.log('Applied layout to flow graph');
    
    // Output the first few nodes and edges for verification
    console.log('\nSample Nodes:');
    flowGraph.nodes.slice(0, 3).forEach(node => {
      console.log(`- ${node.id} (${node.type}): ${node.data.label}`);
    });
    
    console.log('\nSample Edges:');
    flowGraph.edges.slice(0, 3).forEach(edge => {
      console.log(`- ${edge.source} -> ${edge.target} (${edge.type || 'default'})`);
    });
    
    console.log('\nTest completed successfully!');
  } catch (error) {
    console.error('Error during test:', error);
  }
}

// Run the test
testAstParser().catch(console.error);