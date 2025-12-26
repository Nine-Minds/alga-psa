import ELK from 'elkjs/lib/elk.bundled';
import type { Step, IfBlock, ForEachBlock, TryCatchBlock } from '@shared/workflow/runtime';
import type { Edge, Node } from 'reactflow';

export type WorkflowGraphNodeKind = 'start' | 'step' | 'join';

export type WorkflowGraphNodeData = {
  kind: WorkflowGraphNodeKind;
  stepId?: string;
  stepType?: string;
  label: string;
  subtitle?: string | null;
  branchLabel?: string | null;
  status?: string | null;
};

export type WorkflowGraphBuildOptions = {
  getLabel: (step: Step) => string;
  getSubtitle?: (step: Step) => string | null;
};

const STEP_WIDTH = 260;
const STEP_HEIGHT = 72;
const JOIN_SIZE = 34;
const START_SIZE = 52;
const EDGE_TYPE: Edge['type'] = 'step';
const EXCLUDE_FROM_LAYOUT = { excludeFromLayout: true } as const;

type InternalNode = Node<WorkflowGraphNodeData> & { width?: number; height?: number };

type GraphBuildResult = {
  nodes: InternalNode[];
  edges: Edge[];
};

const buildSequence = (
  steps: Step[],
  ctx: {
    nodes: InternalNode[];
    edges: Edge[];
    options: WorkflowGraphBuildOptions;
    idPrefix: string;
    counter: { n: number };
  }
): { entry: string | null; exits: string[] } => {
  let entry: string | null = null;
  let exits: string[] = [];

  const connect = (fromIds: string[], toId: string, label?: string) => {
    fromIds.forEach((fromId) => {
      const edge: Edge = {
        id: `e:${fromId}->${toId}:${ctx.counter.n++}`,
        source: fromId,
        target: toId,
        sourceHandle: 'out',
        targetHandle: 'in',
        type: EDGE_TYPE,
        label,
        style: { strokeWidth: 1.5 }
      };
      if (label) {
        edge.labelStyle = { fontSize: 11, fill: '#6b7280' };
        edge.labelBgStyle = { fill: '#ffffff', opacity: 0.9 };
        edge.labelBgPadding = [6, 3];
        edge.labelBgBorderRadius = 6;
      }
      ctx.edges.push(edge);
    });
  };

  const buildStep = (step: Step): { entry: string; exits: string[] } => {
    const label = ctx.options.getLabel(step);
    const subtitle = ctx.options.getSubtitle ? ctx.options.getSubtitle(step) : step.type;

	    if (step.type === 'control.if') {
	      const ifStep = step as IfBlock;
	      const ifNodeId = `${ctx.idPrefix}${ifStep.id}`;

	      ctx.nodes.push({
	        id: ifNodeId,
	        type: 'workflowStep',
	        position: { x: 0, y: 0 },
	        data: { kind: 'step', stepId: ifStep.id, stepType: ifStep.type, label, subtitle },
	        width: STEP_WIDTH,
	        height: STEP_HEIGHT
	      });

	      const thenSeq = buildSequence(ifStep.then ?? [], { ...ctx, idPrefix: `${ctx.idPrefix}${ifStep.id}:then:` });
	      const elseSeq = buildSequence(ifStep.else ?? [], { ...ctx, idPrefix: `${ctx.idPrefix}${ifStep.id}:else:` });

	      const needsJoin = Boolean(
	        thenSeq.entry && thenSeq.exits.length > 0 && elseSeq.entry && elseSeq.exits.length > 0
	      );

	      if (needsJoin) {
	        const joinNodeId = `${ctx.idPrefix}${ifStep.id}::join`;
	        ctx.nodes.push({
	          id: joinNodeId,
	          type: 'workflowJoin',
	          position: { x: 0, y: 0 },
	          data: { kind: 'join', label: 'Join' },
	          width: JOIN_SIZE,
	          height: JOIN_SIZE
	        });

	        connect([ifNodeId], thenSeq.entry!, 'then');
	        connect([ifNodeId], elseSeq.entry!, 'else');
	        connect(thenSeq.exits, joinNodeId);
	        connect(elseSeq.exits, joinNodeId);
	        return { entry: ifNodeId, exits: [joinNodeId] };
	      }

	      const exitsToNext: string[] = [];
	      if (thenSeq.entry) {
	        connect([ifNodeId], thenSeq.entry, 'then');
	        if (thenSeq.exits.length) exitsToNext.push(...thenSeq.exits);
	      } else {
	        exitsToNext.push(ifNodeId);
	      }

	      if (elseSeq.entry) {
	        connect([ifNodeId], elseSeq.entry, 'else');
	        if (elseSeq.exits.length) exitsToNext.push(...elseSeq.exits);
	      } else {
	        exitsToNext.push(ifNodeId);
	      }

	      return { entry: ifNodeId, exits: Array.from(new Set(exitsToNext)) };
	    }

	    if (step.type === 'control.tryCatch') {
	      const tc = step as TryCatchBlock;
	      const tcNodeId = `${ctx.idPrefix}${tc.id}`;

	      ctx.nodes.push({
	        id: tcNodeId,
	        type: 'workflowStep',
	        position: { x: 0, y: 0 },
	        data: { kind: 'step', stepId: tc.id, stepType: tc.type, label, subtitle },
	        width: STEP_WIDTH,
	        height: STEP_HEIGHT
	      });

	      const trySeq = buildSequence(tc.try ?? [], { ...ctx, idPrefix: `${ctx.idPrefix}${tc.id}:try:` });
	      const catchSeq = buildSequence(tc.catch ?? [], { ...ctx, idPrefix: `${ctx.idPrefix}${tc.id}:catch:` });

	      const needsJoin = Boolean(
	        trySeq.entry && trySeq.exits.length > 0 && catchSeq.entry && catchSeq.exits.length > 0
	      );

	      if (needsJoin) {
	        const joinNodeId = `${ctx.idPrefix}${tc.id}::join`;
	        ctx.nodes.push({
	          id: joinNodeId,
	          type: 'workflowJoin',
	          position: { x: 0, y: 0 },
	          data: { kind: 'join', label: 'Join' },
	          width: JOIN_SIZE,
	          height: JOIN_SIZE
	        });

	        connect([tcNodeId], trySeq.entry!, 'try');
	        connect([tcNodeId], catchSeq.entry!, 'catch');
	        connect(trySeq.exits, joinNodeId);
	        connect(catchSeq.exits, joinNodeId);
	        return { entry: tcNodeId, exits: [joinNodeId] };
	      }

	      const exitsToNext: string[] = [];
	      if (trySeq.entry) {
	        connect([tcNodeId], trySeq.entry, 'try');
	        if (trySeq.exits.length) exitsToNext.push(...trySeq.exits);
	      } else {
	        exitsToNext.push(tcNodeId);
	      }

	      if (catchSeq.entry) {
	        connect([tcNodeId], catchSeq.entry, 'catch');
	        if (catchSeq.exits.length) exitsToNext.push(...catchSeq.exits);
	      } else {
	        exitsToNext.push(tcNodeId);
	      }

	      return { entry: tcNodeId, exits: Array.from(new Set(exitsToNext)) };
	    }

    if (step.type === 'control.forEach') {
      const loop = step as ForEachBlock;
      const loopNodeId = `${ctx.idPrefix}${loop.id}`;
      const afterNodeId = `${ctx.idPrefix}${loop.id}::after`;

      ctx.nodes.push({
        id: loopNodeId,
        type: 'workflowStep',
        position: { x: 0, y: 0 },
        data: { kind: 'step', stepId: loop.id, stepType: loop.type, label, subtitle },
        width: STEP_WIDTH,
        height: STEP_HEIGHT
      });
      ctx.nodes.push({
        id: afterNodeId,
        type: 'workflowJoin',
        position: { x: 0, y: 0 },
        data: { kind: 'join', label: 'Done' },
        width: JOIN_SIZE,
        height: JOIN_SIZE
      });

      const bodySeq = buildSequence(loop.body ?? [], { ...ctx, idPrefix: `${ctx.idPrefix}${loop.id}:body:` });

      if (bodySeq.entry) {
        connect([loopNodeId], bodySeq.entry, 'each');
        (bodySeq.exits.length ? bodySeq.exits : [bodySeq.entry]).forEach((exitId) => {
          ctx.edges.push({
            id: `e:${exitId}->${loopNodeId}:loop:${ctx.counter.n++}`,
            source: exitId,
            target: loopNodeId,
            sourceHandle: 'out',
            targetHandle: 'in',
            type: EDGE_TYPE,
            label: 'next',
            style: { strokeWidth: 1.25, strokeDasharray: '6 4' },
            labelStyle: { fontSize: 11, fill: '#6b7280' },
            labelBgStyle: { fill: '#ffffff', opacity: 0.9 },
            labelBgPadding: [6, 3],
            labelBgBorderRadius: 6,
            data: EXCLUDE_FROM_LAYOUT
          });
        });
      }

      connect([loopNodeId], afterNodeId, 'done');
      return { entry: loopNodeId, exits: [afterNodeId] };
    }

    const nodeId = `${ctx.idPrefix}${step.id}`;
    ctx.nodes.push({
      id: nodeId,
      type: 'workflowStep',
      position: { x: 0, y: 0 },
      data: { kind: 'step', stepId: step.id, stepType: step.type, label, subtitle },
      width: STEP_WIDTH,
      height: STEP_HEIGHT
    });

    return step.type === 'control.return' ? { entry: nodeId, exits: [] } : { entry: nodeId, exits: [nodeId] };
  };

  steps.forEach((step) => {
    const built = buildStep(step);
    if (!entry) entry = built.entry;
    if (exits.length) {
      connect(exits, built.entry);
    }
    exits = built.exits;
  });

  return { entry, exits };
};

