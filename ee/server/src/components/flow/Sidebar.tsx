// src/components/Sidebar.tsx
import React from 'react';
import { NodeTypes } from '../../services/flow/types/nodes';

const Sidebar: React.FC = () => {
  const onDragStart = (event: React.DragEvent<HTMLDivElement>, nodeType: NodeTypes) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <aside className="sidebar">
      <div style={{ marginBottom: '20px' }}>Drag these nodes to the canvas:</div>
      {['thinking', 'action', 'classifier', 'office365Receiver', 'ticketCreator', 'decision', 'selector'].map((type) => (
        <div
          key={type}
          onDragStart={(event) => onDragStart(event, type as NodeTypes)}
          draggable
          style={{
            padding: '10px',
            margin: '5px 0',
            background: '#3a3a4c',
            borderRadius: '5px',
            cursor: 'move',
          }}
        >
          {type.charAt(0).toUpperCase() + type.slice(1)}
        </div>
      ))}
    </aside>
  );
};

export default Sidebar;
