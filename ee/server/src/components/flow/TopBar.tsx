// src/components/TopBar.tsx
'use client';
import React from 'react';
import styles from './TopBar.module.css';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

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
  const { t } = useTranslation('msp/workflows');
  return (
    <div className={styles.container}>
      <input
        type="text"
        value={workflowName}
        onChange={(e) => setWorkflowName(e.target.value)}
        placeholder={t('flow.topBar.workflowName')}
        className={styles.input}
      />
      <input
        type="text"
        value={workflowDescription}
        onChange={(e) => setWorkflowDescription(e.target.value)}
        placeholder={t('flow.topBar.workflowDescription')}
        className={styles.input}
      />
      <button onClick={onSave} className={styles.button}>
        Save Workflow
      </button>
    </div>
  );
};

export default TopBar;
