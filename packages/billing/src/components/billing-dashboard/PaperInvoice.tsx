import React from 'react';
import {
  resolveInvoiceTemplatePrintSettings,
  type InvoiceTemplateAst,
  type InvoiceTemplatePrintSettings,
} from '@alga-psa/types';
import { resolveInvoiceTemplatePrintSettingsFromAst } from '../../lib/invoice-template-ast/printSettings';
import styles from './PaperInvoice.module.css';

interface PaperInvoiceProps {
  children: React.ReactNode;
  templateAst?: InvoiceTemplateAst | null;
  printSettings?: InvoiceTemplatePrintSettings | null;
}

const PaperInvoice: React.FC<PaperInvoiceProps> = ({ children, templateAst, printSettings }) => {
  const resolvedPrintSettings = templateAst
    ? resolveInvoiceTemplatePrintSettingsFromAst(templateAst)
    : resolveInvoiceTemplatePrintSettings({
        printSettings: printSettings ?? undefined,
      });
  const paperStyle: React.CSSProperties & Record<'--paper-printable-inset', string> = {
    width: `${resolvedPrintSettings.pageWidthPx}px`,
    minHeight: `${resolvedPrintSettings.pageHeightPx}px`,
    '--paper-printable-inset': `${resolvedPrintSettings.marginPx}px`,
  };

  return (
    <div className={styles.paperContainer}>
      <div
        className={styles.paper}
        data-automation-id="paper-invoice-sheet"
        data-paper-preset={resolvedPrintSettings.paperPreset}
        style={paperStyle}
      >
        <div className={styles.paperContent} data-automation-id="paper-invoice-content">
          {children}
        </div>
      </div>
    </div>
  );
};

export default PaperInvoice;
