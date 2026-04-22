'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Droppable } from '@hello-pangea/dnd';
import ReactFlow, {
  BaseEdge,
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  type ReactFlowInstance,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  type Node,
  type NodeProps,
  type NodeTypes
} from 'reactflow';
import 'reactflow/dist/style.css';

import { buildWorkflowGraph, type WorkflowGraphNodeData } from './buildWorkflowGraph';
import { getStepTypeColor, getStepTypeIcon } from '../workflow-designer/pipeline/PipelineComponents';
import { Link2, Play, Plus, Trash2 } from 'lucide-react';

type WorkflowGraphProps<TStep> = {
  steps: TStep[];
  getLabel: (step: TStep) => string;
  getSubtitle?: (step: TStep) => string | null;
  statusByStepId?: Map<string, string>;
  inputMappingStatusByStepId?: Map<string, { requiredCount: number; unmappedRequiredCount: number }>;
  selectedStepId?: string | null;
  onSelectStepId?: (stepId: string) => void;
  editable?: boolean;
  rootPipePath?: string;
  onRequestInsertAt?: (pipePath: string, index: number) => void;
  onDeleteStepId?: (stepId: string) => void;
  className?: string;
};

const StartNode: React.FC<{ data: WorkflowGraphNodeData }> = ({ data }) => {
  const { t } = useTranslation('msp/workflows');
  return (
    <div
      className="rounded-full bg-success/15 border-2 border-success flex items-center justify-center text-xs font-semibold text-success shadow-sm"
      style={{ width: 52, height: 52, boxSizing: 'border-box' }}
    >
      <Handle
        id="out"
        type="source"
        position={Position.Bottom}
        style={{ opacity: 0, pointerEvents: 'none' }}
      />
      {t('graph.start.label', { defaultValue: data.label ?? 'Start' })}
    </div>
  );
};

const JoinNode: React.FC<{ data: WorkflowGraphNodeData }> = ({ data }) => {
  return (
    <div
      className="rounded-full bg-gray-100 border border-gray-300 flex items-center justify-center text-gray-600 shadow-sm"
      style={{ width: 34, height: 34, fontSize: 10, boxSizing: 'border-box' }}
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
      return 'ring-2 ring-cyan-200';
    case 'SUCCEEDED':
      return 'ring-1 ring-green-200';
    case 'FAILED':
      return 'ring-2 ring-red-200';
    case 'RETRY_SCHEDULED':
      return 'ring-1 ring-yellow-200';
    case 'CANCELED':
      return '';
    default:
      return '';
  }
};

