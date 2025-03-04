// src/components/DnDFlow.tsx
'use client';

import React, { useState, useCallback, DragEvent as ReactDragEvent, useEffect } from 'react';
import ReactFlow, {
  addEdge,
  Edge as ReactFlowEdge,
  Connection,
  NodeTypes as ReactFlowNodeTypes,
  OnConnect,
  ReactFlowProvider,
  ReactFlowInstance,
  useNodesState,
  useEdgesState,
  Controls,
  Background,  
  Node as ReactFlowNode,
  EdgeChange,
  EdgeRemoveChange,
  applyEdgeChanges  
} from 'reactflow';
import { v4 as uuidv4 } from 'uuid';
import 'reactflow/dist/style.css';
import '../../components/flow/styles/DarkTheme.css';
import { NodeTypes, CustomNode } from '../../services/flow/types/nodes';
import ThinkingNode from '../../components/flow/nodes/ThinkingNode';
import ActionNode from '../../components/flow/nodes/ActionNode';
import Office365ReceiverNode from '../../components/flow/nodes/Office365ReceiverNode';
import ClassifierNode from '../../components/flow/nodes/ClassifierNode';
import TicketCreatorNode from '../../components/flow/nodes/TicketCreatorNode';
import DecisionNode from '../../components/flow/nodes/DecisionNode';
import SelectorNode from '../../components/flow/nodes/SelectorNode';
import Sidebar from '../../components/flow/Sidebar';
import TopBar from '../../components/flow/TopBar';
import {
  ThinkingNodeData,
  ActionNodeData,
  Office365ReceiverNodeData,
  ClassifierNodeData,
  TicketCreatorNodeData,
  DecisionNodeData,
  SelectorNodeData,
  Template,
  ConditionType
} from '../../services/flow/types/workflowTypes';

interface WorkflowNode {
  id: string;
  type: NodeTypes;
  label: string;
  x_position: number;
  y_position: number;
  properties: any;
  outputs: Array<{ id: string; label: string }>;
}

interface WorkflowEdge {
  id: string;
  source_node_id: string;
  target_node_id: string;
  source_output_id: string | null;
  target_input_id: string | null;
}

interface Workflow {
  id: string;
  name: string;
  description: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  enabled?: boolean;
}

interface WorkflowVersionResponse {
  workflow: {
    id: number;
    enabled: boolean;
  };
  name: string;
  description: string | null;
  nodes: Array<{
    node_id: string;
    type: string;
    label: string | null;
    x_position: number;
    y_position: number;
    properties: Array<{ id: number; key: string; value: string | null }>;
    outputs: Array<{ output_key: string; label: string | null }>;
  }>;
  edges: Array<{
    edge_id: string;
    source_node_id: string;
    target_node_id: string;
    source_output_id: string | null;
    target_input_id: string | null;
  }>;
}

interface DndFlowProps {
  initialWorkflowVersion?: WorkflowVersionResponse;
}

const nodeTypes: ReactFlowNodeTypes = {
  thinking: ThinkingNode,
  action: ActionNode,
  office365Receiver: Office365ReceiverNode,
  classifier: ClassifierNode,
  ticketCreator: TicketCreatorNode,
  decision: DecisionNode,
  selector: SelectorNode,
};

const createTemplate = (value: string): Template => ({
  template: value,
  type: { value: '' }
});

const initialNodes: CustomNode[] = [
  {
    id: uuidv4(),
    type: 'office365Receiver',
    data: {
      label: '📩 Office 365 Receiver',
      clientId: createTemplate(''),
      clientSecret: createTemplate(''),
      tenantId: createTemplate(''),
      userEmail: createTemplate(''),
      outputs: [],
    } as Office365ReceiverNodeData,
    position: { x: 0, y: 50 },
  },
];

const initialEdges: ReactFlowEdge[] = [];

function convertToNodeProperties(type: NodeTypes, props: Array<{ id: number, key: string, value: string|null }>): any {
  // Convert array of props to an object for easier access
  const propsObject = props.reduce((acc, prop) => {
    acc[prop.key] = prop.value ?? '';
    return acc;
  }, {} as Record<string, string>);

  switch (type) {
    case 'office365Receiver':
      return {
        clientId: createTemplate(propsObject.clientId || ''),
        clientSecret: createTemplate(propsObject.clientSecret || ''),
        tenantId: createTemplate(propsObject.tenantId || ''),
        userEmail: createTemplate(propsObject.userEmail || ''),
      };
    case 'thinking':
      return {
        thinkingProcess: createTemplate(propsObject.thinkingProcess || ''),
      };
    case 'action':
      return {
        action: createTemplate(propsObject.action || ''),
      };
    case 'classifier':
      return {
        thinkingProcess: createTemplate(propsObject.thinkingProcess || ''),
        classifications: propsObject.classifications ? 
          JSON.parse(propsObject.classifications).map((c: string) => createTemplate(c)) : [],
      };
    case 'decision':
      const conditions: Record<string, { type: ConditionType; value: Template }> = {};
      const conditionsObj = propsObject.conditions ? JSON.parse(propsObject.conditions) : {};
      for (const [key, value] of Object.entries(conditionsObj)) {
        if (typeof value === 'object' && value !== null && 'type' in value && 'value' in value) {
          conditions[key] = {
            type: value.type as ConditionType,
            value: createTemplate(String(value.value) || ''),
          };
        }
      }
      return {
        conditions,
        defaultOutput: createTemplate(propsObject.defaultOutput || ''),
      };
    case 'selector':
      return {
        inputs: propsObject.inputs ? JSON.parse(propsObject.inputs).map((input: any) => ({
          id: input.id || '',
          label: input.label || '',
        })) : [],
        defaultInput: createTemplate(propsObject.defaultInput || ''),
      };
    case 'ticketCreator':
      return {
        ticketTitle: createTemplate(propsObject.ticketTitle || ''),
        ticketDescription: createTemplate(propsObject.ticketDescription || ''),
        ticketBoard: createTemplate(propsObject.ticketBoard || ''),
        ticketPriority: createTemplate(propsObject.ticketPriority || ''),
      };
    default:
      throw new Error(`Invalid node type: ${type}`);
  }
}

