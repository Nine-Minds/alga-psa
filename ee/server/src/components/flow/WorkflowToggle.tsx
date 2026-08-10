// src/components/WorkflowToggle.tsx
'use client';

import React, { useState } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import styles from './WorkflowToggle.module.css';
import Popup from './Popup';

interface WorkflowToggleProps {
  workflowId: string;
  isEnabled: boolean;
}

const WorkflowToggle: React.FC<WorkflowToggleProps> = ({ workflowId, isEnabled }) => {
  const { t } = useTranslation(['msp/workflows', 'common']);
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
        title={
          isEnabled
            ? t('toggle.disableTitle', { defaultValue: 'Disable Workflow' })
            : t('toggle.enableTitle', { defaultValue: 'Enable Workflow' })
        }
      >
        {/* Whole sentences per branch rather than an interpolated verb: the verb
            inflects with the object in most target languages. */}
        <p>
          {isEnabled
            ? t('toggle.confirmDisable', {
                defaultValue: 'Are you sure you want to disable this workflow?',
              })
            : t('toggle.confirmEnable', {
                defaultValue: 'Are you sure you want to enable this workflow?',
              })}
        </p>
        <div className={styles.popupButtons}>
          <button
            className={styles.cancelButton}
            onClick={() => setIsPopupOpen(false)}
          >
            {t('common:actions.cancel', { defaultValue: 'Cancel' })}
          </button>
          <button
            className={styles.confirmButton}
            onClick={handleConfirmToggle}
            disabled={isToggling}
          >
            {isToggling
              ? t('common:status.processing', { defaultValue: 'Processing...' })
              : t('common:actions.confirm', { defaultValue: 'Confirm' })}
          </button>
        </div>
      </Popup>
    </>
  );
};

export default WorkflowToggle;