export async function buildWorkflowGraph(
  steps: Step[],
  options: WorkflowGraphBuildOptions
): Promise<{ nodes: Node<WorkflowGraphNodeData>[]; edges: Edge[] }> {
  const nodes: InternalNode[] = [];
  const edges: Edge[] = [];
  const counter = { n: 1 };

  const startId = 'workflow::start';
  nodes.push({
    id: startId,
    type: 'workflowStart',
    position: { x: 0, y: 0 },
    data: { kind: 'start', label: 'Start' },
    width: START_SIZE,
    height: START_SIZE
  });

  const seq = buildSequence(steps ?? [], { nodes, edges, options, idPrefix: 's:', counter });
  if (seq.entry) {
    edges.push({
      id: `e:${startId}->${seq.entry}:start`,
      source: startId,
      target: seq.entry,
      sourceHandle: 'out',
      targetHandle: 'in',
      type: EDGE_TYPE,
      style: { strokeWidth: 1.5 }
    });
  }

  const elk = new ELK();
  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      // Top-down works better for our narrow center column.
      'elk.direction': 'DOWN',
      'elk.layered.spacing.nodeNodeBetweenLayers': '70',
      'elk.spacing.nodeNode': '40',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP'
    },
    children: nodes.map((node) => ({
      id: node.id,
      width: node.width ?? STEP_WIDTH,
      height: node.height ?? STEP_HEIGHT
    })),
    // ELK layered layout doesn't like cycles; exclude loopback edges from layout.
    edges: edges
      .filter((edge) => !(edge.data as any)?.excludeFromLayout)
      .map((edge) => ({
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target]
      }))
  };

  let positions = new Map<string, { x: number; y: number }>();
  try {
    const layout = await elk.layout(elkGraph as any);
    (layout.children ?? []).forEach((child: any) => {
      positions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
    });
  } catch {
    // Fallback: simple horizontal flow layout in creation order (still renders something).
    const spacingX = 120;
    const spacingY = 40;
    let x = 0;
    let y = 0;
    nodes.forEach((node, idx) => {
      positions.set(node.id, { x, y });
      x += (node.width ?? STEP_WIDTH) + spacingX;
      if (idx % 6 === 5) {
        x = 0;
        y += (node.height ?? STEP_HEIGHT) + spacingY;
      }
    });
  }

  const laidOutNodes: Node<WorkflowGraphNodeData>[] = nodes.map((node) => {
    const pos = positions.get(node.id) ?? { x: 0, y: 0 };
    return {
      ...node,
      position: { x: pos.x, y: pos.y }
    };
  });

  return { nodes: laidOutNodes, edges };
}
