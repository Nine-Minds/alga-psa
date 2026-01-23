import { describe, it, expect } from 'vitest';
import { buildFlowGraph, applyLayout } from './flowGraphBuilder';
import { WorkflowAnalysis, StateTransition, ActionCall } from '../types/astTypes';

describe('flowGraphBuilder', () => {
  describe('buildFlowGraph', () => {
    it('should exclude state transitions from the graph', () => {
      // Create a mock analysis with state transitions and other components
      const analysis: WorkflowAnalysis = {
        states: [
          {
            type: 'stateTransition',
            stateName: 'state1',
            sourceLocation: { line: 1, character: 1, text: '' }
          },
          {
            type: 'stateTransition',
            stateName: 'state2',
            sourceLocation: { line: 2, character: 1, text: '' }
          }
        ],
        actions: [
          {
            type: 'actionCall',
            actionName: 'action1',
            arguments: [],
            sourceLocation: { line: 3, character: 1, text: '' }
          }
        ],
        events: [],
        conditionals: [],
        loops: [],
        parallelExecutions: [],
        controlFlow: []
      };
      
      // Build the flow graph
      const graph = buildFlowGraph(analysis);
      
      // Verify that no state nodes are created
      expect(graph.nodes.find(node => node.type === 'state')).toBeUndefined();
      
      // Verify that action nodes are created
      expect(graph.nodes.find(node => node.type === 'action')).toBeDefined();
      
      // Verify the number of nodes (should only include non-state nodes)
      expect(graph.nodes.length).toBe(1);
    });

    it('should skip edges that involve state transitions', () => {
      // Create a mock state transition and action
      const stateTransition: StateTransition = {
        type: 'stateTransition',
        stateName: 'state1',
        sourceLocation: { line: 1, character: 1, text: '' }
      };
      
      const action: ActionCall = {
        type: 'actionCall',
        actionName: 'action1',
        arguments: [],
        sourceLocation: { line: 2, character: 1, text: '' }
      };
      
      // Create a mock analysis with control flow involving state transitions
      const analysis: WorkflowAnalysis = {
        states: [stateTransition],
        actions: [action],
        events: [],
        conditionals: [],
        loops: [],
        parallelExecutions: [],
        controlFlow: [
          {
            from: stateTransition,
            to: action,
            type: 'sequential'
          },
          {
            from: action,
            to: action,
            type: 'sequential'
          }
        ]
      };
      
      // Build the flow graph
      const graph = buildFlowGraph(analysis);
      
      // Verify that edges involving state transitions are skipped
      expect(graph.edges.length).toBe(1);
      
      // Verify that the remaining edge is between non-state nodes
      expect(graph.edges[0].source).toBe('action-0');
      expect(graph.edges[0].target).toBe('action-0');
    });
  });

  describe('applyLayout', () => {
    it('should position nodes in a directed layout', async () => {
      // Create a simple graph with a few nodes and edges
      const graph = {
        nodes: [
          {
            id: 'action-0',
            type: 'action',
            data: {
              label: 'action1',
              actionName: 'action1',
              sourceLocation: { line: 1, character: 1, text: '' },
              status: 'default'
            },
            position: { x: 0, y: 0 }
          },
          {
            id: 'conditional-0',
            type: 'conditional',
            data: {
              label: 'If condition',
              condition: 'condition',
              sourceLocation: { line: 2, character: 1, text: '' },
              status: 'default'
            },
            position: { x: 0, y: 0 }
          }
        ],
        edges: [
          {
            id: 'edge-0',
            source: 'action-0',
            target: 'conditional-0',
            type: 'controlFlow'
          }
        ]
      };
      
      // Apply the directed layout
      const layoutedGraph = await applyLayout(graph);
      
      // Verify that node positions are updated
      expect(layoutedGraph.nodes[0].position).not.toEqual({ x: 0, y: 0 });
      expect(layoutedGraph.nodes[1].position).not.toEqual({ x: 0, y: 0 });
      
      // Verify that the root node is positioned at the top
      expect(layoutedGraph.nodes[0].position.y).toBe(0);
      
      // Verify that the child node is positioned below the root node
      expect(layoutedGraph.nodes[1].position.y).toBeGreaterThan(0);
    });
  });
});