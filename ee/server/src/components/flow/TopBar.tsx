// src/components/TopBar.tsx
import React from 'react';
import styles from './TopBar.module.css';

interface TopBarProps {
  workflowName: string;
  setWorkflowName: (name: string) => void;
  workflowDescription: string;
  setWorkflowDescription: (description: string) => void;
  onSave: () => void;
}

const TopBar: React.FC<TopBarProps> = ({
  workflowName,
  setWorkflowName,
  workflowDescription,
  setWorkflowDescription,
  onSave,
}) => {
  return (
    <div className={styles.container}>
      <input
        type="text"
        value={workflowName}
        onChange={(e) => setWorkflowName(e.target.value)}
        placeholder="Workflow Name"
        className={styles.input}
      />
      <input
        type="text"
        value={workflowDescription}
        onChange={(e) => setWorkflowDescription(e.target.value)}
        placeholder="Workflow Description"
        className={styles.input}
      />
      <button onClick={onSave} className={styles.button}>
        Save Workflow
      </button>
    </div>
  );
};

export default TopBar;
