'use client';

import React, { useState, useEffect, useRef } from 'react';
import { IConfigurationItem } from '../../interfaces/cmdb.interfaces';
import { ICMDBVisualizationGraph, ICMDBVisualizationNode, ICMDBVisualizationEdge } from '../../interfaces/cmdb.visualization.interfaces';

interface CMDBVisualizationProps {
  configItems: IConfigurationItem[];
}

export function CMDBVisualization({ configItems }: CMDBVisualizationProps) {
  const [graph, setGraph] = useState<ICMDBVisualizationGraph | null>(null);
  const [selectedNode, setSelectedNode] = useState<ICMDBVisualizationNode | null>(null);
  const [viewMode, setViewMode] = useState<'network' | 'hierarchy' | 'impact'>('network');
  const [centerCI, setCenterCI] = useState<string>('');
  const [maxDepth, setMaxDepth] = useState(3);
  const [loading, setLoading] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });

  useEffect(() => {
    if (centerCI) {
      generateGraph();
    }
  }, [centerCI, maxDepth, viewMode]);

  useEffect(() => {
    // Resize canvas when container size changes
    const updateCanvasSize = () => {
      const container = canvasRef.current?.parentElement;
      if (container) {
        setCanvasSize({
          width: container.clientWidth,
          height: Math.max(600, container.clientHeight)
        });
      }
    };

    updateCanvasSize();
    window.addEventListener('resize', updateCanvasSize);
    return () => window.removeEventListener('resize', updateCanvasSize);
  }, []);

  useEffect(() => {
    if (graph && canvasRef.current) {
      drawGraph();
    }
  }, [graph, canvasSize]);

  const generateGraph = async () => {
    if (!centerCI) return;

    setLoading(true);
    try {
      const response = await fetch(`/api/cmdb/visualization/graph`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          centerCIId: centerCI,
          maxDepth,
          viewMode,
          layoutSettings: {
            layout_type: viewMode === 'hierarchy' ? 'hierarchical' : 'force',
            node_spacing: 100,
            edge_length: 150
          }
        })
      });

      const graphData = await response.json();
      setGraph(graphData);
    } catch (error) {
      console.error('Error generating graph:', error);
    } finally {
      setLoading(false);
    }
  };

  const drawGraph = () => {
    const canvas = canvasRef.current;
    if (!canvas || !graph) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;

    // Clear canvas
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw edges first (so they appear behind nodes)
    graph.edges.forEach(edge => {
      const sourceNode = graph.nodes.find(n => n.id === edge.source);
      const targetNode = graph.nodes.find(n => n.id === edge.target);
      
      if (sourceNode && targetNode) {
        drawEdge(ctx, sourceNode, targetNode, edge);
      }
    });

    // Draw nodes
    graph.nodes.forEach(node => {
      drawNode(ctx, node);
    });

    // Draw labels
    graph.nodes.forEach(node => {
      drawNodeLabel(ctx, node);
    });
  };

  const drawNode = (ctx: CanvasRenderingContext2D, node: ICMDBVisualizationNode) => {
    const x = (node.x || 0) + canvasSize.width / 2;
    const y = (node.y || 0) + canvasSize.height / 2;
    const radius = (node.size || 20) / 2;

    // Node shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.1)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;

    // Node fill
    ctx.fillStyle = node.color || getNodeColor(node);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fill();

    // Node border
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = node.selected ? '#3b82f6' : '#d1d5db';
    ctx.lineWidth = node.selected ? 3 : 1;
    ctx.stroke();

    // Status indicator
    drawStatusIndicator(ctx, x, y, radius, node.status);
  };

  const drawEdge = (
    ctx: CanvasRenderingContext2D, 
    source: ICMDBVisualizationNode, 
    target: ICMDBVisualizationNode, 
    edge: ICMDBVisualizationEdge
  ) => {
    const x1 = (source.x || 0) + canvasSize.width / 2;
    const y1 = (source.y || 0) + canvasSize.height / 2;
    const x2 = (target.x || 0) + canvasSize.width / 2;
    const y2 = (target.y || 0) + canvasSize.height / 2;

    ctx.strokeStyle = edge.color || getEdgeColor(edge.relationship_type);
    ctx.lineWidth = edge.width || 2;
    
    // Draw line
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // Draw arrow for directional relationships
    if (!edge.is_bidirectional) {
      drawArrow(ctx, x1, y1, x2, y2);
    }

    // Draw relationship label
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    drawRelationshipLabel(ctx, midX, midY, edge.relationship_type);
  };

  const drawArrow = (ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) => {
    const headLength = 10;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    
    // Calculate arrow position (slightly before target node)
    const arrowX = x2 - Math.cos(angle) * 20;
    const arrowY = y2 - Math.sin(angle) * 20;
    
    ctx.beginPath();
    ctx.moveTo(arrowX, arrowY);
    ctx.lineTo(
      arrowX - headLength * Math.cos(angle - Math.PI / 6),
      arrowY - headLength * Math.sin(angle - Math.PI / 6)
    );
    ctx.moveTo(arrowX, arrowY);
    ctx.lineTo(
      arrowX - headLength * Math.cos(angle + Math.PI / 6),
      arrowY - headLength * Math.sin(angle + Math.PI / 6)
    );
    ctx.stroke();
  };

  const drawNodeLabel = (ctx: CanvasRenderingContext2D, node: ICMDBVisualizationNode) => {
    const x = (node.x || 0) + canvasSize.width / 2;
    const y = (node.y || 0) + canvasSize.height / 2;
    const radius = (node.size || 20) / 2;

    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#374151';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    
    const text = node.label.length > 15 ? node.label.substring(0, 12) + '...' : node.label;
    ctx.fillText(text, x, y + radius + 5);
  };

  const drawRelationshipLabel = (ctx: CanvasRenderingContext2D, x: number, y: number, relationship: string) => {
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#6b7280';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Background for label
    const text = relationship.replace('_', ' ');
    const metrics = ctx.measureText(text);
    const padding = 4;
    
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.fillRect(
      x - metrics.width / 2 - padding,
      y - 6,
      metrics.width + padding * 2,
      12
    );
    
    ctx.fillStyle = '#6b7280';
    ctx.fillText(text, x, y);
  };

  const drawStatusIndicator = (ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, status: string) => {
    const indicatorSize = 6;
    const indicatorX = x + radius - indicatorSize / 2;
    const indicatorY = y - radius + indicatorSize / 2;

    ctx.fillStyle = getStatusColor(status);
    ctx.beginPath();
    ctx.arc(indicatorX, indicatorY, indicatorSize / 2, 0, 2 * Math.PI);
    ctx.fill();
    
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.stroke();
  };

  const getNodeColor = (node: ICMDBVisualizationNode): string => {
    const criticalityColors = {
      'very_high': '#dc2626',
      'high': '#ea580c',
      'medium': '#ca8a04',
      'low': '#16a34a',
      'very_low': '#6b7280'
    };
    return criticalityColors[node.criticality] || '#6b7280';
  };

  const getEdgeColor = (relationshipType: string): string => {
    const relationshipColors = {
      'depends_on': '#dc2626',
      'part_of': '#ea580c',
      'connected_to': '#16a34a',
      'installed_on': '#2563eb',
      'uses': '#7c3aed',
      'provides': '#059669',
      'manages': '#0891b2',
      'backed_up_by': '#6366f1',
      'clustered_with': '#8b5cf6'
    };
    return relationshipColors[relationshipType] || '#6b7280';
  };

  const getStatusColor = (status: string): string => {
    const statusColors = {
      'live': '#16a34a',
      'planned': '#2563eb',
      'under_development': '#ea580c',
      'withdrawn': '#dc2626',
      'disposed': '#6b7280'
    };
    return statusColors[status] || '#6b7280';
  };

  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!graph) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;

    // Find clicked node
    const clickedNode = graph.nodes.find(node => {
      const x = (node.x || 0) + canvasSize.width / 2;
      const y = (node.y || 0) + canvasSize.height / 2;
      const radius = (node.size || 20) / 2;
      
      const distance = Math.sqrt((clickX - x) ** 2 + (clickY - y) ** 2);
      return distance <= radius;
    });

    if (clickedNode) {
      setSelectedNode(clickedNode);
      
      // Update selected state in graph
      const updatedGraph = {
        ...graph,
        nodes: Array.isArray(graph.nodes) ? graph.nodes.map(node => ({
          ...node,
          selected: node.id === clickedNode.id
        })) : []
      };
      setGraph(updatedGraph);
    } else {
      setSelectedNode(null);
      const updatedGraph = {
        ...graph,
        nodes: Array.isArray(graph.nodes) ? graph.nodes.map(node => ({
          ...node,
          selected: false
        })) : []
      };
      setGraph(updatedGraph);
    }
  };

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="bg-white rounded-lg shadow border p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Center CI</label>
            <select
              value={centerCI}
              onChange={(e) => setCenterCI(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select CI to center visualization</option>
              {Array.isArray(configItems) && configItems.map((ci) => (
                <option key={ci.ci_id} value={ci.ci_id}>
                  {ci.ci_name} ({ci.ci_type})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">View Mode</label>
            <select
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value as any)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="network">Network View</option>
              <option value="hierarchy">Hierarchical View</option>
              <option value="impact">Impact Analysis</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Max Depth</label>
            <select
              value={maxDepth}
              onChange={(e) => setMaxDepth(Number(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value={1}>1 Level</option>
              <option value={2}>2 Levels</option>
              <option value={3}>3 Levels</option>
              <option value={4}>4 Levels</option>
              <option value={5}>5 Levels</option>
            </select>
          </div>

          <div className="flex items-end">
            <button
              onClick={generateGraph}
              disabled={!centerCI || loading}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {loading ? 'Generating...' : 'Generate Graph'}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Visualization Canvas */}
        <div className="lg:col-span-3">
          <div className="bg-white rounded-lg shadow border p-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium text-gray-900">Dependency Graph</h3>
              {graph && (
                <div className="text-sm text-gray-600">
                  {graph.total_nodes} nodes, {graph.total_edges} relationships
                </div>
              )}
            </div>
            
            <div className="border border-gray-200 rounded overflow-hidden">
              {!centerCI ? (
                <div className="h-96 flex items-center justify-center bg-gray-50">
                  <div className="text-center">
                    <div className="text-gray-400 mb-2">
                      <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V7.618a1 1 0 01.553-.894L9 4l6 3 6-3v13l-6 3-6-3z" />
                      </svg>
                    </div>
                    <p className="text-gray-600">Select a Configuration Item to visualize its dependencies</p>
                  </div>
                </div>
              ) : loading ? (
                <div className="h-96 flex items-center justify-center bg-gray-50">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                    <p className="mt-4 text-gray-600">Generating visualization...</p>
                  </div>
                </div>
              ) : (
                <canvas
                  ref={canvasRef}
                  width={canvasSize.width}
                  height={canvasSize.height}
                  className="cursor-pointer"
                  onClick={handleCanvasClick}
                />
              )}
            </div>
          </div>
        </div>

        {/* Side Panel */}
        <div className="space-y-6">
          {/* Legend */}
          <div className="bg-white rounded-lg shadow border p-4">
            <h4 className="text-md font-medium text-gray-900 mb-3">Legend</h4>
            
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Node Status</p>
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <div className="w-3 h-3 rounded-full bg-green-500"></div>
                    <span className="text-xs text-gray-600">Live</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                    <span className="text-xs text-gray-600">Planned</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <div className="w-3 h-3 rounded-full bg-orange-500"></div>
                    <span className="text-xs text-gray-600">In Development</span>
                  </div>
                </div>
              </div>

              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Relationships</p>
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <div className="w-4 h-0.5 bg-red-500"></div>
                    <span className="text-xs text-gray-600">Depends On</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <div className="w-4 h-0.5 bg-blue-500"></div>
                    <span className="text-xs text-gray-600">Connected To</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <div className="w-4 h-0.5 bg-green-500"></div>
                    <span className="text-xs text-gray-600">Part Of</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Selected Node Details */}
          {selectedNode && (
            <div className="bg-white rounded-lg shadow border p-4">
              <h4 className="text-md font-medium text-gray-900 mb-3">Selected CI</h4>
              
              <div className="space-y-2">
                <div>
                  <span className="text-sm font-medium text-gray-600">Name:</span>
                  <p className="text-sm text-gray-900">{selectedNode.label}</p>
                </div>
                <div>
                  <span className="text-sm font-medium text-gray-600">Type:</span>
                  <p className="text-sm text-gray-900 capitalize">{selectedNode.type.replace('_', ' ')}</p>
                </div>
                <div>
                  <span className="text-sm font-medium text-gray-600">Status:</span>
                  <p className="text-sm text-gray-900 capitalize">{selectedNode.status.replace('_', ' ')}</p>
                </div>
                <div>
                  <span className="text-sm font-medium text-gray-600">Environment:</span>
                  <p className="text-sm text-gray-900 capitalize">{selectedNode.environment}</p>
                </div>
                <div>
                  <span className="text-sm font-medium text-gray-600">Criticality:</span>
                  <span className={`ml-2 px-2 py-1 text-xs font-semibold rounded-full ${getCriticalityColor(selectedNode.criticality)}`}>
                    {selectedNode.criticality.replace('_', ' ')}
                  </span>
                </div>
                {selectedNode.description && (
                  <div>
                    <span className="text-sm font-medium text-gray-600">Description:</span>
                    <p className="text-sm text-gray-900">{selectedNode.description}</p>
                  </div>
                )}
              </div>
              
              <div className="mt-4 pt-4 border-t border-gray-200">
                <button className="w-full px-3 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700">
                  View Full Details
                </button>
              </div>
            </div>
          )}

          {/* Graph Stats */}
          {graph && (
            <div className="bg-white rounded-lg shadow border p-4">
              <h4 className="text-md font-medium text-gray-900 mb-3">Graph Statistics</h4>
              
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Total Nodes:</span>
                  <span className="text-sm font-medium text-gray-900">{graph.total_nodes}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Total Edges:</span>
                  <span className="text-sm font-medium text-gray-900">{graph.total_edges}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Max Depth:</span>
                  <span className="text-sm font-medium text-gray-900">{graph.depth_level}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Layout:</span>
                  <span className="text-sm font-medium text-gray-900 capitalize">{graph.layout_type}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  function getCriticalityColor(criticality: string): string {
    switch (criticality) {
      case 'very_high': return 'bg-red-100 text-red-800';
      case 'high': return 'bg-orange-100 text-orange-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'low': return 'bg-green-100 text-green-800';
      case 'very_low': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  }
}