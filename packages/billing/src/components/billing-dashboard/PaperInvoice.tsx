// PaperInvoice.tsx
import React from 'react';
import styles from './PaperInvoice.module.css';

interface PaperInvoiceProps {
  children: React.ReactNode;
}

const PaperInvoice: React.FC<PaperInvoiceProps> = ({ children }) => {
  return (
    <div className={styles.paperContainer}>
      <div className={styles.paper}>
        {children}
      </div>
    </div>
  );
};

export default PaperInvoice;