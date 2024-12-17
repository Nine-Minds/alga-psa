import React, { memo, useCallback } from 'react';
import { Handle, Position, NodeProps, useReactFlow } from 'reactflow';
import DeleteButton from '../DeleteButton';
import { v4 as uuidv4 } from 'uuid';
import { SelectorNodeData, Input, Template } from '../../../services/flow/types/workflowTypes';

const SelectorNode = memo(({ data, id }: NodeProps<SelectorNodeData>) => {
  const { getNode, setNodes } = useReactFlow();
  const node = getNode(id);
  const isSelected = node?.selected ?? false;

  const addInput = useCallback(() => {
    const newInput: Input = {
      id: uuidv4(),
      label: `Input ${data.inputs.length + 1}`,
    };

    setNodes(nds =>
      nds.map(node => {
        if (node.id === id) {
          return {
            ...node,
            data: {
              ...node.data,
              inputs: [...data.inputs, newInput]
            }
          };
        }
        return node;
      })
    );
  }, [id, data.inputs, setNodes]);

  return (
    <div className="px-4 py-2 shadow-md rounded-md bg-[#2a2a3c] border-2 border-[#4a4a5e] text-white">
      {isSelected && <DeleteButton nodeId={id} />}
      <div className="flex justify-between items-center mb-2">
        <div className="rounded-full w-3 h-3 bg-[#00ffff]" />
        <div className="ml-2">
          <div className="text-lg font-bold">Selector: {data.label}</div>
        </div>
      </div>
      
      {data.inputs.map((input, index) => (
        <div key={input.id} className="mt-2 relative">
          <Handle
            type="target"
            position={Position.Left}
            id={input.id}
            className="w-3 h-3 !bg-[#00ffff]"
            style={{ left: '-12px', top: '50%' }}
          />
          <label className="block text-sm font-medium text-gray-300">{input.label}</label>
        </div>
      ))}

      <button
        onClick={addInput}
        className="mt-2 px-2 py-1 bg-[#00ffff] text-[#2a2a3c] rounded"
      >
        Add Input
      </button>

      <div className="mt-2 relative">
        <label className="block text-sm font-medium text-gray-300">Default Input</label>
        <input
          type="text"
          value={data.defaultInput?.template || ''}
          onChange={(e) => {
            const newDefaultInput: Template = { template: e.target.value, type: { value: '' } };
            setNodes(nds =>
              nds.map(node => node.id === id ? { ...node, data: { ...node.data, defaultInput: newDefaultInput } } : node)
            );
          }}
          className="mt-1 block w-full shadow-sm sm:text-sm border-[#4a4a5e] rounded-md bg-[#3a3a4c] text-white"
        />
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className="w-3 h-3 !bg-[#00ffff]"
        style={{ right: '-12px', top: '50%' }}
      />
    </div>
  );
});

SelectorNode.displayName = 'SelectorNode';

export default SelectorNode;
