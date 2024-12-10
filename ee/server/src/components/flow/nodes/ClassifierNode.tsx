'use client'
// src/components/nodes/ClassifierNode.tsx
import React, { memo, useState, useEffect } from 'react';
import { Handle, NodeProps, Position, useReactFlow } from 'reactflow';
import DeleteButton from '../DeleteButton';
import InputFieldSelector from '../InputFieldSelector';
import { ProtoNodeTypes_ClassifierNodeData, Template } from '../../../generated/workflow';

interface ClassifierNodeProps {
  id: string;
  data: ProtoNodeTypes_ClassifierNodeData;
}

const ClassifierNode = ({ data, id }: NodeProps<ProtoNodeTypes_ClassifierNodeData>) => {
  const { getNode, setNodes } = useReactFlow();
  const node = getNode(id);
  const isSelected = node?.selected ?? false;

  const [newClassification, setNewClassification] = useState('');

  const [nodeData, setNodeData] = useState<ProtoNodeTypes_ClassifierNodeData>({
    label: '🏷️ Classifier',
    outputs: [],
    source: { template: '' },
    thinkingProcess: { template: '' },
    classifications: [],
  });

  useEffect(() => {
    if (data && typeof data === 'object') {
      setNodeData(prevData => ({
        ...prevData,
        ...data,
      }));
    }
  }, [data]);

  const handleAddClassification = () => {
    if (newClassification.trim() === '') return;

    const newClassifications = [
      ...nodeData.classifications,
      { template: newClassification.trim() } as Template
    ];

    setNodeData(prev => ({
      ...prev,
      classifications: newClassifications,
    }));

    setNodes(nds =>
      nds.map(node => {
        if (node.id === id) {
          return {
            ...node,
            data: {
              ...node.data,
              classifications: newClassifications,
            },
          };
        }
        return node;
      })
    );

    setNewClassification('');
  };

  const handleInputChange = (name: string, value: string) => {
    setNodeData(prev => {
      const updatedData = { ...prev, [name]: { template: value } };
      return updatedData;
    });
    
    setNodes(nds =>
      nds.map(node => {
        if (node.id === id) {
          return {
            ...node,
            data: {
              ...node.data,
              [name]: { template: value },
            },
          };
        }
        return node;
      })
    );
  };

  const handleRemoveClassification = (index: number) => {
    const newClassifications = nodeData.classifications.filter((_, i) => i !== index);

    setNodeData(prev => ({
      ...prev,
      classifications: newClassifications,
    }));

    setNodes(nds =>
      nds.map(node => {
        if (node.id === id) {
          return {
            ...node,
            data: {
              ...node.data,
              classifications: newClassifications,
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
        <label htmlFor="source" style={styles.label}>Source:</label>
        <InputFieldSelector
          value={nodeData.source || { template: '' }}
          onChange={(value) => handleInputChange('source', value)}
          inputType="Email"
        />
      </div>
      <div style={styles.field}>
        <label style={styles.label}>Classifications:</label>
        {nodeData.classifications.map((classification, index) => (
          <div key={index} style={styles.classificationItem}>
            <span>{classification.template}</span>
            <button onClick={() => handleRemoveClassification(index)} style={styles.removeButton}>
              Remove
            </button>
          </div>
        ))}
        <div style={styles.addClassification}>
          <input
            type="text"
            value={newClassification}
            onChange={(e) => setNewClassification(e.target.value)}
            style={styles.input}
            placeholder="New classification"
          />
          <button onClick={handleAddClassification} style={styles.addButton}>
            Add
          </button>
        </div>
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
    width: '300px',
  },
  title: {
    marginBottom: '15px',
    fontSize: '16px',
    fontWeight: 'bold' as const,
  },
  field: {
    marginBottom: '15px',
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
  classificationItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '5px',
    padding: '5px 8px',
    background: '#3a3a4c',
    borderRadius: '3px',
  },
  removeButton: {
    background: '#ff4444',
    color: 'white',
    border: 'none',
    padding: '3px 6px',
    cursor: 'pointer',
    borderRadius: '3px',
    fontSize: '12px',
  },
  addClassification: {
    display: 'flex',
    marginTop: '10px',
    gap: '5px',
  },
  input: {
    flex: 1,
    padding: '6px 8px',
    background: '#3a3a4c',
    color: '#ffffff',
    border: '1px solid #4a4a5e',
    borderRadius: '3px',
    fontSize: '14px',
  },
  addButton: {
    background: '#00ffff',
    color: '#2a2a3c',
    border: 'none',
    padding: '6px 12px',
    cursor: 'pointer',
    borderRadius: '3px',
    fontSize: '14px',
    fontWeight: 'bold' as const,
    whiteSpace: 'nowrap' as const,
  },
};

export default memo(ClassifierNode);
