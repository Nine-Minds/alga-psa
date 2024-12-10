// src/components/nodes/Office365ReceiverNode.tsx
import React, { memo, useState, useEffect } from 'react';
import { Handle, NodeProps, Position, useReactFlow } from 'reactflow';
import DeleteButton from '../DeleteButton';
import { ProtoNodeTypes_Office365ReceiverNodeData, Template } from '../../../generated/workflow';
import InputFieldSelector from '../InputFieldSelector';

const Office365ReceiverNode = ({ data, id }: NodeProps<ProtoNodeTypes_Office365ReceiverNodeData>) => {
  const { getNode, setNodes } = useReactFlow();
  const node = getNode(id);
  const isSelected = node?.selected ?? false;

  const [nodeData, setNodeData] = useState<ProtoNodeTypes_Office365ReceiverNodeData>({
    clientId: { template: '' },
    clientSecret: { template: '' },
    tenantId: { template: '' },
    userEmail: { template: '' },
    label: '📩 Office 365 Receiver',
    outputs: [],
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
    const newTemplate: Template = { template: value };
    setNodeData(prev => ({ ...prev, [name]: newTemplate }));
    
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
    <div
      style={{
        padding: '15px',
        border: isSelected ? '2px solid #00ffff' : '1px solid #4a4a5e',
        borderRadius: '5px',
        boxShadow: isSelected ? '0 0 10px #00ffff' : 'none',
        background: '#2a2a3c',
        color: '#ffffff',
        width: '250px',
      }}
    >
      {isSelected && <DeleteButton nodeId={id} />}
      <div style={{ marginBottom: '15px', fontSize: '16px', fontWeight: 'bold' }}>
        {nodeData.label}
      </div>
      <div style={{ marginBottom: '10px' }}>
        <label htmlFor="clientId" style={{ display: 'block', marginBottom: '5px' }}>
          Client ID:
        </label>
        <InputFieldSelector
          value={nodeData.clientId || { template: '' }}
          onChange={(value) => handleInputChange('clientId', value)}
          inputType="Email"
        />        
      </div>
      <div style={{ marginBottom: '10px' }}>
        <label htmlFor="clientSecret" style={{ display: 'block', marginBottom: '5px' }}>
          Client Secret:
        </label>
        <InputFieldSelector
          value={nodeData.clientSecret || { template: '' }}
          onChange={(value) => handleInputChange('clientSecret', value)}
          inputType="Email"
        />
      </div>
      <div style={{ marginBottom: '10px' }}>
        <label htmlFor="tenantId" style={{ display: 'block', marginBottom: '5px' }}>
          Tenant ID:
        </label>
        <InputFieldSelector
          value={nodeData.tenantId || { template: '' }}
          onChange={(value) => handleInputChange('tenantId', value)}
          inputType="Email"
        />
      </div>
      <div style={{ marginBottom: '10px' }}>
        <label htmlFor="userEmail" style={{ display: 'block', marginBottom: '5px' }}>
          User Email:
        </label>
        <InputFieldSelector
          value={nodeData.userEmail || { template: '' }}
          onChange={(value) => handleInputChange('userEmail', value)}
          inputType="Email"
        />
      </div>
      <Handle type="source" position={Position.Right} style={{ right: '-8px', background: '#00ffff' }} />
    </div>
  );
};

export default memo(Office365ReceiverNode);
