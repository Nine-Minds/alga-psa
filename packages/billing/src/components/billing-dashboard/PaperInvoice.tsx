import React from 'react';
import {
  resolveTemplatePrintSettings,
  type TemplateAst,
  type TemplatePrintSettings,
} from '@alga-psa/types';
import { resolveTemplatePrintSettingsFromAst } from '../../lib/invoice-template-ast/printSettings';
import styles from './PaperInvoice.module.css';

interface PaperInvoiceProps {
  children: React.ReactNode;
  templateAst?: TemplateAst | null;
  printSettings?: TemplatePrintSettings | null;
}

const PaperInvoice: React.FC<PaperInvoiceProps> = ({ children, templateAst, printSettings }) => {
  const resolvedPrintSettings = templateAst
    ? resolveTemplatePrintSettingsFromAst(templateAst)
    : resolveTemplatePrintSettings({
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
