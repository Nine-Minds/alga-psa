import { FlowGraph, FlowNode } from '../types/visualizationTypes';
import { applyLayout as applyFlowLayout } from '../ast/flowGraphBuilder';

/**
 * Layout algorithm options
 */
export interface LayoutOptions {
  direction?: 'TB' | 'LR' | 'RIGHT';  // Top-to-bottom, left-to-right, or right (for CFG)
  nodeWidth?: number;
  nodeHeight?: number;
  rankSeparation?: number;  // Vertical spacing between ranks
  nodeSeparation?: number;  // Horizontal spacing between nodes
  edgePadding?: number;     // Padding for edges
  algorithm?: 'layered' | 'force' | 'stress'; // Layout algorithm to use
  edgeRouting?: 'orthogonal' | 'polyline' | 'splines'; // Edge routing style
}

/**
 * Default layout options
 */
const defaultOptions: LayoutOptions = {
  direction: 'RIGHT', // Right direction for CFG (left-to-right flow)
  nodeWidth: 250,     // Wider nodes for better text display
  nodeHeight: 150,    // Taller nodes for better text display
  rankSeparation: 400, // Significantly increased vertical separation for better readability
  nodeSeparation: 300, // Significantly increased horizontal separation for better readability
  edgePadding: 80,     // Much more padding for edges to avoid overlaps
  algorithm: 'layered', // Layered algorithm for CFG
  edgeRouting: 'polyline' // Polyline routing for better CFG representation
};

/**
 * Apply a layout algorithm to the flow graph
 * 
 * @param graph The flow graph to layout
 * @param options Layout options
 * @returns The flow graph with updated positions
 */
export async function applyLayout(graph: FlowGraph, options: LayoutOptions = {}): Promise<FlowGraph> {
  // Merge options with defaults
  const opts = { ...defaultOptions, ...options };
  // Use the ELK.js layout algorithm from flowGraphBuilder
  // This provides better visualization of control flow with sophisticated layout
  return await applyFlowLayout(graph) as FlowGraph;
}