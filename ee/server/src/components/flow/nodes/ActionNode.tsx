// src/components/nodes/ActionNode.tsx
import React, { memo } from 'react';
import { Handle, NodeProps, Position, useReactFlow } from 'reactflow';
import DeleteButton from '../DeleteButton';
import { ProtoNodeTypes_ActionNodeData } from '../../../generated/workflow';

const ActionNode = ({ data, id }: NodeProps<ProtoNodeTypes_ActionNodeData>) => {
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
      <Handle type="target" position={Position.Left} style={{ left: '-5px' }} />
      <div>
        <strong>{data.label}</strong>
        <div>Action: {data.action?.template}</div>
      </div>
      <Handle type="source" position={Position.Right} style={{ right: '-5px' }} />
    </div>
  );
};

export default memo(ActionNode);
