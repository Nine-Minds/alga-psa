import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TypeScriptWorkflowRuntime } from '../../lib/workflow/docs/lib/workflow/core/workflowRuntime';
import { ActionRegistry } from '../../lib/workflow/core/actionRegistry';
import { WorkflowDefinition } from '../../lib/workflow/core/workflowDefinition';
import { WorkflowContext } from '../../lib/workflow/core/workflowContext';

describe('Workflow Dependency Resolution', () => {
  let runtime: TypeScriptWorkflowRuntime;
  let actionRegistry: ActionRegistry;

  beforeEach(() => {
    actionRegistry = new ActionRegistry();
    runtime = new TypeScriptWorkflowRuntime(actionRegistry);
    
    // Register test actions
    actionRegistry.registerSimpleAction(
      'fetchData',
      'Fetch data from a source',
      [
        { name: 'source', type: 'string', required: true, description: 'Data source identifier' }
      ],
      async (params) => {
        return { id: params.source, value: `data-${params.source}` };
      }
    );
    
    actionRegistry.registerSimpleAction(
      'processData',
      'Process data from multiple sources',
      [
        { name: 'inputs', type: 'array', required: true, description: 'Input data to process' }
      ],
      async (params) => {
        return {
          processed: true,
          sources: params.inputs.map((input: any) => input.id),
          result: params.inputs.map((input: any) => input.value).join('-')
        };
      }
    );
    
    actionRegistry.registerSimpleAction(
      'saveResult',
      'Save processing result',
      [
        { name: 'result', type: 'object', required: true, description: 'Result to save' }
      ],
      async (params) => {
        return { saved: true, timestamp: new Date().toISOString() };
      }
    );
  });

  it('should resolve dependencies in a linear workflow', async () => {
    // Define a workflow with linear dependencies
    const workflow: WorkflowDefinition = {
      metadata: {
        name: 'LinearDependencyWorkflow',
        version: '1.0.0'
      },
      execute: async (context: WorkflowContext) => {
        // Step 1: Fetch data
        const data = await context.actions.fetch_data({ source: 'primary' });
        
        // Step 2: Process data (depends on step 1)
        const processed = await context.actions.process_data({ inputs: [data] });
        
        // Step 3: Save result (depends on step 2)
        const saved = await context.actions.save_result({ result: processed });
        
        // Store final result
        context.data.set('result', {
          data,
          processed,
          saved
        });
        
        // Complete workflow
        context.setState('completed');
      }
    };

    runtime.registerWorkflow(workflow);
    
    const { executionId } = await runtime.startWorkflow('LinearDependencyWorkflow', {
      tenant: 'test-tenant'
    });
    
    // Wait for workflow to complete
    await vi.waitFor(() => {
      const state = runtime.getExecutionState(executionId, 'test-tenant');
      return state.isComplete;
    }, { timeout: 200 });
    
    // Verify results
    const executionState = runtime['executionStates'].get(executionId);
    const result = executionState.data.result;
    
    expect(result.data).toEqual({ id: 'primary', value: 'data-primary' });
    expect(result.processed).toEqual({
      processed: true,
      sources: ['primary'],
      result: 'data-primary'
    });
    expect(result.saved).toEqual({
      saved: true,
      timestamp: expect.any(String)
    });
  });

  it('should resolve dependencies in a complex workflow with branches', async () => {
    // Define a workflow with branching dependencies
    const workflow: WorkflowDefinition = {
      metadata: {
        name: 'BranchingDependencyWorkflow',
        version: '1.0.0'
      },
      execute: async (context: WorkflowContext) => {
        // Step 1: Fetch data from multiple sources in parallel
        const [dataA, dataB, dataC] = await Promise.all([
          context.actions.fetch_data({ source: 'A' }),
          context.actions.fetch_data({ source: 'B' }),
          context.actions.fetch_data({ source: 'C' })
        ]);
        
        // Step 2: Process data in two separate branches
        const [processedAB, processedC] = await Promise.all([
          context.actions.process_data({ inputs: [dataA, dataB] }),
          context.actions.process_data({ inputs: [dataC] })
        ]);
        
        // Step 3: Final processing that depends on both branches
        const finalProcessed = await context.actions.process_data({
          inputs: [processedAB, processedC]
        });
        
        // Step 4: Save final result
        const saved = await context.actions.save_result({ result: finalProcessed });
        
        // Store results
        context.data.set('results', {
          sources: { dataA, dataB, dataC },
          intermediate: { processedAB, processedC },
          final: finalProcessed,
          saved
        });
        
        // Complete workflow
        context.setState('completed');
      }
    };

    runtime.registerWorkflow(workflow);
    
    const { executionId } = await runtime.startWorkflow('BranchingDependencyWorkflow', {
      tenant: 'test-tenant'
    });
    
    // Wait for workflow to complete
    await vi.waitFor(() => {
      const state = runtime.getExecutionState(executionId, 'test-tenant');
      return state.isComplete;
    }, { timeout: 200 });
    
    // Verify results
    const executionState = runtime['executionStates'].get(executionId);
    const results = executionState.data.results;
    
    // Verify source data
    expect(results.sources.dataA).toEqual({ id: 'A', value: 'data-A' });
    expect(results.sources.dataB).toEqual({ id: 'B', value: 'data-B' });
    expect(results.sources.dataC).toEqual({ id: 'C', value: 'data-C' });
    
    // Verify intermediate processing
    expect(results.intermediate.processedAB).toEqual({
      processed: true,
      sources: ['A', 'B'],
      result: 'data-A-data-B'
    });
    expect(results.intermediate.processedC).toEqual({
      processed: true,
      sources: ['C'],
      result: 'data-C'
    });
    
    // Verify final processing
    expect(results.final).toEqual({
      processed: true,
      sources: expect.arrayContaining(['processed', 'processed']),
      result: expect.stringContaining('data-A-data-B-data-C')
    });
    
    // Verify saved result
    expect(results.saved).toEqual({
      saved: true,
      timestamp: expect.any(String)
    });
  });

  it('should handle circular dependencies gracefully', async () => {
    // Register an action that detects circular dependencies
    actionRegistry.registerSimpleAction(
      'circularDependencyCheck',
      'Check for circular dependencies',
      [
        { name: 'dependencies', type: 'array', required: true, description: 'Dependency graph' }
      ],
      async (params) => {
        const dependencies = params.dependencies;
        const visited = new Set();
        const recursionStack = new Set();
        
        function hasCycle(node: string): boolean {
          if (recursionStack.has(node)) return true;
          if (visited.has(node)) return false;
          
          visited.add(node);
          recursionStack.add(node);
          
          const neighbors = dependencies[node] || [];
          for (const neighbor of neighbors) {
            if (hasCycle(neighbor)) return true;
          }
          
          recursionStack.delete(node);
          return false;
        }
        
        const nodes = Object.keys(dependencies);
        for (const node of nodes) {
          if (hasCycle(node)) return { hasCycle: true, node };
        }
        
        return { hasCycle: false };
      }
    );
    
    // Define a workflow that checks for circular dependencies
    const workflow: WorkflowDefinition = {
      metadata: {
        name: 'CircularDependencyWorkflow',
        version: '1.0.0'
      },
      execute: async (context: WorkflowContext) => {
        // Define a dependency graph with a cycle
        const dependencies = {
          'A': ['B', 'C'],
          'B': ['D'],
          'C': ['E'],
          'D': ['F'],
          'E': ['D'],  // Creates a cycle: A -> C -> E -> D -> F
          'F': []
        };
        
        // Check for circular dependencies
        const result = await context.actions.circular_dependency_check({
          dependencies
        });
        
        // Store result
        context.data.set('result', result);
        
        // Complete workflow
        context.setState('completed');
      }
    };

    runtime.registerWorkflow(workflow);
    
    const { executionId } = await runtime.startWorkflow('CircularDependencyWorkflow', {
      tenant: 'test-tenant'
    });
    
    // Wait for workflow to complete
    await vi.waitFor(() => {
      const state = runtime.getExecutionState(executionId, 'test-tenant');
      return state.isComplete;
    }, { timeout: 200 });
    
    // Verify circular dependency detection
    const executionState = runtime['executionStates'].get(executionId);
    const result = executionState.data.result;
    
    expect(result.hasCycle).toBe(true);
  });

  it('should handle dynamic dependencies based on runtime data', async () => {
    // Register an action that determines dependencies dynamically
    actionRegistry.registerSimpleAction(
      'determineDependencies',
      'Determine dependencies based on input data',
      [
        { name: 'data', type: 'object', required: true, description: 'Input data' }
      ],
      async (params) => {
        const { type, value } = params.data as { type: string; value: string };
        
        // Different processing paths based on data type
        if (type === 'simple') {
          return ['simpleProcessing'];
        } else if (type === 'complex') {
          return ['validation', 'transformation', 'enrichment'];
        } else {
          return ['defaultProcessing'];
        }
      }
    );
    
    // Define a workflow with dynamic dependencies
    const workflow: WorkflowDefinition = {
      metadata: {
        name: 'DynamicDependencyWorkflow',
        version: '1.0.0'
      },
      execute: async (context: WorkflowContext) => {
        // Get input data
        const inputData = context.data.get('inputData') || { type: 'simple', value: 'test' };
        
        // Determine processing dependencies
        const dependencies = await context.actions.determine_dependencies({
          data: inputData
        });
        
        // Execute required processing steps
        const processingResults = [];
        const typedInputData = inputData as { type: string; value: string };
        
        for (const dep of dependencies) {
          // Simulate different processing steps
          let result;
          if (dep === 'simpleProcessing') {
            result = await context.actions.process_data({
              inputs: [{ id: 'simple', value: typedInputData.value }]
            });
          } else if (dep === 'validation') {
            result = { valid: true };
          } else if (dep === 'transformation') {
            result = { transformed: typedInputData.value.toUpperCase() };
          } else if (dep === 'enrichment') {
            result = { enriched: `${typedInputData.value}-extra` };
          } else {
            result = { processed: typedInputData.value };
          }
          
          processingResults.push({ step: dep, result });
        }
        
        // Store results
        context.data.set('processingPath', dependencies);
        context.data.set('results', processingResults);
        
        // Complete workflow
        context.setState('completed');
      }
    };

    runtime.registerWorkflow(workflow);
    
    // Test with simple data
    const simpleResult = await testDynamicWorkflow('simple', 'test-value');
    expect(simpleResult.processingPath).toEqual(['simpleProcessing']);
    expect(simpleResult.results.length).toBe(1);
    
    // Test with complex data
    const complexResult = await testDynamicWorkflow('complex', 'complex-value');
    expect(complexResult.processingPath).toEqual(['validation', 'transformation', 'enrichment']);
    expect(complexResult.results.length).toBe(3);
    
    // Helper function to test the workflow with different inputs
    async function testDynamicWorkflow(type: string, value: string) {
      const { executionId } = await runtime.startWorkflow('DynamicDependencyWorkflow', {
        tenant: 'test-tenant',
        initialData: {
          inputData: { type, value }
        }
      });
      
      // Wait for workflow to complete
      await vi.waitFor(() => {
        const state = runtime.getExecutionState(executionId, 'test-tenant');
        return state.isComplete;
      }, { timeout: 200 });
      
      // Return results
      const executionState = runtime['executionStates'].get(executionId);
      return {
        processingPath: executionState.data.processingPath,
        results: executionState.data.results
      };
    }
  });
});