function convertToNodeType(type: string): NodeTypes {
  switch (type) {
    case 'thinking': return 'thinking';
    case 'action': return 'action';
    case 'office365Receiver': return 'office365Receiver';
    case 'classifier': return 'classifier';
    case 'ticketCreator': return 'ticketCreator';
    case 'decision': return 'decision';
    case 'selector': return 'selector';
    default:
      throw new Error(`Invalid node type: ${type}`);
  }
}

export function convertWorkflowVersionResponseToWorkflow(workflowVersionResponse: WorkflowVersionResponse): Workflow {
  return {
    id: workflowVersionResponse.workflow.id.toString(),
    name: workflowVersionResponse.name,
    description: workflowVersionResponse.description ?? "",
    enabled: workflowVersionResponse.workflow.enabled,
    nodes: workflowVersionResponse.nodes.map(node => {      
      return {
        id: node.node_id,
        type: convertToNodeType(node.type),
        label: node.label || '',
        x_position: node.x_position || 0,
        y_position: node.y_position || 0,
        properties: convertToNodeProperties(convertToNodeType(node.type), node.properties),
        outputs: node.outputs.map(output => ({ id: output.output_key, label: output.label || '' })),
      };
    }),
    edges: workflowVersionResponse.edges.map(edge => ({
      id: edge.edge_id,
      source_node_id: edge.source_node_id,
      target_node_id: edge.target_node_id,
      source_output_id: edge.source_output_id || null,
      target_input_id: edge.target_input_id || null,
    })),
  };
}

