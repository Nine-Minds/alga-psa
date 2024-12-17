// src/components/nodes/TicketCreatorNode.tsx
import React, { memo, useState, useEffect } from 'react';
import { Handle, NodeProps, Position, useReactFlow } from 'reactflow';
import DeleteButton from '../DeleteButton';
import { TicketCreatorNodeData, Template } from '../../../services/flow/types/workflowTypes';
import InputFieldSelector from '../InputFieldSelector';
import TextAreaFieldSelector from '../TextAreaFieldSelector';
import ComboBoxFieldSelector from '../ComboBoxFieldSelector';

const boardOptions = [
  { id: 'itsupport', label: 'IT Support' },
  { id: 'hrservice', label: 'HR Services' },
  { id: 'facilities', label: 'Facilities Management' },
  { id: 'finance', label: 'Finance Requests' },
];

const priorityOptions = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'urgent', label: 'Urgent' },
];

const TicketCreatorNode = ({ data, id }: NodeProps<TicketCreatorNodeData>) => {
  const { getNode, setNodes } = useReactFlow();
  const node = getNode(id);
  const isSelected = node?.selected ?? false;

  const [nodeData, setNodeData] = useState<TicketCreatorNodeData>({
    label: '🎫 Ticket Creator',
    outputs: [],
    ticketTitle: { template: '', type: { value: '' } },
    ticketDescription: { template: '', type: { value: '' } },
    ticketBoard: { template: '', type: { value: '' } },
    ticketPriority: { template: '', type: { value: '' } },
  });

  useEffect(() => {
    if (data && typeof data === 'object') {
      setNodeData(prevData => ({
        ...prevData,
        ...data,
      }));
    }
  }, [data]);

  const handleInputChange = (name: string, value: string) => {
    const newTemplate: Template = { template: value, type: { value: '' } };
    setNodeData(prev => ({
      ...prev,
      [name]: newTemplate,
    }));
    
    setNodes(nds =>
      nds.map(node => {
        if (node.id === id) {
          return {
            ...node,
            data: {
              ...node.data,
              [name]: newTemplate,
            },
          };
        }
        return node;
      })
    );
  };

  return (
    <div style={styles.container}>
      {isSelected && <DeleteButton nodeId={id} />}
      <Handle type="target" position={Position.Left} style={styles.handle} />
      <div style={styles.title}>{nodeData.label}</div>
      <div style={styles.field}>
        <label htmlFor="ticketTitle" style={styles.label}>Ticket Title:</label>
        <InputFieldSelector
          value={nodeData.ticketTitle || { template: '', type: { value: '' } }}
          onChange={(value) => handleInputChange('ticketTitle', value)}
          inputType="Email"
        />
      </div>
      <div style={styles.field}>
        <label htmlFor="ticketDescription" style={styles.label}>Ticket Description:</label>
        <TextAreaFieldSelector
          value={nodeData.ticketDescription || { template: '', type: { value: '' } }}
          onChange={(value) => handleInputChange('ticketDescription', value)}
          inputType="Email"
          rows={3}
        />
      </div>
      <div style={styles.field}>
        <label htmlFor="ticketBoard" style={styles.label}>Board:</label>
        <ComboBoxFieldSelector
          value={nodeData.ticketBoard || { template: '', type: { value: '' } }}
          onChange={(value) => handleInputChange('ticketBoard', value)}
          options={boardOptions}
          inputType="Email"
          placeholder="Select or enter a board"
        />
      </div>
      <div style={styles.field}>
        <label htmlFor="ticketPriority" style={styles.label}>Priority:</label>
        <ComboBoxFieldSelector
          value={nodeData.ticketPriority || { template: '', type: { value: '' } }}
          onChange={(value) => handleInputChange('ticketPriority', value)}
          options={priorityOptions}
          inputType="Email"
          placeholder="Select or enter a priority"
        />
      </div>
      <Handle type="source" position={Position.Right} style={styles.handle} />
    </div>
  );
};

const styles = {
  container: {
    padding: '15px',
    border: '1px solid #4a4a5e',
    borderRadius: '5px',
    background: '#2a2a3c',
    color: '#ffffff',
    width: '250px',
  },
  title: {
    marginBottom: '15px',
    fontSize: '16px',
    fontWeight: 'bold' as const,
  },
  field: {
    marginBottom: '10px',
  },
  label: {
    display: 'block',
    marginBottom: '5px',
    fontSize: '14px',
    fontWeight: 'normal' as const,
    color: '#b0b0b0',
  },
  handle: {
    background: '#00ffff',
  },
};

export default memo(TicketCreatorNode);
