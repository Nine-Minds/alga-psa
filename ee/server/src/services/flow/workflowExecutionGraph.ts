import { Workflow, WorkflowNode, WorkflowEdge } from './types/workflow';

export function buildWorkflowGraph(workflow: Workflow): WorkflowExecutionGraph {
  const nodeMap = new Map<string, WorkflowNode>();
  const edgeMap = new Map<string, WorkflowEdge[]>();

  // Build node and edge maps
  workflow.nodes.forEach(node => nodeMap.set(node.id, node));
  workflow.edges.forEach(edge => {
    if (!edgeMap.has(edge.source_node_id)) {
      edgeMap.set(edge.source_node_id, []);
    }
    edgeMap.get(edge.source_node_id)!.push(edge);
  });

  const processedNodes = new Set<string>();
  const graph: WorkflowExecutionGraph = { nodes: [] };

  function processNode(nodeId: string): GraphNode | GraphDecisionNode {
    if (processedNodes.has(nodeId)) {
      return graph.nodes.find(n => n.id === nodeId)!;
    }

    const node = nodeMap.get(nodeId)!;
    let graphNode: GraphNode | GraphDecisionNode;

    if (node.type === 'decision') {
      const decisionNode: GraphDecisionNode = {
        id: node.id,
        type: 'decision',
        activityName: 'decision',
        params: node.properties,
        dependencies: [],
        sourceNodeId: '',
        conditions: {},
        defaultTargetNodeId: ''
      };

      const edges = edgeMap.get(node.id) || [];
      edges.forEach(edge => {
        if (edge.source_output_id) {
          decisionNode.conditions[edge.target_node_id] = {
            type: 'equals',
            value: edge.source_output_id
          };
        } else {
          decisionNode.defaultTargetNodeId = edge.target_node_id;
        }
        processNode(edge.target_node_id);
      });

      graphNode = decisionNode;
    } else {
      graphNode = {
        id: node.id,
        type: node.type,
        activityName: node.type,
        params: node.properties,
        dependencies: []
      };

      const edges = edgeMap.get(node.id) || [];
      edges.forEach(edge => {
        graphNode.dependencies.push(edge.target_node_id);
        processNode(edge.target_node_id);
      });
    }

    processedNodes.add(nodeId);
    graph.nodes.push(graphNode);
    return graphNode;
  }

  // Start processing from nodes without incoming edges
  workflow.nodes
    .filter(node => !workflow.edges.some(edge => edge.target_node_id === node.id))
    .forEach(node => processNode(node.id));

  return graph;
}

export interface GraphNode {
  id: string;
  type: string;
  activityName: string;
  params: Record<string, any>;
  dependencies: string[];
}

export interface GraphDecisionNode extends GraphNode {
  type: 'decision';
  sourceNodeId: string;
  conditions: {
    [targetNodeId: string]: {
      type: 'equals' | 'threshold' | 'regex';
      value: string | number | RegExp;
    };
  };
  defaultTargetNodeId: string;
}

export interface WorkflowExecutionGraph {
  nodes: (GraphNode | GraphDecisionNode)[];
}

