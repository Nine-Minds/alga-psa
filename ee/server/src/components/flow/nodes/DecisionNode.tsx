// src/components/nodes/DecisionNode.tsx

import React, { memo, useState, useEffect } from 'react';
import { Handle, Position, NodeProps, useReactFlow } from 'reactflow';
import DeleteButton from '../DeleteButton';
import Picker from '../Picker';
import { ProtoNodeTypes_DecisionNodeData, ProtoNodeTypes_Condition_ConditionType } from '../../../generated/workflow';
import { PickerOption } from '../../../services/flow/types/nodes';

const conditionOptions: PickerOption[] = [
  { id: ProtoNodeTypes_Condition_ConditionType.EQUALS.toString(), label: 'Equals' },
  { id: ProtoNodeTypes_Condition_ConditionType.THRESHOLD.toString(), label: 'Threshold' },
  { id: ProtoNodeTypes_Condition_ConditionType.REGEX.toString(), label: 'Regex' },
];

const DecisionNode = memo(({ data, id }: NodeProps<ProtoNodeTypes_DecisionNodeData>) => {
  const { getNode, setNodes } = useReactFlow();
  const node = getNode(id);
  const isSelected = node?.selected ?? false;

  const [nodeData, setNodeData] = useState<ProtoNodeTypes_DecisionNodeData>({
    label: 'Decision',
    conditions: {},
    defaultOutput: { template: '' },
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

  const handleInputChange = (name: string, value: any) => {
    setNodeData(prev => ({ ...prev, [name]: value }));
    
    setNodes(nds =>
      nds.map(node => {
        if (node.id === id) {
          return {
            ...node,
            data: {
              ...node.data,
              [name]: value,
            },
          };
        }
        return node;
      })
    );
  };

  const handleConditionChange = (outputKey: string, field: 'type' | 'value', value: string) => {
    const updatedConditions = {
      ...nodeData.conditions,
      [outputKey]: {
        ...nodeData.conditions[outputKey],
        [field]: field === 'type' ? parseInt(value, 10) : { template: value },
      },
    };
    handleInputChange('conditions', updatedConditions);
  };

  const addCondition = () => {
    const newOutputKey = `output${Object.keys(nodeData.conditions).length + 1}`;
    const updatedConditions = {
      ...nodeData.conditions,
      [newOutputKey]: { 
        type: ProtoNodeTypes_Condition_ConditionType.EQUALS,
        value: { template: '' }
      },
    };
    handleInputChange('conditions', updatedConditions);
  };

  return (
    <div className="px-4 py-2 shadow-md rounded-md bg-[#2a2a3c] border-2 border-[#4a4a5e] text-white">
      {isSelected && <DeleteButton nodeId={id} />}
      <div className="flex justify-between items-center mb-2">
        <div className="rounded-full w-3 h-3 bg-[#00ffff]" />
        <div className="ml-2">
          <div className="text-lg font-bold">Decision: {nodeData.label}</div>
        </div>
      </div>
      <Handle 
        type="target" 
        position={Position.Left} 
        className="w-3 h-3 !bg-[#00ffff]" 
        style={{ left: '-12px' }}
      />
      
      {Object.entries(nodeData.conditions).map(([outputKey, condition], index) => (
        <div key={outputKey} className="mt-2 relative">
          <label className="block text-sm font-medium text-gray-300">Condition {index + 1}</label>
          <Picker
            label="Type"
            value={condition.type?.toString() ?? '0'}
            options={conditionOptions}
            onChange={(value) => handleConditionChange(outputKey, 'type', value)}
          />
          <input
            type="text"
            value={condition.value?.template ?? ''}
            onChange={(e) => handleConditionChange(outputKey, 'value', e.target.value)}
            className="mt-1 focus:ring-[#00ffff] focus:border-[#00ffff] block w-full shadow-sm sm:text-sm border-[#4a4a5e] rounded-md bg-[#3a3a4c] text-white"
            placeholder="Condition value"
            style={inputStyle}
          />
          <Handle
            type="source"
            position={Position.Right}
            id={outputKey}
            className="w-3 h-3 !bg-[#00ffff]"
            style={{ right: '-40px', top: '50%' }}
          />
        </div>
      ))}
      
      <button
        onClick={addCondition}
        className="mt-2 px-4 py-2 border border-transparent text-sm font-medium rounded-md text-[#2a2a3c] bg-[#00ffff] hover:bg-[#00cccc] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#00ffff]"
      >
        Add Condition
      </button>

      <div className="mt-2 relative">
        <label className="block text-sm font-medium text-gray-300">Default Output</label>
        <input
          type="text"
          value={nodeData.defaultOutput?.template ?? ''}
          onChange={(e) => handleInputChange('defaultOutput', { template: e.target.value })}
          className="mt-1 focus:ring-[#00ffff] focus:border-[#00ffff] block w-full shadow-sm sm:text-sm border-[#4a4a5e] rounded-md bg-[#3a3a4c] text-white"
          placeholder="Default output"
          style={inputStyle}
        />
        <Handle
          type="source"
          position={Position.Right}
          id="default"
          className="w-3 h-3 !bg-[#00ffff]"
          style={{ right: '-40px', top: '50%' }}
        />
      </div>
    </div>
  );
});

const inputStyle = {
  width: '100%',
  padding: '5px',
  background: '#3a3a4c',
  border: '1px solid #4a4a5e',
  borderRadius: '3px',
  color: '#ffffff',
};

DecisionNode.displayName = 'DecisionNode';

export default memo(DecisionNode);
