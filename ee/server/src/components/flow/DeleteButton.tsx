// src/components/DeleteButton.tsx
import React from 'react';
import { useReactFlow } from 'reactflow';

interface DeleteButtonProps {
  nodeId: string;
}

const DeleteButton: React.FC<DeleteButtonProps> = ({ nodeId }) => {
  const { setNodes, setEdges } = useReactFlow();

  const handleDelete = () => {
    setNodes((nodes) => nodes.filter((node) => node.id !== nodeId));
    setEdges((edges) => edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
  };

  return (
    <button
      className="delete-button"
      onClick={handleDelete}
      style={{
        position: 'absolute',
        top: '-10px',
        right: '-10px',
        background: '#ff4444',
        color: 'white',
        border: 'none',
        borderRadius: '50%',
        width: '20px',
        height: '20px',
        fontSize: '12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
      }}
    >
      ×
    </button>
  );
};

export default DeleteButton;
