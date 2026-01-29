import ELK from 'elkjs/lib/elk.bundled';
import type { Step, IfBlock, ForEachBlock, TryCatchBlock } from '@shared/workflow/runtime';
import type { Edge, Node } from 'reactflow';

export type WorkflowGraphNodeKind = 'start' | 'step' | 'join' | 'insert';

export type WorkflowGraphNodeData = {
  kind: WorkflowGraphNodeKind;
  stepId?: string;
  stepType?: string;
  label: string;
  subtitle?: string | null;
  branchLabel?: string | null;
  status?: string | null;
  pipePath?: string | null;
  insertIndex?: number | null;
  onRequestInsert?: ((pipePath: string, index: number) => void) | null;
  onRequestDelete?: ((stepId: string) => void) | null;
};

export type WorkflowGraphBuildOptions = {
  getLabel: (step: Step) => string;
  getSubtitle?: (step: Step) => string | null;
  includeInsertions?: boolean;
  getPipePathForRoot?: () => string;
};

const STEP_WIDTH = 260;
const STEP_HEIGHT = 72;
const JOIN_SIZE = 34;
const START_SIZE = 52;
const INSERT_SIZE = 30;
const EDGE_TYPE: Edge['type'] = 'step';
const EXCLUDE_FROM_LAYOUT = { excludeFromLayout: true } as const;
const NODE_WRAPPER_STYLE = { padding: 0, border: 'none', background: 'transparent', boxShadow: 'none' } as const;

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
    pipePath: string;
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

  const buildInsertionNode = (insertIndex: number): string => {
    const insertNodeId = `${ctx.idPrefix}::insert:${insertIndex}`;

    // Avoid duplicates if a caller reuses the same index.
    if (!ctx.nodes.find((n) => n.id === insertNodeId)) {
      ctx.nodes.push({
        id: insertNodeId,
        type: 'workflowInsert',
        position: { x: 0, y: 0 },
        style: NODE_WRAPPER_STYLE,
        data: {
          kind: 'insert',
          label: '+',
          pipePath: ctx.pipePath,
          insertIndex
        },
        width: INSERT_SIZE,
        height: INSERT_SIZE
      });
    }

    return insertNodeId;
  };

  const shouldIncludeTrailingInsertion = (sequenceSteps: Step[]) => {
    if (!ctx.options.includeInsertions) return false;
    if (sequenceSteps.length === 0) return true;
    return sequenceSteps[sequenceSteps.length - 1]?.type !== 'control.return';
  };

  const buildStep = (step: Step, stepIndex: number): { entry: string; exits: string[] } => {
    const label = ctx.options.getLabel(step);
    const subtitle = ctx.options.getSubtitle ? ctx.options.getSubtitle(step) : step.type;

	    if (step.type === 'control.if') {
	      const ifStep = step as IfBlock;
	      const ifNodeId = `${ctx.idPrefix}${ifStep.id}`;

	      ctx.nodes.push({
	        id: ifNodeId,
	        type: 'workflowStep',
	        position: { x: 0, y: 0 },
	        style: NODE_WRAPPER_STYLE,
	        data: { kind: 'step', stepId: ifStep.id, stepType: ifStep.type, label, subtitle },
	        width: STEP_WIDTH,
	        height: STEP_HEIGHT
	      });

	      const thenSeq = buildSequence(ifStep.then ?? [], {
	        ...ctx,
	        idPrefix: `${ctx.idPrefix}${ifStep.id}:then:`,
	        pipePath: `${ctx.pipePath}.steps[${stepIndex}].then`
	      });
	      const elseSeq = buildSequence(ifStep.else ?? [], {
	        ...ctx,
	        idPrefix: `${ctx.idPrefix}${ifStep.id}:else:`,
	        pipePath: `${ctx.pipePath}.steps[${stepIndex}].else`
	      });

	      const thenHasSteps = (ifStep.then ?? []).length > 0;
	      const elseHasSteps = (ifStep.else ?? []).length > 0;
	      const needsJoin = Boolean(
	        thenHasSteps && elseHasSteps && thenSeq.exits.length > 0 && elseSeq.exits.length > 0
	      );

	      if (needsJoin) {
	        const joinNodeId = `${ctx.idPrefix}${ifStep.id}::join`;
	        ctx.nodes.push({
	          id: joinNodeId,
	          type: 'workflowJoin',
	          position: { x: 0, y: 0 },
	          style: NODE_WRAPPER_STYLE,
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
	        style: NODE_WRAPPER_STYLE,
	        data: { kind: 'step', stepId: tc.id, stepType: tc.type, label, subtitle },
	        width: STEP_WIDTH,
	        height: STEP_HEIGHT
	      });

	      const trySeq = buildSequence(tc.try ?? [], {
	        ...ctx,
	        idPrefix: `${ctx.idPrefix}${tc.id}:try:`,
	        pipePath: `${ctx.pipePath}.steps[${stepIndex}].try`
	      });
	      const catchSeq = buildSequence(tc.catch ?? [], {
	        ...ctx,
	        idPrefix: `${ctx.idPrefix}${tc.id}:catch:`,
	        pipePath: `${ctx.pipePath}.steps[${stepIndex}].catch`
	      });

	      const tryHasSteps = (tc.try ?? []).length > 0;
	      const catchHasSteps = (tc.catch ?? []).length > 0;
	      const needsJoin = Boolean(
	        tryHasSteps && catchHasSteps && trySeq.exits.length > 0 && catchSeq.exits.length > 0
	      );

	      if (needsJoin) {
	        const joinNodeId = `${ctx.idPrefix}${tc.id}::join`;
	        ctx.nodes.push({
	          id: joinNodeId,
	          type: 'workflowJoin',
	          position: { x: 0, y: 0 },
	          style: NODE_WRAPPER_STYLE,
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
        style: NODE_WRAPPER_STYLE,
        data: { kind: 'step', stepId: loop.id, stepType: loop.type, label, subtitle },
        width: STEP_WIDTH,
        height: STEP_HEIGHT
      });
      ctx.nodes.push({
        id: afterNodeId,
        type: 'workflowJoin',
        position: { x: 0, y: 0 },
        style: NODE_WRAPPER_STYLE,
        data: { kind: 'join', label: 'Done' },
        width: JOIN_SIZE,
        height: JOIN_SIZE
      });

      const bodySeq = buildSequence(loop.body ?? [], {
        ...ctx,
        idPrefix: `${ctx.idPrefix}${loop.id}:body:`,
        pipePath: `${ctx.pipePath}.steps[${stepIndex}].body`
      });

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
      style: NODE_WRAPPER_STYLE,
      data: { kind: 'step', stepId: step.id, stepType: step.type, label, subtitle },
      width: STEP_WIDTH,
      height: STEP_HEIGHT
    });

    return step.type === 'control.return' ? { entry: nodeId, exits: [] } : { entry: nodeId, exits: [nodeId] };
  };

  if (ctx.options.includeInsertions) {
    const firstInsertId = buildInsertionNode(0);
    entry = firstInsertId;
    exits = [firstInsertId];

    for (let index = 0; index < steps.length; index++) {
      const insertBeforeStep = buildInsertionNode(index);
      if (exits.length && exits[0] !== insertBeforeStep) connect(exits, insertBeforeStep);
      exits = [insertBeforeStep];

      const built = buildStep(steps[index], index);
      connect(exits, built.entry);
      exits = built.exits;
      if (exits.length === 0) break;

      const hasNext = index < steps.length - 1;
      if (hasNext) {
        const insertAfterStep = buildInsertionNode(index + 1);
        connect(exits, insertAfterStep);
        exits = [insertAfterStep];
      }
    }

    if (exits.length > 0 && shouldIncludeTrailingInsertion(steps)) {
      const insertAtEndId = buildInsertionNode(steps.length);
      if (exits.length && exits[0] !== insertAtEndId) connect(exits, insertAtEndId);
      exits = [insertAtEndId];
    }

    if (steps.length === 0) {
      // Empty sequence: entry == exits (single insertion node).
      exits = [firstInsertId];
    }

    // If a return occurred, the loop exited early and exits is already empty.
  } else {
    steps.forEach((step, idx) => {
      const built = buildStep(step, idx);
      if (!entry) entry = built.entry;
      if (exits.length) {
        connect(exits, built.entry);
      }
      exits = built.exits;
    });
  }

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
    style: NODE_WRAPPER_STYLE,
    data: { kind: 'start', label: 'Start' },
    width: START_SIZE,
    height: START_SIZE
  });

  const rootPipePath = options.getPipePathForRoot ? options.getPipePathForRoot() : 'root';
  const seq = buildSequence(steps ?? [], { nodes, edges, options, idPrefix: 's:', counter, pipePath: rootPipePath });
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

  // Post-process: align simple linear chains to a single x to reduce zig-zag edges.
  // ELK's orthogonal routing can still place sequential nodes with slightly different x values,
  // which makes "step" edges show small horizontal jogs.
  const alignStraightChains = () => {
    const widthById = new Map<string, number>();
    nodes.forEach((node) => {
      widthById.set(node.id, node.width ?? STEP_WIDTH);
    });

    const seqEdges = edges.filter((edge) => {
      if ((edge.data as any)?.excludeFromLayout) return false;
      // Only consider unlabeled sequential edges (branch edges have labels like 'then', 'else', ...).
      return !edge.label;
    });

    const out = new Map<string, string[]>();
    const inDeg = new Map<string, number>();
    const outDeg = new Map<string, number>();

    for (const edge of seqEdges) {
      out.set(edge.source, [...(out.get(edge.source) ?? []), edge.target]);
      inDeg.set(edge.target, (inDeg.get(edge.target) ?? 0) + 1);
      outDeg.set(edge.source, (outDeg.get(edge.source) ?? 0) + 1);
      // Ensure keys exist
      if (!inDeg.has(edge.source)) inDeg.set(edge.source, inDeg.get(edge.source) ?? 0);
      if (!outDeg.has(edge.target)) outDeg.set(edge.target, outDeg.get(edge.target) ?? 0);
    }

    const visited = new Set<string>();

    const snap = (x: number) => Math.round(x / 2) * 2;
    const centerX = (id: string) => {
      const pos = positions.get(id) ?? { x: 0, y: 0 };
      const w = widthById.get(id) ?? STEP_WIDTH;
      return pos.x + w / 2;
    };

    const walkChainFrom = (startId: string) => {
      const chain: string[] = [];
      let current = startId;
      while (!visited.has(current)) {
        visited.add(current);
        chain.push(current);

        const nexts = out.get(current) ?? [];
        if (nexts.length !== 1) break;
        const next = nexts[0];
        // Continue only through nodes that are part of a strict linear chain in this subgraph.
        if ((inDeg.get(next) ?? 0) !== 1) break;
        current = next;
      }
      return chain;
    };

    const nodeIds = Array.from(positions.keys());
    for (const nodeId of nodeIds) {
      if (visited.has(nodeId)) continue;
      const inD = inDeg.get(nodeId) ?? 0;
      const outD = outDeg.get(nodeId) ?? 0;

      // Start chains at "starts" (not strictly linear from a predecessor),
      // but allow single isolated nodes to be visited as well.
      if (inD !== 1 || outD !== 1) {
        const chain = walkChainFrom(nodeId);
        if (chain.length >= 2) {
          const xs = chain.map((id) => centerX(id)).sort((a, b) => a - b);
          const median = xs[Math.floor(xs.length / 2)] ?? 0;
          const alignedCenterX = snap(median);
          chain.forEach((id) => {
            const pos = positions.get(id);
            if (!pos) return;
            const w = widthById.get(id) ?? STEP_WIDTH;
            positions.set(id, { x: alignedCenterX - w / 2, y: pos.y });
          });
        }
      }
    }

    // Any remaining unvisited nodes: mark visited to avoid reprocessing.
    nodeIds.forEach((id) => visited.add(id));
  };

  alignStraightChains();

  const laidOutNodes: Node<WorkflowGraphNodeData>[] = nodes.map((node) => {
    const pos = positions.get(node.id) ?? { x: 0, y: 0 };
    return {
      ...node,
      position: {
        x: node.type === 'workflowInsert' ? pos.x + 1 : pos.x,
        y: pos.y
      }
    };
  });

  return { nodes: laidOutNodes, edges };
}
