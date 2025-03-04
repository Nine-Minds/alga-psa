// src/components/DeleteWorkflowButton.tsx
'use client';

import React, { useState } from 'react';
import styles from '../../../../../server/src/app/msp/workflows/Workflows.module.css';
import Popup from './Popup';
import { useRouter } from 'next/navigation';

interface DeleteWorkflowButtonProps {
  workflowId: number;
}

const DeleteWorkflowButton: React.FC<DeleteWorkflowButtonProps> = ({ workflowId }) => {
  const [isDeletePopupOpen, setIsDeletePopupOpen] = useState(false);
  const router = useRouter();

  const handleDeleteClick = () => {
    setIsDeletePopupOpen(true);
  };

  const handleDeleteConfirm = async () => {
    try {
      const response = await fetch(`/api/workflows/${workflowId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setIsDeletePopupOpen(false);
        // Refresh the page to show updated workflow list
        router.refresh();
      } else {
        console.error('Failed to delete workflow');
      }
    } catch (error) {
      console.error('Error deleting workflow:', error);
    }
  };

  return (
    <>
      <button
        className={styles.deleteButton}
        onClick={handleDeleteClick}
      >
        Delete
      </button>

      <Popup
        isOpen={isDeletePopupOpen}
        onClose={() => setIsDeletePopupOpen(false)}
        title="Confirm Deletion"
      >
        <p>Are you sure you want to delete this workflow?</p>
        <div className={styles.popupButtons}>
          <button className={styles.cancelButton} onClick={() => setIsDeletePopupOpen(false)}>
            Cancel
          </button>
          <button className={styles.confirmButton} onClick={handleDeleteConfirm}>
            Confirm
          </button>
        </div>
      </Popup>
    </>
  );
};

export default DeleteWorkflowButton;
