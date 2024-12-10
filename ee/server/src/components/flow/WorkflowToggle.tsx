// src/components/WorkflowToggle.tsx
'use client';

import React, { useState } from 'react';
import styles from './WorkflowToggle.module.css';
import Popup from './Popup';

interface WorkflowToggleProps {
  workflowId: string;
  isEnabled: boolean;
}

const WorkflowToggle: React.FC<WorkflowToggleProps> = ({ workflowId, isEnabled }) => {
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const [isToggling, setIsToggling] = useState(false);

  const handleToggleClick = () => {
    setIsPopupOpen(true);
  };

  const handleConfirmToggle = async () => {
    setIsToggling(true);
    try {
      const response = await fetch(`/api/workflows/${workflowId}/${isEnabled ? 'disable' : 'enable'}`, {
        method: 'POST',
      });

      if (response.ok) {
        window.location.reload();
      } else {
        console.error('Failed to toggle workflow');
      }
    } catch (error) {
      console.error('Error toggling workflow:', error);
    }
    setIsToggling(false);
    setIsPopupOpen(false);
  };

  return (
    <>
      <label className={styles.switch}>
        <input
          type="checkbox"
          checked={isEnabled}
          onChange={handleToggleClick}
          disabled={isToggling}
        />
        <span className={styles.slider}></span>
      </label>
      <Popup 
        isOpen={isPopupOpen} 
        onClose={() => setIsPopupOpen(false)} 
        title={`${isEnabled ? 'Disable' : 'Enable'} Workflow`}
      >
        <p>Are you sure you want to {isEnabled ? 'disable' : 'enable'} this workflow?</p>
        <div className={styles.popupButtons}>
          <button 
            className={styles.cancelButton} 
            onClick={() => setIsPopupOpen(false)}
          >
            Cancel
          </button>
          <button 
            className={styles.confirmButton} 
            onClick={handleConfirmToggle} 
            disabled={isToggling}
          >
            {isToggling ? 'Processing...' : 'Confirm'}
          </button>
        </div>
      </Popup>
    </>
  );
};

export default WorkflowToggle;
