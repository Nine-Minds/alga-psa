'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Droppable } from '@hello-pangea/dnd';
import ReactFlow, {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  type ReactFlowInstance,
  type Edge,
  type Node,
  type NodeTypes
} from 'reactflow';
import 'reactflow/dist/style.css';

import { buildWorkflowGraph, type WorkflowGraphNodeData } from './buildWorkflowGraph';
import { getStepTypeColor, getStepTypeIcon } from '../workflow-designer/pipeline/PipelineComponents';
import { Plus, Trash2 } from 'lucide-react';

type WorkflowGraphProps<TStep> = {
  steps: TStep[];
  getLabel: (step: TStep) => string;
  getSubtitle?: (step: TStep) => string | null;
  statusByStepId?: Map<string, string>;
  selectedStepId?: string | null;
  onSelectStepId?: (stepId: string) => void;
  editable?: boolean;
  rootPipePath?: string;
  onRequestInsertAt?: (pipePath: string, index: number) => void;
  onDeleteStepId?: (stepId: string) => void;
  className?: string;
};

const StartNode: React.FC<{ data: WorkflowGraphNodeData }> = ({ data }) => {
  return (
    <div
      className="rounded-full bg-green-100 border-2 border-green-500 flex items-center justify-center text-xs font-semibold text-green-700 shadow-sm"
      style={{ width: 52, height: 52 }}
    >
      <Handle
        id="out"
        type="source"
        position={Position.Bottom}
        style={{ opacity: 0, pointerEvents: 'none' }}
      />
      {data.label}
    </div>
  );
};

const JoinNode: React.FC<{ data: WorkflowGraphNodeData }> = ({ data }) => {
  return (
    <div
      className="rounded-full bg-gray-100 border border-gray-300 flex items-center justify-center text-gray-600 shadow-sm"
      style={{ width: 34, height: 34, fontSize: 10 }}
    >
      <Handle
        id="in"
        type="target"
        position={Position.Top}
        style={{ opacity: 0, pointerEvents: 'none' }}
      />
      <Handle
        id="out"
        type="source"
        position={Position.Bottom}
        style={{ opacity: 0, pointerEvents: 'none' }}
      />
      {data.label === 'Done' ? '✓' : '⋯'}
    </div>
  );
};

const statusStyles = (status?: string | null) => {
  switch ((status ?? '').toUpperCase()) {
    case 'STARTED':
      return 'ring-2 ring-cyan-200 border-cyan-200';
    case 'SUCCEEDED':
      return 'ring-1 ring-green-200 border-green-200';
    case 'FAILED':
      return 'ring-2 ring-red-200 border-red-200';
    case 'RETRY_SCHEDULED':
      return 'ring-1 ring-yellow-200 border-yellow-200';
    case 'CANCELED':
      return 'border-gray-200';
    default:
      return 'border-gray-200';
  }
};

