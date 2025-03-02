import { FlowGraph, FlowNode } from '../types/visualizationTypes';

/**
 * Layout algorithm options
 */
export interface LayoutOptions {
  direction?: 'TB' | 'LR';  // Top-to-bottom or left-to-right
  nodeWidth?: number;
  nodeHeight?: number;
  rankSeparation?: number;  // Vertical spacing between ranks
  nodeSeparation?: number;  // Horizontal spacing between nodes
  edgePadding?: number;     // Padding for edges
}

/**
 * Default layout options
 */
const defaultOptions: LayoutOptions = {
  direction: 'TB',
  nodeWidth: 180,
  nodeHeight: 80,
  rankSeparation: 120,
  nodeSeparation: 80,
  edgePadding: 20
};

/**
 * Apply a layout algorithm to the flow graph
 * 
 * @param graph The flow graph to layout
 * @param options Layout options
 * @returns The flow graph with updated positions
 */
export function applyLayout(graph: FlowGraph, options: LayoutOptions = {}): FlowGraph {
  // Merge options with defaults
  const opts = { ...defaultOptions, ...options };
  
  // For now, we'll implement a simple layered layout algorithm
  // In a real implementation, we would use a more sophisticated algorithm like ELK or dagre
  return applyLayeredLayout(graph, opts);
}

/**
 * Apply a simple layered layout algorithm to the flow graph
 * 
 * @param graph The flow graph to layout
 * @param options Layout options
 * @returns The flow graph with updated positions
 */
function applyLayeredLayout(graph: FlowGraph, options: LayoutOptions): FlowGraph {
  const { direction, nodeWidth, nodeHeight, rankSeparation, nodeSeparation } = options;
  
  // Create a map of node IDs to their ranks
  const nodeRanks = calculateNodeRanks(graph);
  
  // Group nodes by rank
  const nodesByRank: Record<number, FlowNode[]> = {};
  
  graph.nodes.forEach(node => {
    const rank = nodeRanks[node.id] || 0;
    if (!nodesByRank[rank]) {
      nodesByRank[rank] = [];
    }
    nodesByRank[rank].push(node);
  });
  
  // Position nodes by rank
  const ranks = Object.keys(nodesByRank).map(Number).sort((a, b) => a - b);
  
  ranks.forEach((rank, rankIndex) => {
    const nodes = nodesByRank[rank];
    const rankY = rankIndex * (nodeHeight! + rankSeparation!);
    
    // Position nodes within the rank
    nodes.forEach((node, nodeIndex) => {
      const nodeCount = nodes.length;
      const rankWidth = nodeCount * nodeWidth! + (nodeCount - 1) * nodeSeparation!;
      const startX = -rankWidth / 2;
      
      if (direction === 'TB') {
        node.position = {
          x: startX + nodeIndex * (nodeWidth! + nodeSeparation!),
          y: rankY
        };
      } else {
        // Left-to-right layout
        node.position = {
          x: rankY,
          y: startX + nodeIndex * (nodeWidth! + nodeSeparation!)
        };
      }
    });
  });
  
  return {
    nodes: graph.nodes,
    edges: graph.edges
  };
}

/**
 * Calculate the rank of each node in the graph
 * The rank is the longest path from any source node
 * 
 * @param graph The flow graph
 * @returns A map of node IDs to their ranks
 */
function calculateNodeRanks(graph: FlowGraph): Record<string, number> {
  const nodeRanks: Record<string, number> = {};
  const visited: Record<string, boolean> = {};
  
  // Find source nodes (nodes with no incoming edges)
  const incomingEdges: Record<string, number> = {};
  
  graph.nodes.forEach(node => {
    incomingEdges[node.id] = 0;
  });
  
  graph.edges.forEach(edge => {
    if (incomingEdges[edge.target] !== undefined) {
      incomingEdges[edge.target]++;
    }
  });
  
  const sourceNodes = graph.nodes.filter(node => incomingEdges[node.id] === 0);
  
  // If no source nodes, use the first node
  if (sourceNodes.length === 0 && graph.nodes.length > 0) {
    const firstNode = graph.nodes[0];
    nodeRanks[firstNode.id] = 0;
    assignRanks(firstNode.id, 0);
  } else {
    // Assign ranks starting from each source node
    sourceNodes.forEach(node => {
      nodeRanks[node.id] = 0;
      assignRanks(node.id, 0);
    });
  }
  
  // Assign ranks to nodes by traversing the graph
  function assignRanks(nodeId: string, rank: number) {
    visited[nodeId] = true;
    
    // Find outgoing edges
    const outgoingEdges = graph.edges.filter(edge => edge.source === nodeId);
    
    outgoingEdges.forEach(edge => {
      const targetId = edge.target;
      const targetRank = nodeRanks[targetId];
      
      // Assign the maximum rank
      if (targetRank === undefined || rank + 1 > targetRank) {
        nodeRanks[targetId] = rank + 1;
      }
      
      // Continue traversal if not visited
      if (!visited[targetId]) {
        assignRanks(targetId, nodeRanks[targetId]);
      }
    });
  }
  
  return nodeRanks;
}

/**
 * Apply a simple automatic layout to the flow graph
 * This is a fallback layout algorithm that arranges nodes in a grid
 * 
 * @param graph The flow graph to layout
 * @returns The flow graph with updated positions
 */
export function applySimpleLayout(graph: FlowGraph): FlowGraph {
  // Group nodes by type
  const nodesByType: Record<string, FlowNode[]> = {};
  
  // Group nodes by type
  graph.nodes.forEach(node => {
    if (!nodesByType[node.type]) {
      nodesByType[node.type] = [];
    }
    nodesByType[node.type].push(node);
  });
  
  // Position nodes in columns by type
  const columnWidth = 250;
  const rowHeight = 100;
  const types = ['state', 'action', 'event', 'conditional', 'loop', 'parallel'];
  
  types.forEach((type, columnIndex) => {
    const nodes = nodesByType[type] || [];
    nodes.forEach((node, rowIndex) => {
      node.position = {
        x: columnIndex * columnWidth,
        y: rowIndex * rowHeight
      };
    });
  });
  
  return {
    nodes: graph.nodes,
    edges: graph.edges
  };
}