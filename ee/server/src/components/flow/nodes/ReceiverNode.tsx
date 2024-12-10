// src/components/nodes/ReceiverNode.tsx
import React, { memo } from 'react';
import { Handle, NodeProps, Position, useReactFlow } from 'reactflow';
import DeleteButton from '../DeleteButton';
import { ProtoNodeTypes_Office365ReceiverNodeData } from '../../../generated/workflow';

const ReceiverNode = ({ data, id }: NodeProps<ProtoNodeTypes_Office365ReceiverNodeData>) => {
  const { getNode } = useReactFlow();
  const node = getNode(id);
  const isSelected = node?.selected ?? false;

  return (
    <div
      style={{
        padding: '10px',
        border: isSelected ? '2px solid #00ffff' : '1px solid #ddd',
        borderRadius: '5px',
        boxShadow: isSelected ? '0 0 10px #00ffff' : 'none',
      }}
    >
      {isSelected && <DeleteButton nodeId={id} />}
      <div>
        <strong>{data.label}</strong>
        <div>Client ID: {data.clientId?.template}</div>
        <div>User Email: {data.userEmail?.template}</div>
      </div>
      <Handle type="source" position={Position.Right} style={{ right: '-5px' }} />
    </div>
  );
};

export default memo(ReceiverNode);