const DnDFlow: React.FC<DndFlowProps> = ({ initialWorkflowVersion }) => {
  const initialWorkflow = initialWorkflowVersion ? 
    convertWorkflowVersionResponseToWorkflow(initialWorkflowVersion) : undefined;

  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [workflowId, setWorkflowId] = useState<string | null>(initialWorkflow?.id || null);
  const [workflowName, setWorkflowName] = useState(initialWorkflow?.name || 'New Workflow');
  const [workflowDescription, setWorkflowDescription] = useState(initialWorkflow?.description || '');

  const [workflow, setWorkflow] = useState<Workflow>(initialWorkflow || {
    id: "0",
    name: 'New Workflow',
    description: '',
    nodes: [],
    edges: [],
  });

  const convertToReactFlowNode = (node: WorkflowNode): ReactFlowNode => ({
    id: node.id,
    type: node.type,
    position: { x: node.x_position, y: node.y_position },
    data: { ...node.properties, label: node.label, outputs: node.outputs },
  });

  const convertToReactFlowEdge = (edge: WorkflowEdge): ReactFlowEdge => ({
    id: edge.id,
    source: edge.source_node_id,
    target: edge.target_node_id,
    sourceHandle: edge.source_output_id,
    targetHandle: edge.target_input_id,
  });

  const [nodes, setNodes, onNodesChange] = useNodesState(
    workflow.nodes.map(convertToReactFlowNode)
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    workflow.edges.map(convertToReactFlowEdge)
  );

  const onNodesDelete = useCallback((nodesToDelete: ReactFlowNode[]) => {
    setNodes((nds) => nds.filter((node) => !nodesToDelete.some((n) => n.id === node.id)));
    setEdges((eds) => eds.filter((edge) => !nodesToDelete.some((n) => n.id === edge.source || n.id === edge.target)));
  }, [setNodes, setEdges]);

  const onConnect: OnConnect = useCallback(
    (params: Connection) => {
      const newEdge: WorkflowEdge = {
        id: uuidv4(),
        source_node_id: params.source || '',
        target_node_id: params.target || '',
        source_output_id: params.sourceHandle || null,
        target_input_id: params.targetHandle || null,
      };

      setWorkflow((prev) => ({
        ...prev,
        edges: [...prev.edges, newEdge],
      }));

      setEdges((eds) => addEdge(convertToReactFlowEdge(newEdge), eds));
    },
    [setWorkflow, setEdges]
  );

  const onDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }, []);

  const onEdgesDelete = useCallback(
    (edgesToDelete: ReactFlowEdge[]) => {
      setWorkflow((prev) => ({
        ...prev,
        edges: prev.edges.filter(
          (edge) => !edgesToDelete.some((e) => e.id === edge.id)
        ),
      }));
    },
    [setWorkflow]
  );

  const createNodeData = (type: NodeTypes): any => {
    switch (type) {
      case 'thinking':
        return {
          label: '🤔 Thinking',
          outputs: [],
          thinkingProcess: createTemplate(''),
        } as ThinkingNodeData;
      case 'action':
        return {
          label: '⚡ Action',
          outputs: [],
          action: createTemplate(''),
        } as ActionNodeData;
      case 'classifier':
        return {
          label: '🏷️ Classifier',
          outputs: [],
          source: createTemplate(''),
          thinkingProcess: createTemplate(''),
          classifications: [],
        } as ClassifierNodeData;
      case 'ticketCreator':
        return {
          label: '🎫 Ticket Creator',
          outputs: [],
          ticketTitle: createTemplate(''),
          ticketDescription: createTemplate(''),
          ticketBoard: createTemplate(''),
          ticketPriority: createTemplate(''),
        } as TicketCreatorNodeData;
      case 'office365Receiver':
        return {
          label: '📩 Office 365 Receiver',
          outputs: [],
          clientId: createTemplate(''),
          clientSecret: createTemplate(''),
          tenantId: createTemplate(''),
          userEmail: createTemplate(''),
        } as Office365ReceiverNodeData;
      case 'decision':
        return {
          label: '🔀 Decision',
          outputs: [],
          conditions: {},
          defaultOutput: createTemplate(''),
        } as DecisionNodeData;
      case 'selector':
        return {
          label: '📋 Selector',
          outputs: [],
          inputs: [],
          defaultInput: createTemplate(''),
        } as SelectorNodeData;
      default:
        throw new Error(`Unsupported node type: ${type}`);
    }
  };

  const onDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      event.preventDefault();

      const type = event.dataTransfer?.getData('application/reactflow') as NodeTypes;

      if (typeof type === 'undefined' || !type) {
        return;
      }

      const position = reactFlowInstance?.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      if (position) {
        const newNode: CustomNode = {
          id: uuidv4(),
          type,
          position,
          data: createNodeData(type),
        };

        setNodes((nds) => nds.concat(newNode));
      }
    },
    [reactFlowInstance, setNodes]
  );

  const onSave = useCallback(async () => {
    const workflowData = {
      name: workflowName,
      description: workflowDescription,
      nodes: nodes.map(node => ({
        id: node.id,
        type: node.type as NodeTypes,
        label: node.data.label,
        x_position: node.position.x,
        y_position: node.position.y,
        properties: node.data,
        outputs: node.data.outputs || [],
      })),
      edges: edges.map(edge => ({
        id: edge.id,
        source_node_id: edge.source,
        target_node_id: edge.target,
        source_output_id: edge.sourceHandle || null,
        target_input_id: edge.targetHandle || null,
      })),
    };

    try {
      const isNewWorkflow = !workflowId || workflowId === "0";
      const url = isNewWorkflow ? '/api/workflows' : `/api/workflows/${workflowId}`;
      const method = isNewWorkflow ? 'POST' : 'PUT';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(workflowData),
      });

      if (!response.ok) {
        throw new Error('Failed to save workflow');
      }

      const result = await response.json();
      setWorkflowId(result.id);
      setWorkflow({
        ...result,
        nodes: workflowData.nodes,
        edges: workflowData.edges,
      });
      alert('Workflow saved successfully!');
    } catch (error) {
      console.error('Error saving workflow:', error);
      alert('Failed to save workflow. Please try again.');
    }
  }, [workflowId, workflowName, workflowDescription, nodes, edges]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Delete') {
        reactFlowInstance?.deleteElements({ edges: reactFlowInstance.getEdges().filter(e => e.selected) });
      }
    };

    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [reactFlowInstance]);

  return (
    <div className="dndflow">
      <div className="banner-row">
        <h1>Workflow Designer</h1>
      </div>
      <div className="topbar-row">
        <TopBar
          workflowName={workflowName}
          setWorkflowName={setWorkflowName}
          workflowDescription={workflowDescription}
          setWorkflowDescription={setWorkflowDescription}
          onSave={onSave}
        />
      </div>
      <div className="content-row">
        <Sidebar />
        <div className="reactflow-wrapper">
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onInit={setReactFlowInstance}
              onDrop={onDrop}
              onDragOver={onDragOver}
              nodeTypes={nodeTypes}
              fitView
              onNodesDelete={onNodesDelete}
              onEdgesDelete={onEdgesDelete}
            >
              <Controls />
              <Background color="#4a4a5e" gap={16} />
            </ReactFlow>
          </ReactFlowProvider>
        </div>
      </div>
    </div>
  );
};

export default DnDFlow;
