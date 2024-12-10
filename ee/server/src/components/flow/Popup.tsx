// src/components/Popup.tsx
import React from 'react';
import styles from './Popup.module.css';

interface PopupProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

const Popup: React.FC<PopupProps> = ({ isOpen, onClose, title, children }) => {
  if (!isOpen) return null;

  return (
    <div className={styles.overlay}>
      <div className={styles.popup}>
        <h2 className={styles.title}>{title}</h2>
        <div className={styles.content}>{children}</div>
        <button className={styles.closeButton} onClick={onClose}>
          &times;
        </button>
      </div>
    </div>
  );
};

export default Popup;