const StepNode: React.FC<NodeProps<WorkflowGraphNodeData>> = ({ data, selected }) => {
  const { t } = useTranslation('msp/workflows');
  const stepType = data.stepType ?? 'unknown';
  const colors = getStepTypeColor(stepType);
  const icon = getStepTypeIcon(stepType);
  const statusClass = statusStyles(data.status);
  const subtitleMono = stepType === 'action.call' || stepType === 'control.if' || stepType === 'state.set';
  const requiredInputCount = data.requiredInputCount ?? 0;
  const unmappedRequiredInputCount = data.unmappedRequiredInputCount ?? 0;
  const hasRequiredInputStatus = stepType === 'action.call' && requiredInputCount > 0;
  const hasUnmappedRequiredInputs = hasRequiredInputStatus && unmappedRequiredInputCount > 0;
  return (
    <div
      className={`relative bg-white dark:bg-[rgb(var(--color-card))] rounded-md border-r border-t border-b border-[rgb(var(--color-border-200))] ${colors.border} shadow-sm px-3 py-2 ${statusClass} ${selected ? 'ring-2 ring-primary-300' : ''}`}
      style={{ width: 260, height: 72, borderLeftWidth: 4, boxSizing: 'border-box' }}
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
          <div className={`text-xs text-gray-500 truncate mt-1 ${subtitleMono ? 'font-mono' : ''}`}>
            {data.subtitle ?? stepType}
          </div>
        </div>
        <div className="flex items-start gap-1">
          {hasRequiredInputStatus && (
            hasUnmappedRequiredInputs ? (
              <div
                className="text-[10px] px-1.5 py-0.5 rounded-full border whitespace-nowrap bg-destructive/10 text-destructive border-destructive/30"
                title={t('graph.mapping.unmappedTitle', {
                  defaultValue: '{{count}} required fields unmapped',
                  count: unmappedRequiredInputCount,
                })}
              >
                {t('graph.mapping.unmappedBadge', {
                  defaultValue: '{{count}} req unmapped',
                  count: unmappedRequiredInputCount,
                })}
              </div>
            ) : (
              <div
                className="inline-flex items-center text-emerald-700/80"
                title={t('graph.mapping.allMapped', { defaultValue: 'All required fields mapped' })}
                aria-label={t('graph.mapping.allMapped', { defaultValue: 'All required fields mapped' })}
              >
                <Link2 className="h-3.5 w-3.5" />
              </div>
            )
          )}
          {data.status && (
            <div className="text-[10px] text-gray-600 whitespace-nowrap">
              {data.status}
            </div>
          )}
        </div>
      </div>

      {selected && data.stepId && data.onRequestDelete && (
        <button
          type="button"
          className="absolute -right-2 -top-2 rounded-full border border-gray-200 dark:border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))] shadow-sm p-1 text-gray-500 hover:text-destructive hover:border-destructive/30"
          aria-label={t('graph.actions.deleteStep', { defaultValue: 'Delete step' })}
          title={t('graph.actions.deleteStep', { defaultValue: 'Delete step' })}
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
  const { t } = useTranslation('msp/workflows');
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
          className={[
            'flex items-center justify-center',
            'rounded-md border shadow-sm bg-white dark:bg-[rgb(var(--color-card))]',
            snapshot.isDraggingOver
              ? 'border-[rgb(var(--color-primary-400))] ring-2 ring-[rgb(var(--color-primary-200))]'
              : 'border-dashed border-[rgb(var(--color-border-200))]'
          ].join(' ')}
          style={{ width: 30, height: 30, boxSizing: 'border-box' }}
          title={t('graph.insert.title', { defaultValue: 'Drop a step here to insert' })}
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

const AlignedVerticalEdge: React.FC<EdgeProps> = ({ id, sourceX, sourceY, targetX, targetY, markerEnd, style }) => {
  const centerX = Math.round(((sourceX + targetX) / 2) * 2) / 2;
  const path = `M ${centerX},${sourceY} L ${centerX},${targetY}`;

  return <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />;
};

const nodeTypes: NodeTypes = {
  workflowStart: StartNode,
  workflowJoin: JoinNode,
  workflowStep: StepNode,
  workflowInsert: InsertNode
};

const edgeTypes: EdgeTypes = {
  workflowAlignedVertical: AlignedVerticalEdge
};

export default function WorkflowGraph<TStep extends { id: string; type: string }>(props: WorkflowGraphProps<TStep>) {
  const {
    steps,
    getLabel,
    getSubtitle,
    statusByStepId,
    inputMappingStatusByStepId,
    selectedStepId,
    onSelectStepId,
    editable = false,
    rootPipePath = 'root',
    onRequestInsertAt,
    onDeleteStepId,
    className
  } = props;

  const { t } = useTranslation('msp/workflows');
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
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
  const inputMappingStatusMap = useMemo(
    () => inputMappingStatusByStepId ?? new Map<string, { requiredCount: number; unmappedRequiredCount: number }>(),
    [inputMappingStatusByStepId]
  );

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
          getSubtitle: getSubtitleRef.current ? (step) => (getSubtitleRef.current?.(step as any) ?? null) : undefined,
          getPipePathForRoot: () => rootPipePath,
          includeInsertions: editable
        });
        if (cancelled) return;
        setNodes(graph.nodes);
        setEdges(graph.edges);
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setBuildError(message || t('graph.errors.buildFailed', { defaultValue: 'Failed to build workflow graph.' }));
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
  }, [editable, rootPipePath, steps, t]);

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
      const inputMappingStatus = stepId ? inputMappingStatusMap.get(stepId) ?? null : null;
      const kind = (node.data as WorkflowGraphNodeData).kind;
      return {
        ...node,
        data: {
          ...(node.data as WorkflowGraphNodeData),
          status,
          requiredInputCount: inputMappingStatus?.requiredCount ?? null,
          unmappedRequiredInputCount: inputMappingStatus?.unmappedRequiredCount ?? null,
          onRequestInsert: (node.data as WorkflowGraphNodeData).kind === 'insert' ? onRequestInsertAt ?? null : null,
          onRequestDelete: kind === 'step' ? onDeleteStepId ?? null : null
        },
        selected: Boolean(stepId && selectedStepId && stepId === selectedStepId)
      };
    });
  }, [inputMappingStatusMap, nodes, onDeleteStepId, onRequestInsertAt, selectedStepId, statusMap]);

  if (loading) {
    return (
      <div className={`w-full h-full flex items-center justify-center text-sm text-gray-500 ${className ?? ''}`}>
        {t('graph.states.buildingGraph', { defaultValue: 'Building graph…' })}
      </div>
    );
  }

  if (buildError) {
    return (
      <div className={`w-full h-full flex items-center justify-center ${className ?? ''}`}>
        <div className="max-w-xl rounded border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <div className="font-semibold">
            {t('graph.errors.renderErrorTitle', { defaultValue: 'Graph render error' })}
          </div>
          <div className="mt-1 font-mono text-[11px] break-words">{buildError}</div>
          <div className="mt-2 text-xs">
            {t('graph.errors.switchToList', { defaultValue: 'Switch to List view to continue editing.' })}
          </div>
        </div>
      </div>
    );
  }

  if (steps.length === 0) {
    if (!editable) {
      return (
        <div className={`w-full h-full flex flex-col items-center justify-center text-center ${className ?? ''}`}>
          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-success/15 border-2 border-success mb-4">
            <Play className="h-5 w-5 text-success ml-0.5" />
          </div>
          <p className="text-sm text-gray-500">
            {t('graph.empty.readonly', { defaultValue: 'Select a step from the panel to get started.' })}
          </p>
        </div>
      );
    }
    return (
      <Droppable droppableId={`insert:${rootPipePath}:0`}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`w-full h-full flex flex-col items-center justify-center text-center transition-colors ${
              snapshot.isDraggingOver
                ? 'bg-[rgb(var(--color-primary-50))] border-2 border-dashed border-[rgb(var(--color-primary-400))]'
                : ''
            } ${className ?? ''}`}
          >
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-success/15 border-2 border-success mb-4">
              <Play className="h-5 w-5 text-success ml-0.5" />
            </div>
            <p className="text-sm text-gray-500">
              {snapshot.isDraggingOver
                ? t('graph.empty.dropFirst', { defaultValue: 'Drop to add as the first step' })
                : t('graph.empty.dragPrompt', { defaultValue: 'Drag a step from the panel, or select one to get started.' })}
            </p>
            <div className="hidden">{provided.placeholder}</div>
          </div>
        )}
      </Droppable>
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
        edgeTypes={edgeTypes}
        className="!bg-white dark:!bg-[rgb(var(--color-card))]"
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
        <Background gap={24} size={1} color={isDark ? '#334155' : '#e5e7eb'} />
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
          nodeColor={() => isDark ? '#475569' : '#ffffff'}
          maskColor={isDark ? 'rgba(15, 23, 42, 0.45)' : undefined}
          style={isDark ? { backgroundColor: '#334155' } : undefined}
          nodeBorderRadius={2}
        />
      </ReactFlow>
    </div>
  );
}