const StepNode: React.FC<{ data: WorkflowGraphNodeData; selected?: boolean }> = ({ data, selected }) => {
  const stepType = data.stepType ?? 'unknown';
  const colors = getStepTypeColor(stepType);
  const icon = getStepTypeIcon(stepType);
  const statusClass = statusStyles(data.status);
  return (
    <div
      className={`relative bg-white border rounded-md ${colors.border} shadow-sm px-3 py-2 ${statusClass} ${selected ? 'ring-2 ring-primary-300' : ''}`}
      style={{ width: 260, height: 72, borderLeftWidth: 4 }}
    >
      <Handle
        id="in"
        type="target"
        position={Position.Top}
        style={{ opacity: 0, pointerEvents: 'none' }}
      />
      <Handle
        id="out"
        type="source"
        position={Position.Bottom}
        style={{ opacity: 0, pointerEvents: 'none' }}
      />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className={`flex-shrink-0 ${colors.icon}`}>{icon}</div>
            <div className="text-sm font-medium text-gray-900 truncate">{data.label}</div>
          </div>
          <div className="text-xs text-gray-500 truncate mt-1">{data.subtitle ?? stepType}</div>
        </div>
        {data.status && (
          <div className="text-[10px] text-gray-600 whitespace-nowrap">
            {data.status}
          </div>
        )}
      </div>

      {selected && data.stepId && data.onRequestDelete && (
        <button
          type="button"
          className="absolute -right-2 -top-2 rounded-full border border-gray-200 bg-white shadow-sm p-1 text-gray-500 hover:text-red-600 hover:border-red-200"
          aria-label="Delete step"
          title="Delete step"
          onClick={(event) => {
            event.stopPropagation();
            data.onRequestDelete?.(data.stepId!);
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
};

const InsertNode: React.FC<{ data: WorkflowGraphNodeData }> = ({ data }) => {
  const pipePath = data.pipePath ?? 'root';
  const insertIndex = data.insertIndex ?? 0;
  const droppableId = `insert:${pipePath}:${insertIndex}`;

  return (
    <Droppable droppableId={droppableId}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.droppableProps}
          data-pipe-path={pipePath}
          onClick={(event) => {
            event.stopPropagation();
            data.onRequestInsert?.(pipePath, insertIndex);
          }}
          className={[
            'flex items-center justify-center',
            'rounded-md border shadow-sm bg-white',
            snapshot.isDraggingOver ? 'border-primary-400 ring-2 ring-primary-200' : 'border-gray-200',
            'cursor-copy'
          ].join(' ')}
          style={{ width: 30, height: 30 }}
          title="Drop a step here to insert"
        >
          <Handle
            id="in"
            type="target"
            position={Position.Top}
            style={{ opacity: 0, pointerEvents: 'none' }}
          />
          <Handle
            id="out"
            type="source"
            position={Position.Bottom}
            style={{ opacity: 0, pointerEvents: 'none' }}
          />
          <Plus className="h-4 w-4 text-gray-500" />
          {provided.placeholder}
        </div>
      )}
    </Droppable>
  );
};

const nodeTypes: NodeTypes = {
  workflowStart: StartNode,
  workflowJoin: JoinNode,
  workflowStep: StepNode,
  workflowInsert: InsertNode
};

export default function WorkflowGraph<TStep extends { id: string; type: string }>(props: WorkflowGraphProps<TStep>) {
  const {
    steps,
    getLabel,
    getSubtitle,
    statusByStepId,
    selectedStepId,
    onSelectStepId,
    editable = false,
    rootPipePath = 'root',
    onRequestInsertAt,
    onDeleteStepId,
    className
  } = props;

  const [nodes, setNodes] = useState<Node<WorkflowGraphNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(true);
  const [buildError, setBuildError] = useState<string | null>(null);
  const instanceRef = useRef<ReactFlowInstance | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const getLabelRef = useRef(getLabel);
  const getSubtitleRef = useRef(getSubtitle);
  const pendingViewportRef = useRef(false);
  const didInitialViewportRef = useRef(false);

  const statusMap = useMemo(() => statusByStepId ?? new Map<string, string>(), [statusByStepId]);

  const scheduleInitialViewport = useCallback(() => {
    const instance = instanceRef.current;
    if (!instance) {
      pendingViewportRef.current = true;
      return;
    }

    const start = nodes.find((node) => node.id === 'workflow::start');
    // Prefer a readable zoom near the top of the workflow, rather than fitting the entire (often very tall) workflow.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (start) {
          const focusNodes = nodes.filter((node) => node.position.y <= start.position.y + 800);
          instance.fitView({ nodes: focusNodes, padding: 0.12, duration: 250, minZoom: 0.8, maxZoom: 1.1 });
        } else {
          instance.fitView({ padding: 0.15, duration: 250, minZoom: 0.6, maxZoom: 1.1 });
        }
      });
    });
  }, [nodes]);

  useEffect(() => {
    getLabelRef.current = getLabel;
  }, [getLabel]);

  useEffect(() => {
    getSubtitleRef.current = getSubtitle;
  }, [getSubtitle]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setBuildError(null);
      didInitialViewportRef.current = false;
      try {
        const graph = await buildWorkflowGraph(steps as any, {
          getLabel: (step) => getLabelRef.current(step as any),
          getSubtitle: getSubtitleRef.current ? (step) => getSubtitleRef.current?.(step as any) : undefined,
          includeInsertions: editable,
          getPipePathForRoot: () => rootPipePath
        });
        if (cancelled) return;
        setNodes(graph.nodes);
        setEdges(graph.edges);
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setBuildError(message || 'Failed to build workflow graph.');
          setNodes([]);
          setEdges([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [editable, rootPipePath, steps]);

  useEffect(() => {
    if (loading) return;
    if (buildError) return;
    if (nodes.length === 0) return;
    if (didInitialViewportRef.current) return;
    didInitialViewportRef.current = true;
    const t = window.setTimeout(() => scheduleInitialViewport(), 0);
    return () => window.clearTimeout(t);
  }, [buildError, loading, nodes.length, scheduleInitialViewport]);

  const displayNodes = useMemo(() => {
    return nodes.map((node) => {
      const stepId = (node.data as WorkflowGraphNodeData | undefined)?.stepId;
      const status = stepId ? statusMap.get(stepId) ?? null : null;
      const kind = (node.data as WorkflowGraphNodeData).kind;
      return {
        ...node,
        data: {
          ...(node.data as WorkflowGraphNodeData),
          status,
          onRequestInsert: (node.data as WorkflowGraphNodeData).kind === 'insert' ? onRequestInsertAt ?? null : null,
          onRequestDelete: kind === 'step' ? onDeleteStepId ?? null : null
        },
        selected: Boolean(stepId && selectedStepId && stepId === selectedStepId)
      };
    });
  }, [nodes, onDeleteStepId, onRequestInsertAt, selectedStepId, statusMap]);

  if (loading) {
    return (
      <div className={`w-full h-full flex items-center justify-center text-sm text-gray-500 ${className ?? ''}`}>
        Building graph…
      </div>
    );
  }

  if (buildError) {
    return (
      <div className={`w-full h-full flex items-center justify-center ${className ?? ''}`}>
        <div className="max-w-xl rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <div className="font-semibold">Graph render error</div>
          <div className="mt-1 font-mono text-[11px] text-red-800 break-words">{buildError}</div>
          <div className="mt-2 text-xs text-red-700">
            Switch to List view to continue editing.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`w-full h-full focus:outline-none ${className ?? ''}`}
      style={{ width: '100%', height: '100%', minHeight: 320 }}
      tabIndex={0}
      onKeyDown={(event) => {
        if (!editable) return;
        if (!selectedStepId) return;
        if (!onDeleteStepId) return;
        if (event.key !== 'Delete' && event.key !== 'Backspace') return;
        event.preventDefault();
        event.stopPropagation();
        onDeleteStepId(selectedStepId);
      }}
    >
      <ReactFlow
        nodes={displayNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        style={{ width: '100%', height: '100%' }}
        minZoom={0.25}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
        onInit={(rf) => {
          instanceRef.current = rf;
          if (pendingViewportRef.current) {
            pendingViewportRef.current = false;
            if (nodes.length > 0) scheduleInitialViewport();
          }
          // Always try once on init as well; in some cases we build the graph after init.
          window.setTimeout(() => scheduleInitialViewport(), 0);
        }}
        onNodeClick={(_, node) => {
          const stepId = (node.data as WorkflowGraphNodeData | undefined)?.stepId;
          if (!stepId || !onSelectStepId) return;
          onSelectStepId(stepId);
        }}
        onPaneClick={() => {
          containerRef.current?.focus();
        }}
        defaultEdgeOptions={{
          animated: false
        }}
      >
        <Background gap={24} size={1} color="#e5e7eb" />
        <Controls />
        <MiniMap
          nodeStrokeColor={(n) => {
            const data = n.data as WorkflowGraphNodeData;
            if (data.kind === 'start') return '#16a34a';
            if (data.kind === 'join') return '#9ca3af';
            const colors = getStepTypeColor(data.stepType ?? '');
            if (colors.border.includes('blue')) return '#3b82f6';
            if (colors.border.includes('amber')) return '#f59e0b';
            if (colors.border.includes('purple')) return '#a855f7';
            if (colors.border.includes('orange')) return '#f97316';
            if (colors.border.includes('green')) return '#22c55e';
            return '#9ca3af';
          }}
          nodeColor={() => '#ffffff'}
          nodeBorderRadius={2}
        />
      </ReactFlow>
    </div>
  );
}
